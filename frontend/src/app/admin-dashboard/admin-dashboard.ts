import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Rol } from '../auth';
import { Servicio } from '../tramites';
import { ESTADOS, clp, mensajeError } from '../flujo';
import { AdminApi, EventoAuditoria, Indicadores, NuevoUsuario, PlantillaAdmin, ReporteFinanzas, TramiteAdmin } from '../admin';

type Tab = 'tramites' | 'usuarios' | 'plantillas' | 'indicadores' | 'auditoria';
/** Estados en los que el trámite ya terminó: no se reasigna. */
const CERRADOS = ['completado', 'entregado', 'cancelado'];
/** Antes de pagar no hay ejecutivo: se asigna solo cuando el pago pasa el trámite a revisión. */
const SIN_PAGAR = ['borrador', 'pendiente_pago'];
const ROLES = [
  { key: 'cliente', label: 'Cliente' },
  { key: 'comercial', label: 'Ejecutivo comercial' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'admin', label: 'Administrador' },
];
/** Nombre legible de cada acción registrada en la auditoría. */
const ACCIONES: Record<string, string> = {
  'auth.login': 'Inició sesión', 'auth.logout': 'Cerró sesión', 'auth.fallo': 'Intento de inicio fallido', 'auth.password': 'Cambió su contraseña',
  'usuario.registro': 'Se registró', 'usuario.creado': 'Creó un usuario', 'usuario.actualizado': 'Actualizó un usuario',
  'tramite.creado': 'Creó un trámite', 'tramite.consulta': 'Consultó un trámite', 'tramite.asignacion': 'Asignó un trámite',
  'tramite.estado': 'Cambió el estado de un trámite', 'documento.version': 'Guardó una versión del documento',
  'plantilla.creada': 'Creó una plantilla', 'plantilla.actualizada': 'Actualizó una plantilla',
  'servicio.creado': 'Creó un servicio', 'servicio.actualizado': 'Actualizó un servicio',
  'cliente.busqueda': 'Buscó clientes', 'cliente.tramites.consulta': 'Consultó los trámites de un cliente',
  'reporte.finanzas': 'Consultó el reporte de finanzas',
  'documento.descarga': 'Descargó un documento', 'adjunto.creado': 'Subió un adjunto', 'adjunto.descarga': 'Descargó un adjunto',
  'orden.creada': 'Inició un pago', 'pago.webpay': 'Pagó con Webpay', 'orden.rechazada': 'Pago rechazado por Webpay',
  'orden.abandonada': 'Abandonó el pago', 'orden.commit_incierto': 'Pago sin confirmar', 'orden.reembolsada': 'Pago reembolsado',
  'orden.reembolso_pendiente': 'Reembolso pendiente', 'pago.revisado': 'Revisó un pago', 'pago.comprobante': 'Descargó un comprobante',
  'cupon.creado': 'Creó un cupón', 'cupon.estado': 'Cambió el estado de un cupón', 'notificacion.leida': 'Leyó una notificación',
};

@Component({
  imports: [FormsModule],
  selector: 'app-admin-dashboard',
  styleUrl: './admin-dashboard.scss',
  templateUrl: './admin-dashboard.html',
})
export class AdminDashboard implements OnInit {
  activeTab = signal<Tab>('tramites');
  cargando = signal(true);
  error = signal('');
  aviso = signal('');
  ocupado = signal(false);

  tramites = signal<TramiteAdmin[]>([]);
  usuarios = signal<Rol[]>([]);
  plantillas = signal<PlantillaAdmin[]>([]);
  servicios = signal<Servicio[]>([]);
  indicadores = signal<Indicadores | null>(null);
  reporte = signal<ReporteFinanzas | null>(null);
  auditoria = signal<EventoAuditoria[] | null>(null);

  // Filtros
  filtroEstado = signal('');
  buscarTramite = signal('');
  filtroRol = signal('');
  mes = signal(new Date().toISOString().slice(0, 7));

  // Formularios
  mostrarNuevo = signal(false);
  nuevo: NuevoUsuario = { name: '', email: '', rut: '', tipo: 'comercial', password: '' };
  precios: Record<number, number> = {};

  readonly clp = clp;
  readonly roles = ROLES;
  readonly estados = Object.entries(ESTADOS).map(([key, e]) => ({ key, label: e.label }));

