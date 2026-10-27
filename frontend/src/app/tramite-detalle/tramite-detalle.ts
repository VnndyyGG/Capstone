import { Component, HostListener, OnInit, computed, effect, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ArticuloElegido, CampoPlantilla, CaseDetail, Capabilities, DireccionSugerida, Notificacion, Pago, Plantilla, Tramites,
} from '../tramites';
import { ESTADOS, clp, indiceActual, mensajeError, pasosDe } from '../flujo';
import { Auth, PREFIJO_AVANCE } from '../auth';
import { REGIONES, comunaOficial, esComuna, esComunaValida, esRegion, esRegionValida, mayus, regionDe, regionDeComuna } from '../chile';
import { esFecha, fechaIso, fechaTexto, mesesEntre, sumarMeses } from '../fechas';
import { MARCAS, aniosVehiculo, formatoPatente } from '../vehiculos';
import { montoEnPalabras } from '../montos';
import { CAMPOS_SUCURSAL, SUCURSALES } from '../sucursales';


/** Lo que el cliente lleva escrito y aún no está en el servidor. Se guarda solo en este navegador. */
interface Avance {
  plantillaId: number | null;
  valores: Record<string, string>;
  articulos: ArticuloElegido[];
  contenido: string;
  base: number;      // versión del servidor sobre la que se editó el texto
  rehacer: boolean;
}
const EDITABLES = ['borrador', 'en_redaccion', 'observado'];
// Con el trámite en revisión o después, el avance local ya no sirve y se borra (contiene RUT y direcciones).
const CONSERVAR = [...EDITABLES, 'pendiente_pago'];

@Component({
  imports: [FormsModule, NgTemplateOutlet],
  selector: 'app-tramite-detalle',
  styleUrl: './tramite-detalle.scss',
  templateUrl: './tramite-detalle.html',
})
export class TramiteDetalle implements OnInit {
  id = input.required<number>();
  cambio = output<void>();   // avisa al padre para refrescar el listado
  cerrar = output<void>();   // volver al listado

  tramite = signal<CaseDetail | null>(null);
  pagos = signal<Pago[]>([]);
  notifs = signal<Notificacion[]>([]);
  plantillas = signal<Plantilla[]>([]);
  caps = signal<Capabilities | null>(null);

  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  aviso = signal('');

  contenido = signal('');
  plantillaId = signal<number | null>(null);
  valores = signal<Record<string, string>>({});
  articulos = signal<ArticuloElegido[]>([]);   // artículos elegidos (plantillas con {{clausulas}})
  rehacer = signal(false);                      // volver al formulario aunque ya exista un documento (solo en borrador)

  // ---- Avance guardado en el navegador ----
  private restaurado = false;    // no se escribe nada hasta haber intentado recuperar lo anterior
  tocado = signal(false);        // hay cambios del cliente que aún no se guardan en el servidor
  recuperado = signal(false);    // se cargó un avance guardado en este navegador

  readonly clp = clp;

  requiereFirma = computed(() => !!this.tramite()?.requires_signature);
  pasos = computed(() => pasosDe(this.requiereFirma()));
  actual = computed(() => indiceActual(this.tramite()?.status ?? '', this.requiereFirma()));
  estado = computed(() => this.tramite()?.status ?? '');
  estadoLabel = computed(() => ESTADOS[this.estado()]?.label ?? this.estado());
  estadoClase = computed(() => ESTADOS[this.estado()]?.clase ?? '');

