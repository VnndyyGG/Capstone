import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CaseDetail, CaseResumen, CaseRow, ClienteResultado, Tramites } from '../tramites';
import { ESTADOS, clp, mensajeError } from '../flujo';

type Asignado = CaseRow & { client_name: string };
type Filtro = 'en_revision' | 'observado' | 'aprobado';
const DIA = 24 * 60 * 60 * 1000;

@Component({
  imports: [FormsModule],
  selector: 'app-comercial-dashboard',
  styleUrl: './comercial-dashboard.scss',
  templateUrl: './comercial-dashboard.html',
})
export class ComercialDashboard implements OnInit {
  activeTab = signal<'bandeja' | 'todos' | 'clientes'>('bandeja');
  tramites = signal<Asignado[]>([]);
  cargando = signal(true);
  error = signal('');
  filtro = signal<Filtro>('en_revision');

  // Panel de revisión
  detalle = signal<CaseDetail | null>(null);
  cargandoDetalle = signal(false);
  motivo = signal('');
  procesando = signal(false);
  errorAccion = signal('');
  aviso = signal('');

  // Búsqueda de clientes
  q = signal('');
  buscando = signal(false);
  errorBusqueda = signal('');
  clientes = signal<ClienteResultado[] | null>(null);
  clienteSel = signal<ClienteResultado | null>(null);
  tramitesCliente = signal<CaseResumen[]>([]);

  readonly clp = clp;

  porRevisar = computed(() => this.tramites().filter(t => t.status === 'en_revision'));
  observados = computed(() => this.tramites().filter(t => t.status === 'observado'));
  aprobados = computed(() => this.tramites().filter(t => t.status === 'aprobado'));
  listosCerrar = computed(() => this.aprobados().filter(t => !t.requires_signature));
  cerradosMes = computed(() => {
    const mes = new Date().toISOString().slice(0, 7);
    return this.tramites().filter(t => t.status === 'completado' && t.updated_at.slice(0, 7) === mes).length;
  });
  // La bandeja se ordena por antigüedad: lo que lleva más tiempo esperando, primero.
  bandeja = computed(() =>
    this.tramites().filter(t => t.status === this.filtro()).sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  );
  documentoActual = computed(() => this.detalle()?.documents[0] ?? null);

  constructor(private api: Tramites) {}

  ngOnInit() { this.cargarListado(); }

  cargarListado() {
    this.api.getTramitesAsignados().subscribe({
      next: r => { this.tramites.set(r.items); this.cargando.set(false); this.error.set(''); },
      error: e => { this.error.set(mensajeError(e)); this.cargando.set(false); },
    });
  }

  showTab(tab: 'bandeja' | 'todos' | 'clientes') { this.activeTab.set(tab); }

  async abrir(id: number) {
    this.cargandoDetalle.set(true);
    this.errorAccion.set(''); this.aviso.set(''); this.motivo.set('');
    try {
      this.detalle.set(await firstValueFrom(this.api.getTramite(id)));
    } catch (e) {
      this.errorAccion.set(mensajeError(e));
    } finally {
      this.cargandoDetalle.set(false);
    }
  }
  cerrar() { this.detalle.set(null); }

  async cambiar(status: 'aprobado' | 'observado' | 'completado') {
    const t = this.detalle();
    if (!t) return;
    const motivo = this.motivo().trim();
    if (status === 'observado' && !motivo) {
      this.errorAccion.set('Escribe qué debe corregir el cliente antes de observar.');
      return;
    }
    this.procesando.set(true);
    this.errorAccion.set('');
    try {
      await firstValueFrom(this.api.cambiarEstado(t.id, status, motivo));
      this.aviso.set({ aprobado: 'Documento aprobado.', observado: 'Observación enviada al cliente.', completado: 'Trámite completado.' }[status]);
      this.motivo.set('');
      this.cargarListado();
      this.detalle.set(await firstValueFrom(this.api.getTramite(t.id)));
    } catch (e) {
      this.errorAccion.set(mensajeError(e));
    } finally {
      this.procesando.set(false);
    }
  }

  async buscar() {
    const q = this.q().trim();
    if (q.length < 3) { this.errorBusqueda.set('Escribe al menos 3 caracteres.'); return; }
    this.buscando.set(true);
    this.errorBusqueda.set('');
    this.clienteSel.set(null);
    try {
      this.clientes.set((await firstValueFrom(this.api.buscarClientes(q))).items);
    } catch (e) {
      this.errorBusqueda.set(mensajeError(e));
    } finally {
      this.buscando.set(false);
    }
  }
  async verCliente(c: ClienteResultado) {
    this.clienteSel.set(c);
    this.tramitesCliente.set([]);
    try {
      this.tramitesCliente.set((await firstValueFrom(this.api.getTramitesDeCliente(c.id))).items);
    } catch (e) {
      this.errorBusqueda.set(mensajeError(e));
    }
  }
  /** Solo se abre en detalle lo asignado a este ejecutivo; el resto es un resumen. */
  esMio(id: number) { return this.tramites().some(t => t.id === id); }
  abrirDesdeCliente(id: number) { this.activeTab.set('bandeja'); this.abrir(id); }

  // ---- Descargas autenticadas ----
  private async bajar(ruta: string, nombre: string) {
    try {
      const blob = await firstValueFrom(this.api.descargar(ruta));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombre; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.errorAccion.set(mensajeError(e));
    }
  }
  bajarDocumento(docId: number, version: number) {
    const t = this.detalle()!;
    return this.bajar(`/tramites/${t.id}/documentos/${docId}/descarga`, `${t.folio}-borrador-v${version}.pdf`);
  }
  bajarAdjunto(adjId: number, nombre: string) {
    return this.bajar(`/tramites/${this.detalle()!.id}/adjuntos/${adjId}/descarga`, nombre);
  }

  diasEsperando(fecha: string) { return Math.max(0, Math.floor((Date.now() - Date.parse(fecha)) / DIA)); }
  esperaTexto(fecha: string) {
    const d = this.diasEsperando(fecha);
    return d === 0 ? 'hoy' : d === 1 ? '1 día' : `${d} días`;
  }
  esperaClase(fecha: string) {
    const d = this.diasEsperando(fecha);
    return d >= 4 ? 'rechazado' : d >= 2 ? 'pendiente' : '';
  }
  /** 12345678-9 → 12.345.678-9 */
  rutConPuntos(rut: string) {
    const [cuerpo, dv] = rut.split('-');
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dv ? '-' + dv : '');
  }
  estadoLabel(estado: string): string { return ESTADOS[estado]?.label ?? estado; }
  estadoClase(estado: string): string { return ESTADOS[estado]?.clase ?? ''; }
}