  /** Ejecutivos comerciales activos: los únicos a quienes se puede asignar un trámite. */
  ejecutivos = computed(() => this.usuarios().filter(u => u.tipo === 'comercial' && u.active));
  tramitesFiltrados = computed(() => {
    const estado = this.filtroEstado(), q = this.buscarTramite().trim().toLowerCase();
    return this.tramites().filter(t =>
      (!estado || t.status === estado) &&
      (!q || t.folio.toLowerCase().includes(q) || t.client_name.toLowerCase().includes(q)));
  });
  usuariosFiltrados = computed(() => this.usuarios().filter(u => !this.filtroRol() || u.tipo === this.filtroRol()));
  activos = computed(() => this.tramites().filter(t => !CERRADOS.includes(t.status)).length);
  /** Trámites pagados que quedaron sin ejecutivo (por ejemplo, si no había ninguno activo al pagar). */
  sinAsignar = computed(() => this.tramites().filter(t => !t.assigned_id && this.puedeReasignar(t)).length);
  /** Para las barras del gráfico: cada estado como porcentaje del estado con más trámites. */
  porEstado = computed(() => {
    const filas = [...(this.indicadores()?.tramitesPorEstado ?? [])].sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...filas.map(f => f.total));
    return filas.map(f => ({ ...f, label: this.estadoLabel(f.status), pct: Math.round((f.total / max) * 100) }));
  });
  private nombres = computed(() => new Map(this.usuarios().map(u => [u.id, u.name])));

  constructor(private api: AdminApi) {}

  ngOnInit() { this.cargarTodo(); }

  async cargarTodo() {
    this.cargando.set(true);
    try {
      const [t, u, p, s, i] = await Promise.all([
        firstValueFrom(this.api.getTramites()), firstValueFrom(this.api.getUsuarios()),
        firstValueFrom(this.api.getPlantillas()), firstValueFrom(this.api.getServicios()),
        firstValueFrom(this.api.getIndicadores()),
      ]);
      this.tramites.set(t.items); this.usuarios.set(u.items); this.plantillas.set(p.items);
      this.servicios.set(s.items); this.indicadores.set(i);
      this.precios = Object.fromEntries(s.items.map(x => [x.id, x.price]));
      this.error.set('');
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  showTab(tab: Tab) {
    this.activeTab.set(tab);
    this.aviso.set('');
    if (tab === 'indicadores' && !this.reporte()) this.cargarReporte();
    if (tab === 'auditoria') this.cargarAuditoria();   // siempre fresca: muestra lo último que pasó
  }

  /** Ejecuta una acción, muestra el resultado y recarga los datos. Un solo lugar para manejar errores. */
  private async accion(fn: () => Promise<unknown>, ok: string) {
    this.ocupado.set(true);
    this.error.set(''); this.aviso.set('');
    try {
      await fn();
      this.aviso.set(ok);
      await this.cargarTodo();
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  // ---- Trámites ----
  puedeReasignar(t: TramiteAdmin) { return !CERRADOS.includes(t.status) && !SIN_PAGAR.includes(t.status); }
  esSinPagar(t: TramiteAdmin) { return SIN_PAGAR.includes(t.status); }
  reasignar(t: TramiteAdmin, ejecutivoId: string) {
    if (!ejecutivoId) return;
    const nombre = this.nombres().get(Number(ejecutivoId));
    return this.accion(() => firstValueFrom(this.api.asignar(t.id, Number(ejecutivoId))), `${t.folio} asignado a ${nombre}.`);
  }

  // ---- Usuarios ----
  cambiarRol(u: Rol, tipo: string) {
    return this.accion(() => firstValueFrom(this.api.actualizarUsuario(u.id, { tipo })), `Rol de ${u.name} actualizado.`);
  }
  cambiarActivo(u: Rol) {
    const accion = u.active ? 'desactivar' : 'activar';
    if (u.active && !confirm(`¿Desactivar a ${u.name}? No podrá iniciar sesión.`)) return;
    return this.accion(() => firstValueFrom(this.api.actualizarUsuario(u.id, { active: !u.active })),
      `${u.name}: cuenta ${accion === 'desactivar' ? 'desactivada' : 'activada'}.`);
  }
  crearUsuario() {
    const n = this.nuevo;
    if (!n.name.trim() || !n.email.trim() || !n.rut.trim() || !n.password) { this.error.set('Completa todos los campos.'); return; }
    return this.accion(async () => {
      await firstValueFrom(this.api.crearUsuario({ ...n, name: n.name.trim(), email: n.email.trim() }));
      this.nuevo = { name: '', email: '', rut: '', tipo: 'comercial', password: '' };
      this.mostrarNuevo.set(false);
    }, `Usuario ${n.name.trim()} creado.`);
  }

  // ---- Plantillas y servicios ----
  cambiarPlantilla(p: PlantillaAdmin) {
    return this.accion(() => firstValueFrom(this.api.activarPlantilla(p, !p.active)),
      `Plantilla ${p.active ? 'desactivada' : 'activada'}: ${p.name}.`);
  }
  guardarPrecio(s: Servicio) {
    const precio = Math.round(Number(this.precios[s.id]));
    if (!(precio >= 1)) { this.error.set('El precio debe ser un número mayor que 0.'); return; }
    return this.accion(() => firstValueFrom(this.api.cambiarPrecio(s.id, precio)), `Precio de "${s.name}" actualizado a ${clp(precio)}.`);
  }
  precioCambiado(s: Servicio) { return Number(this.precios[s.id]) !== s.price; }

  // ---- Indicadores y auditoría ----
  async cargarReporte() {
    try { this.reporte.set(await firstValueFrom(this.api.getReporteFinanzas(this.mes()))); }
    catch (e) { this.error.set(mensajeError(e)); }
  }
  cambiarMes(m: string) { this.mes.set(m); if (m) this.cargarReporte(); }
  async cargarAuditoria() {
    try { this.auditoria.set((await firstValueFrom(this.api.getAuditoria())).items); }
    catch (e) { this.error.set(mensajeError(e)); }
  }
  accionLabel(a: string) { return ACCIONES[a] ?? a; }
  actor(id: number | null) { return id === null ? 'Sistema' : this.nombres().get(id) ?? `Usuario #${id}`; }

  // ---- Formato ----
  estadoLabel(estado: string) { return ESTADOS[estado]?.label ?? estado; }
  estadoClase(estado: string) { return ESTADOS[estado]?.clase ?? ''; }
  rolLabel(tipo: string) { return ROLES.find(r => r.key === tipo)?.label ?? tipo; }
  fecha(iso: string) { return iso.slice(0, 16).replace('T', ' '); }
}
