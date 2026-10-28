import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, Rol } from './auth';
import { CaseRow, Plantilla, Servicio } from './tramites';

const API = 'http://localhost:3000/api';

// ---- Modelos del panel de administración (como los devuelve el backend) ----
export type TramiteAdmin = CaseRow & { client_name: string; assigned_id: number | null; assigned_name: string | null };
export type PlantillaAdmin = Plantilla & { version: number; active: number; updated_at: string };
export interface Indicadores {
  tramitesPorEstado: { status: string; total: number }[];
  clientesActivos: number; tramitesSinAsignar: number; pagosPendientes: number;
}
export interface ReporteFinanzas { month: string; ingresos: number; pagosAprobados: number; pagosRechazados: number; ticketPromedio: number; }
export interface EventoAuditoria {
  id: number; actor_id: number | null; action: string; entity: string; entity_id: number | null;
  metadata: Record<string, unknown>; created_at: string;
}
export interface NuevoUsuario { name: string; email: string; rut: string; tipo: string; password: string; }

/** Llamadas que solo puede hacer el administrador (el backend lo vuelve a comprobar en cada ruta). */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  constructor(private http: HttpClient, private auth: Auth) {}

  private h() {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token()}` }) };
  }

  // ---- Trámites ----
  getTramites() { return this.http.get<{ items: TramiteAdmin[]; total: number }>(`${API}/tramites?limit=100`, this.h()); }
  asignar(caseId: number, assignedId: number) {
    return this.http.patch<CaseRow>(`${API}/tramites/${caseId}/asignacion`, { assignedId }, this.h());
  }

  // ---- Usuarios ----
  getUsuarios() { return this.http.get<{ items: Rol[] }>(`${API}/usuarios?limit=100`, this.h()); }
  crearUsuario(u: NuevoUsuario) { return this.http.post<Rol>(`${API}/usuarios`, u, this.h()); }
  actualizarUsuario(id: number, cambios: { tipo?: string; active?: boolean; name?: string }) {
    return this.http.patch<Rol>(`${API}/usuarios/${id}`, cambios, this.h());
  }

  // ---- Plantillas y servicios ----
  getPlantillas() { return this.http.get<{ items: PlantillaAdmin[] }>(`${API}/plantillas?active=all&limit=100`, this.h()); }
  /** expectedVersion evita pisar cambios: si otro admin la editó antes, el backend responde 409. */
  activarPlantilla(p: PlantillaAdmin, active: boolean) {
    return this.http.patch<PlantillaAdmin>(`${API}/plantillas/${p.id}`, { active, expectedVersion: p.version }, this.h());
  }
  getServicios() { return this.http.get<{ items: Servicio[] }>(`${API}/servicios`, this.h()); }
  cambiarPrecio(id: number, price: number) { return this.http.patch<Servicio>(`${API}/servicios/${id}`, { price }, this.h()); }

  // ---- Indicadores y auditoría ----
  getIndicadores() { return this.http.get<Indicadores>(`${API}/indicadores`, this.h()); }
  getReporteFinanzas(month: string) {
    return this.http.get<ReporteFinanzas>(`${API}/reportes/finanzas`, { ...this.h(), params: { month } });
  }
  getAuditoria() { return this.http.get<{ items: EventoAuditoria[] }>(`${API}/auditoria?limit=100`, this.h()); }
}
