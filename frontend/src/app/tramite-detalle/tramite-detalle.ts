import { Component, OnInit, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ArticuloElegido, CampoPlantilla, CaseDetail, Capabilities, Notificacion, Pago, Plantilla, Tramites,
} from '../tramites';
import { ESTADOS, clp, indiceActual, mensajeError, pasosDe } from '../flujo';

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
  referencia = signal('');
  plantillaId = signal<number | null>(null);
  valores = signal<Record<string, string>>({});
  articulos = signal<ArticuloElegido[]>([]);   // artículos elegidos (plantillas con {{clausulas}})
  rehacer = signal(false);                      // volver al formulario aunque ya exista un documento (solo en borrador)

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

  constructor(private api: Tramites) { }

  ngOnInit() { this.cargar(); }

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
  informarPago() {
    const ref = this.referencia().trim();
    if (!ref) { this.error.set('Ingresa la referencia de tu transferencia.'); return; }
    return this.ejecutar(async () => {
      await firstValueFrom(this.api.informarPago(this.id(), ref));
      this.referencia.set('');
    }, 'Aviso de transferencia enviado. Finanzas lo verificará.');
  }

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
    return Object.fromEntries(campos.filter(c => c.default).map(c => [c.key, c.default!]));
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
  }
  quitarArticulo(i: number) { this.articulos.update(a => a.filter((_, j) => j !== i)); }
  setValorArticulo(i: number, k: string, v: string) {
    this.articulos.update(a => a.map((x, j) => (j === i ? { ...x, values: { ...x.values, [k]: v } } : x)));
  }
  setValor(k: string, v: string) { this.valores.update(o => ({ ...o, [k]: v })); }

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
    return this.bajar(`/tramites/${this.id()}/documentos/${docId}/descarga`, `${this.tramite()!.folio}-v${version}.txt`);
  }
  bajarAdjunto(adjId: number, nombre: string) {
    return this.bajar(`/tramites/${this.id()}/adjuntos/${adjId}/descarga`, nombre);
  }
  bajarComprobante(pagoId: number) {
    return this.bajar(`/pagos/${pagoId}/comprobante`, `comprobante-${pagoId}.txt`);
  }
}