  ultimaVersion = computed(() => this.tramite()?.documents[0]?.version ?? 0);
  pagoDelTramite = computed(() => this.pagos().find(p => p.case_id === this.id()) ?? null);
  puedeAdjuntar = computed(() => ['borrador', 'pendiente_pago', 'en_redaccion', 'observado'].includes(this.estado()));
  plantillaSel = computed(() => this.plantillas().find(p => p.id === this.plantillaId()) ?? null);
  // Plantillas agrupadas por tipo de documento (domicilio tributario, arriendos, societario...)
  grupos = computed(() => {
    const m = new Map<string, Plantilla[]>();
    for (const p of this.plantillas()) {
      const g = p.categoryLabel || 'General';
      m.set(g, [...(m.get(g) ?? []), p]);
    }
    return [...m].map(([label, items]) => ({ label, items }));
  });
  // Campos = marcadores {{campo}} de la plantilla, con la definición que entrega el backend
  // (etiqueta, tipo, sección, valor por defecto). Si la plantilla no trae definición, se deduce de la clave.
  campos = computed<CampoPlantilla[]>(() => {
    const sel = this.plantillaSel();
    if (!sel) return [];
    const claves = [...new Set([...sel.content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))]
      .filter(k => k !== 'clausulas');
    return claves.map(k => sel.fields.find(f => f.key === k) ?? this.campoPorDefecto(k));
  });
  // Campos agrupados por sección, respetando el orden de la plantilla
  secciones = computed(() => {
    const m = new Map<string, CampoPlantilla[]>();
    for (const c of this.campos()) m.set(c.group ?? 'Datos', [...(m.get(c.group ?? 'Datos') ?? []), c]);
    return [...m].map(([titulo, campos]) => ({ titulo, campos }));
  });
  usaArticulos = computed(() => /\{\{\s*clausulas\s*\}\}/.test(this.plantillaSel()?.content ?? ''));
  faltantes = computed(() => {
    const f = this.campos().filter(c => c.required && !(this.valores()[c.key] ?? '').trim()).map(c => c.label);
    if (this.usaArticulos()) {
      if (!this.articulos().length) f.push('Al menos un artículo');
      this.articulos().forEach(a => {
        for (const c of this.defArticulo(a.key)?.fields ?? [])
          if (c.required && !(a.values[c.key] ?? '').trim()) f.push(`${this.defArticulo(a.key)!.label}: ${c.label}`);
      });
    }
    return f;
  });
  generado = computed(() => {
    const sel = this.plantillaSel();
    if (!sel) return '';
    const val = (c: CampoPlantilla, v: Record<string, string>) => (v[c.key] ?? '').trim() || `[${c.label}]`;
    const rellenar = (txt: string, campos: CampoPlantilla[], v: Record<string, string>) =>
      txt.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => {
        const c = campos.find(x => x.key === k);
        return c ? val(c, v) : m;
      });
    const arts = this.articulos().map((a, i) => {
      const d = this.defArticulo(a.key);
      return d ? `${i + 1}.- ${rellenar(d.text, d.fields, a.values)}` : '';
    }).filter(Boolean).join('\n\n');
    const base = sel.content.replace(/\{\{\s*clausulas\s*\}\}/g, () => arts || '[Artículos]');
    return rellenar(base, this.campos(), this.valores());
  });
  // Primero: formulario → documento generado. Con una versión ya guardada: se edita el texto directamente.
  primeraRedaccion = computed(() => this.ultimaVersion() === 0 || this.rehacer());
  textoAGuardar = computed(() => (this.primeraRedaccion() ? this.generado() : this.contenido()));
  hayCambiosSinGuardar = computed(
    () => this.textoAGuardar() !== (this.tramite()?.documents[0]?.content ?? '')
  );
  puedeEnviar = computed(
    () => this.textoAGuardar().trim() !== '' && (!this.primeraRedaccion() || this.faltantes().length === 0)
  );
  // El backend no expone el motivo de la observación en el trámite; viaja en la notificación (ver nota de backend).
  observacion = computed(() =>
    this.notifs().find(n => n.case_id === this.id() && n.message.includes('observado'))?.message ?? ''
  );

  /** Cambios que se perderían en otro dispositivo: formulario aún sin generar, o texto editado sin guardar. */
  sinGuardar = computed(() =>
    this.tocado() && EDITABLES.includes(this.estado()) && (this.primeraRedaccion() || this.hayCambiosSinGuardar())
  );

  constructor(private api: Tramites, private router: Router, private auth: Auth) {
    // Cada cambio del formulario o del texto se guarda en el navegador.
    effect(() => {
      const avance: Avance = {
        plantillaId: this.plantillaId(), valores: this.valores(), articulos: this.articulos(),
        contenido: this.contenido(), base: this.ultimaVersion(), rehacer: this.rehacer(),
      };
      if (this.restaurado && this.tocado() && EDITABLES.includes(this.estado())) this.escribirAvance(avance);
    });
  }

  ngOnInit() { this.cargar(); }

  // ---- Avance local (localStorage) ----
  private claveAvance() { return `${PREFIJO_AVANCE}${this.auth.currentRole()?.id ?? 0}-${this.id()}`; }
  private leerAvance(): Avance | null {
    try { return JSON.parse(localStorage.getItem(this.claveAvance()) ?? 'null'); } catch { return null; }
  }
  private escribirAvance(a: Avance) {
    try { localStorage.setItem(this.claveAvance(), JSON.stringify(a)); } catch { /* sin storage disponible */ }
  }
  private borrarAvance() {
    try { localStorage.removeItem(this.claveAvance()); } catch { /* sin storage disponible */ }
  }
  private restaurarAvance() {
    const a = this.leerAvance();
    if (!a || !EDITABLES.includes(this.estado())) return;
    let algo = false;
    if (a.plantillaId !== null && this.plantillas().some(p => p.id === a.plantillaId)) {
      if (this.plantillaId() !== a.plantillaId) this.elegirPlantilla(String(a.plantillaId));
      this.valores.update(v => ({ ...v, ...a.valores }));
      this.articulos.set(a.articulos ?? []);
      algo = Object.keys(a.valores ?? {}).length > 0 || (a.articulos ?? []).length > 0;
    }
    // El texto editado solo se recupera si sigue basado en la versión que hay en el servidor.
    const textoNuevo = a.base === this.ultimaVersion() && !!a.contenido && a.contenido !== this.contenido();
    if (textoNuevo) this.contenido.set(a.contenido);
    if (a.rehacer && this.estado() === 'borrador') this.rehacer.set(true);
    if (!algo && !textoNuevo) return;
    this.recuperado.set(true);
    this.tocado.set(true);
  }
  descartarAvance() {
    this.borrarAvance();
    this.recuperado.set(false);
    this.tocado.set(false);
    this.rehacer.set(false);
    this.articulos.set([]);
    this.valores.set(this.conDefectos(this.campos()));
    this.contenido.set(this.tramite()?.documents[0]?.content ?? '');
  }

  volver() {
    if (this.sinGuardar() && !confirm('Tienes cambios que aún no se guardan en el servidor. Quedarán en este navegador para cuando vuelvas, pero no en otros dispositivos. ¿Salir igual?')) return;
    this.cerrar.emit();
  }
  @HostListener('window:beforeunload', ['$event'])
  avisarAlCerrar(e: BeforeUnloadEvent) {
    if (this.sinGuardar()) { e.preventDefault(); e.returnValue = ''; }
  }

  async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const [t, pagos, notifs, plantillas, caps] = await Promise.all([
        firstValueFrom(this.api.getTramite(this.id())),
        firstValueFrom(this.api.getPagos()),
        firstValueFrom(this.api.getNotificaciones()),
        firstValueFrom(this.api.getPlantillas()),
        firstValueFrom(this.api.getCapabilities()),
      ]);
      this.tramite.set(t);
      this.pagos.set(pagos.items);
      this.notifs.set(notifs.items);
      this.plantillas.set(plantillas.items);
      this.caps.set(caps);
      this.contenido.set(t.documents[0]?.content ?? '');
      if (t.template_id && this.plantillaId() === null && plantillas.items.some(p => p.id === t.template_id)) this.elegirPlantilla(String(t.template_id));
      if (!CONSERVAR.includes(t.status)) this.borrarAvance();
      if (!this.restaurado) { this.restaurarAvance(); this.restaurado = true; }
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  /** Ejecuta una acción con control de "ocupado", errores y recarga. */
  private async ejecutar(fn: () => Promise<unknown>, okMsg = '') {
    this.ocupado.set(true);
    this.error.set('');
    this.aviso.set('');
    try {
      await fn();
      this.tocado.set(false);      // lo escrito ya quedó en el servidor
      this.recuperado.set(false);
      this.borrarAvance();
      await this.cargar();
      this.cambio.emit();
      if (okMsg) this.aviso.set(okMsg);
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  // ---- Paso 1: pago ----
  irAlCarrito() { this.router.navigate(['/cliente/carrito']); }
  cancelar() {
    if (!confirm('¿Cancelar este trámite? Esta acción no se puede deshacer.')) return;
    return this.ejecutar(() => firstValueFrom(this.api.cambiarEstado(this.id(), 'cancelado')));
  }

  // ---- Paso 2: redacción ----
  private campoPorDefecto(k: string): CampoPlantilla {
    const t = k.replace(/_largo$/, '').replace(/_/g, ' ');
    return { key: k, label: t.charAt(0).toUpperCase() + t.slice(1), type: k.endsWith('_largo') ? 'textarea' : 'text', required: true };
  }
  defArticulo(key: string) { return this.plantillaSel()?.clauses.find(c => c.key === key); }
  private conDefectos(campos: CampoPlantilla[]) {
    const defectos = Object.fromEntries(campos.filter(c => c.default).map(c => [c.key, c.default!]));
    // Contratos con sucursal: se precargan los datos de la primera (hoy, La Florida).
    return campos.some(c => c.key === 'sucursal_direccion') ? { ...defectos, ...SUCURSALES[0].valores } : defectos;
  }

  // ---- Sucursal: sus datos se completan solos y no se pueden editar ----
  readonly sucursales = SUCURSALES;
  esCampoSucursal(c: CampoPlantilla) { return CAMPOS_SUCURSAL.includes(c.key); }
  /** La sucursal cuyos datos coinciden con los del formulario ('' si no coincide ninguna). */
  sucursalElegida = computed(() =>
    SUCURSALES.find(s => s.valores['sucursal_direccion'] === this.valores()['sucursal_direccion'])?.sigla ?? '');
  elegirSucursal(sigla: string) {
    const s = SUCURSALES.find(x => x.sigla === sigla);
    if (s) { this.valores.update(v => ({ ...v, ...s.valores })); this.tocado.set(true); }
  }

  inputType(c: CampoPlantilla) { return c.type === 'email' ? 'email' : 'text'; }
  elegirPlantilla(id: string) {
    this.plantillaId.set(id ? Number(id) : null);
    this.articulos.set([]);
    this.valores.set(this.conDefectos(this.campos()));   // precarga valores por defecto (ciudad, sitio, duración...)
  }
  agregarArticulo(key: string) {
    const d = this.defArticulo(key);
    if (d) this.articulos.update(a => [...a, { key, values: this.conDefectos(d.fields) }]);
    this.tocado.set(true);
  }
  quitarArticulo(i: number) { this.articulos.update(a => a.filter((_, j) => j !== i)); this.tocado.set(true); }
  setValorArticulo(i: number, k: string, v: string) {
    this.articulos.update(a => a.map((x, j) => (j === i ? { ...x, values: { ...x.values, [k]: v } } : x)));
    this.tocado.set(true);
  }
  setValor(k: string, v: string) {
    this.valores.update(o => {
      const nuevos = { ...o, [k]: v, ...this.ajusteUbicacion(o, k, v) };
      return { ...nuevos, ...this.ajusteFechas(nuevos, k) };
    });
    this.tocado.set(true);
  }

  // ---- Fechas: calendario y cálculo automático del plazo ----
  readonly fechaIso = fechaIso;
  esCampoFecha(c: CampoPlantilla) { return c.type === 'text' && esFecha(c.key); }
  /** El calendario entrega "2026-01-01"; en el contrato se guarda "01 DE ENERO DE 2026". */
  setFecha(k: string, iso: string) { this.setValor(k, fechaTexto(iso)); }

  // ---- Dirección: sugerencias de direcciones reales mientras se escribe ----
  sugerencias = signal<{ key: string; items: DireccionSugerida[] } | null>(null);
  private esperaDireccion?: ReturnType<typeof setTimeout>;
  /** Los campos de texto `*_direccion` / `*_domicilio`. */
  esDireccion(c: CampoPlantilla) { return c.type === 'text' && /(^|_)(direccion|domicilio)$/.test(c.key); }
  /** Espera a que el cliente deje de escribir (350 ms) para no consultar en cada tecla. */
  escribirDireccion(k: string, v: string) {
    this.setValor(k, v);
    clearTimeout(this.esperaDireccion);
    if (v.trim().length < 4) { this.sugerencias.set(null); return; }
    this.esperaDireccion = setTimeout(async () => {
      try {
        const { items } = await firstValueFrom(this.api.buscarDirecciones(v.trim()));
        if (this.valores()[k] === v) this.sugerencias.set({ key: k, items });   // descarta respuestas de algo ya borrado
      } catch {
        this.sugerencias.set(null);   // si el buscador falla, se sigue escribiendo a mano
      }
    }, 350);
  }
  /** El buscador trae barrio, ciudad y provincia mezclados: la comuna es el primero que está en la lista oficial. */
  comunaDe(s: DireccionSugerida) {
    for (const lugar of s.lugares) {
      const c = comunaOficial(lugar);
      if (c) return c;
    }
    return undefined;
  }
  /** Al elegir una sugerencia se completa la dirección y, si el formulario las tiene, la comuna y la región. */
  elegirDireccion(k: string, s: DireccionSugerida) {
    this.sugerencias.set(null);
    this.setValor(k, mayus(s.direccion));
    const comunaKey = k.replace(/(direccion|domicilio)$/, 'comuna');
    const comuna = this.comunaDe(s);
    if (comuna && this.campos().some(c => c.key === comunaKey)) this.setValor(comunaKey, mayus(comuna));   // setValor completa la región
  }

  // ---- Vehículo: marca en lista, modelos sugeridos, año en lista y patente con formato ----
  readonly marcas = MARCAS;
  readonly anios = aniosVehiculo();
  vehiculo(c: CampoPlantilla): 'marca' | 'modelo' | 'anio' | 'patente' | null {
    return c.type === 'text' && ['marca', 'modelo', 'anio', 'patente'].includes(c.key) ? c.key as 'marca' : null;
  }
  /** La marca guardada no está en la lista (se escribió a mano): se muestra igual como opción. */
  marcaFueraDeLista() {
    const v = this.valores()['marca'];
    return !!v && !MARCAS.some(m => mayus(m.nombre) === v);
  }
  modelosDeMarca() {
    return MARCAS.find(m => mayus(m.nombre) === this.valores()['marca'])?.modelos ?? [];
  }
  /** Al cambiar de marca se borra el modelo si es de otra marca (para no dejar "Hyundai Corolla"). Un modelo escrito a mano se conserva. */
  setMarca(v: string) {
    this.setValor('marca', v);
    const modelo = mayus(this.valores()['modelo'] ?? '');
    const deOtraMarca = MARCAS.some(m => mayus(m.nombre) !== v && m.modelos.some(x => mayus(x) === modelo));
    if (modelo && deOtraMarca && !this.modelosDeMarca().some(x => mayus(x) === modelo)) this.setValor('modelo', '');
  }
  setPatente(k: string, v: string, input: HTMLInputElement) {
    const patente = formatoPatente(v);
    input.value = patente;
    this.setValor(k, patente);
  }

  /**
   * Solo números, con punto de miles: 450000 → 450.000 (el "$" ya está en el contrato y en la pantalla).
   * Si la plantilla tiene `monto_palabras`, lo completa solo; el cliente igual puede corregirlo.
   */
  setMonto(k: string, v: string, input: HTMLInputElement) {
    const numeros = v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
    const monto = numeros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = monto;   // si se escribió una letra, se borra de la pantalla
    this.setValor(k, monto);
    const palabras = `${k}_palabras`;
    if (this.campos().some(c => c.key === palabras)) this.setValor(palabras, numeros ? montoEnPalabras(Number(numeros)) : '');
  }

  /** Pone puntos y guion mientras el cliente escribe: 123456785 → 12.345.678-5 */
  setRut(k: string, v: string, input: HTMLInputElement) {
    const limpio = v.toUpperCase().replace(/[^0-9K]/g, '');
    const cuerpo = limpio.slice(0, -1).replace(/\D/g, '').slice(0, 8), dv = limpio.slice(-1);
    const rut = cuerpo ? `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}` : dv;
    input.value = rut;   // si se escribió una letra no válida, se borra de la pantalla
    this.setValor(k, rut);
  }

  /** Inicio + duración = término. Cada plantilla nombra distinto sus campos; si falta alguno, no se calcula nada. */
  private vinculoPlazo() {
    const claves = new Set(this.campos().map(c => c.key));
    const primera = (...ks: string[]) => ks.find(k => claves.has(k));
    const inicio = primera('fecha_inicio', 'fecha_contrato');
    const fin = primera('fecha_termino', 'fecha_vencimiento');
    const meses = primera('duracion_meses', 'plazo', 'vigencia_meses');
    return inicio && fin && meses ? { inicio, fin, meses } : null;
  }
  /** Si cambia el inicio o la duración, recalcula el término; si cambia el término, recalcula la duración. */
  private ajusteFechas(o: Record<string, string>, k: string): Record<string, string> {
    const p = this.vinculoPlazo();
    if (!p || ![p.inicio, p.fin, p.meses].includes(k)) return {};
    const inicio = fechaIso(o[p.inicio] ?? ''), fin = fechaIso(o[p.fin] ?? '');
    const meses = parseInt(o[p.meses] ?? '', 10);   // "12", "12 meses" → 12
    if (!inicio) return {};
    if (k !== p.fin && meses > 0) return { [p.fin]: fechaTexto(sumarMeses(inicio, meses)) };
    if (k !== p.meses && fin) {
      const n = mesesEntre(inicio, fin);
      return { [p.meses]: n === null ? '' : this.textoMeses(p.meses, n) };
    }
    return {};
  }
  /** La duración se escribe según el tipo de campo: "12" en una lista o número, "12 meses" en texto. */
  private textoMeses(key: string, n: number) {
    const c = this.campos().find(x => x.key === key)!;
    if (c.type === 'select') return c.options?.includes(String(n)) ? String(n) : '';
    return c.type === 'number' ? String(n) : `${n} ${n === 1 ? 'mes' : 'meses'}`;
  }

    /** Avisa cuando las fechas no calzan con una duración permitida (la duración queda vacía). */
    avisoPlazo = computed(() => {
      const p = this.vinculoPlazo(), v = this.valores();
      if (!p || v[p.meses]) return '';
      const inicio = fechaIso(v[p.inicio] ?? ''), fin = fechaIso(v[p.fin] ?? '');
      if (!inicio || !fin) return '';
      const n = mesesEntre(inicio, fin);
      if (n === null) return 'La fecha de término debe caer el mismo día del mes que la de inicio (por ejemplo, del 01/01 al 01/07).';
      const opciones = this.campos().find(c => c.key === p.meses)?.options;
      return opciones ? `Entre esas fechas hay ${n} meses, pero la duración solo puede ser de ${opciones.join(', ')} meses. Cambia la fecha de término o elige la duración.` : '';
    });
  



  // ---- Región y comuna: listas desplegables enlazadas ----
  readonly regiones = REGIONES;
  readonly mayus = mayus;
  /** Los campos de texto llamados `*_region` / `*_comuna` se muestran como listas de Chile. */
  ubicacion(c: CampoPlantilla): 'region' | 'comuna' | null {
    if (c.type !== 'text') return null;
    return esRegion(c.key) ? 'region' : esComuna(c.key) ? 'comuna' : null;
  }
  /** Solo las comunas de la región elegida; sin región, todas agrupadas por región. */
  comunasPara(comunaKey: string) {
    const region = this.valores()[regionDe(comunaKey)];
    const r = region && REGIONES.find(x => mayus(x.nombre) === region);
    return r ? [r] : REGIONES;
  }
  /** Un valor escrito antes de existir la lista (ej. "Stgo") se conserva como opción para no perderlo. */
  fueraDeLista(c: CampoPlantilla) {
    const v = this.valores()[c.key];
    return !!v && !(this.ubicacion(c) === 'region' ? esRegionValida(v) : esComunaValida(v));
  }
  /** Al elegir comuna se completa su región; al cambiar de región se limpia una comuna que ya no le pertenece. */
  private ajusteUbicacion(o: Record<string, string>, k: string, v: string): Record<string, string> {
    const claves = new Set(this.campos().filter(c => c.type === 'text').map(c => c.key));
    if (!claves.has(k)) return {};
    if (esRegion(k)) {
      const ck = k.slice(0, -'region'.length) + 'comuna', comuna = o[ck];
      const region = comuna && regionDeComuna(comuna);
      if (claves.has(ck) && region && mayus(region) !== v) return { [ck]: '' };
    } else if (esComuna(k) && v) {
      const rk = regionDe(k), region = regionDeComuna(v);
      if (claves.has(rk) && region) return { [rk]: mayus(region) };
    }
    return {};
  }
  editarTexto(v: string) { this.contenido.set(v); this.tocado.set(true); }
  cambiarPlantilla(id: string) { this.elegirPlantilla(id); this.tocado.set(true); }

  /** Paso 1: del formulario al documento. El backend valida RUT, correo y opciones; se guarda como versión nueva. NO cobra. */
  generarDocumento() {
    return this.ejecutar(async () => {
      const texto = await this.generarEnServidor();
      await firstValueFrom(this.api.guardarDocumento(this.id(), texto, this.ultimaVersion()));
      this.rehacer.set(false);
    }, 'Documento generado. Revísalo y edítalo si necesitas ajustar algo; después continúas al pago.');
  }

  reabrirFormulario() {
    if (!confirm('Volver al formulario generará el documento de nuevo y reemplazará los cambios que hiciste al texto. ¿Continuar?')) return;
    this.rehacer.set(true);
  }

  /** Paso 3: con el documento listo, recién ahora se pasa al pago. */
  continuarAlPago() {
    return this.ejecutar(async () => {
      if (this.hayCambiosSinGuardar()) {
        await firstValueFrom(this.api.guardarDocumento(this.id(), this.textoAGuardar(), this.ultimaVersion()));
      }
      await firstValueFrom(this.api.cambiarEstado(this.id(), 'pendiente_pago'));
    }, 'Documento guardado. Ahora realiza el pago para enviarlo a revisión.');
  }

  /** Antes de pagar, el cliente puede volver a editar (si ya informó un pago, el backend lo impide). */
  volverAEditar() {
    return this.ejecutar(() => firstValueFrom(this.api.cambiarEstado(this.id(), 'borrador')));
  }

  guardar() {
    return this.ejecutar(
      () => firstValueFrom(this.api.guardarDocumento(this.id(), this.textoAGuardar(), this.ultimaVersion())),
      'Borrador guardado.'
    );
  }

  // ---- Paso 3: enviar a revisión (guarda primero si hay cambios) ----
  enviarARevision() {
    return this.ejecutar(async () => {
      if (this.hayCambiosSinGuardar() || this.ultimaVersion() === 0) {
        const texto = this.primeraRedaccion() ? await this.generarEnServidor() : this.textoAGuardar();
        await firstValueFrom(this.api.guardarDocumento(this.id(), texto, this.ultimaVersion()));
      }
      await firstValueFrom(this.api.cambiarEstado(this.id(), 'en_revision'));
    }, 'Documento enviado a revisión.');
  }

  /** Genera el texto final en el backend: valida RUT, correo y opciones antes de guardar. */
  private async generarEnServidor(): Promise<string> {
    const res = await firstValueFrom(this.api.renderPlantilla(this.plantillaSel()!.id,
      { values: this.valores(), clauses: this.articulos() }));
    if (!res.complete) throw new Error('Faltan datos por completar.');
    return res.content;
  }

  // ---- Adjuntos (PDF ≤ 2 MiB) ----
  async onArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { this.error.set('El PDF no puede pesar más de 2 MiB.'); return; }
    const base64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(new Error('No se pudo leer el archivo.'));
      r.readAsDataURL(file);
    });
    await this.ejecutar(
      () => firstValueFrom(this.api.subirAdjunto(this.id(), file.name, base64)),
      'Adjunto subido.'
    );
  }

  // ---- Descargas autenticadas ----
  private async bajar(ruta: string, nombre: string) {
    try {
      const blob = await firstValueFrom(this.api.descargar(ruta));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombre; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.error.set(mensajeError(e));
    }
  }
  bajarDocumento(docId: number, version: number) {
    return this.bajar(`/tramites/${this.id()}/documentos/${docId}/descarga`, `${this.tramite()!.folio}-borrador-v${version}.pdf`);
  }
  bajarAdjunto(adjId: number, nombre: string) {
    return this.bajar(`/tramites/${this.id()}/adjuntos/${adjId}/descarga`, nombre);
  }
  bajarComprobante(pagoId: number) {
    return this.bajar(`/pagos/${pagoId}/comprobante`, `comprobante-${pagoId}.pdf`);
  }
}