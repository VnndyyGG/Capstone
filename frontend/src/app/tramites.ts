import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Auth } from './auth';



const API = 'http://localhost:3000/api';

// ---- Modelos (snake_case = como los devuelve el backend) ----
export interface Tramite {
  id: number;
  folio: string;
  documento: string;
  titulo: string;
  fecha: string;
  estado: string;
  monto: number;
  requiereFirma: boolean;
}
export interface CaseRow {
  id: number; folio: string; service_name: string; title: string; details: string;
  amount: number; requires_signature: number; status: string; created_at: string; updated_at: string;
}
export interface DocumentRow { id: number; version: number; content: string; created_at: string; }
export interface AttachmentRow { id: number; name: string; sha256: string; created_at: string; }
export interface CaseDetail extends CaseRow { template_id: number | null; documents: DocumentRow[]; attachments: AttachmentRow[]; }
export interface Servicio { id: number; name: string; price: number; requires_signature: number; template_id: number | null; }

export type TipoCampo = 'text' | 'textarea' | 'email' | 'number' | 'rut' | 'select';
export interface CampoPlantilla {
  key: string; label: string; group?: string; type: TipoCampo; required: boolean;
  placeholder?: string; default?: string; options?: string[];
}
export interface ArticuloPlantilla { key: string; label: string; text: string; fields: CampoPlantilla[]; }
export interface Plantilla {
  id: number; slug: string | null; name: string; content: string;
  category: string; categoryLabel: string; description: string;
  fields: CampoPlantilla[]; clauses: ArticuloPlantilla[];
}
export interface ArticuloElegido { key: string; values: Record<string, string>; }
export interface PlantillaRender { content: string; missing: string[]; complete: boolean; }
export interface ClienteResultado { id: number; name: string; email: string; rut: string; }
export interface CaseResumen { id: number; folio: string; service_name: string; title: string; status: string; assigned_id: number | null; created_at: string; }
export interface Pago { id: number; case_id: number; order_id: number | null; amount: number; method: string; reference: string; status: 'pendiente' | 'aprobado' | 'rechazado'; reason: string | null; }
export interface Notificacion { id: number; case_id: number | null; message: string; created_at: string; }
export interface Capabilities { payments: { webpay: boolean }; firmaElectronicaAvanzada: boolean; }

// ---- Carrito, cupones y Webpay ----
export interface CarritoItem { id: number; folio: string; title: string; service_name: string; amount: number; en_proceso: boolean; }
export interface CotizacionItem { case_id: number; amount: number; paid_amount: number; folio: string; title: string; service_name: string; }
export interface Cotizacion { subtotal: number; discount: number; total: number; coupon: { code: string; amount: number } | null; items: CotizacionItem[]; }
export interface OrdenItem { case_id: number; folio: string; title: string; service_name: string; status: string; amount: number; paid_amount: number; }
export interface Orden {
  id: number; buy_order: string; status: 'iniciada' | 'procesando' | 'pagada' | 'rechazada' | 'anulada' | 'expirada';
  subtotal: number; discount: number; total: number; coupon_code: string | null;
  authorization_code: string | null; card_last4: string | null; payment_type: string | null; installments: number | null;
  created_at: string; items: OrdenItem[];
}

@Injectable({ providedIn: 'root' })
export class Tramites {
  constructor(private http: HttpClient, private auth: Auth) {}

  private h() {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token()}` }) };
  }

  // ---- Listado (lo que ya tenías, ahora con id/monto/firma) ----
  getMisTramites(): Observable<Tramite[]> {
    return this.http.get<{ items: CaseRow[] }>(`${API}/tramites`, this.h()).pipe(
      map(res => res.items.map(c => ({
        id: c.id,
        folio: c.folio,
        documento: c.service_name,
        titulo: c.title,
        fecha: c.created_at.slice(0, 10),
        estado: c.status,
        monto: c.amount,
        requiereFirma: !!c.requires_signature,
      })))
    );
  }

  // ---- Catálogo / contexto ----
  getServicios() { return this.http.get<{ items: Servicio[] }>(`${API}/servicios`, this.h()); }
  getPlantillas() {
    return this.http.get<{ items: Plantilla[]; categorias: { key: string; label: string; total: number }[] }>(`${API}/plantillas`, this.h());
  }
  /** El backend valida (RUT, correo, opciones) y devuelve el documento final. No guarda nada. */
  renderPlantilla(id: number, body: { values: Record<string, string>; clauses: ArticuloElegido[] }) {
    return this.http.post<PlantillaRender>(`${API}/plantillas/${id}/render`, body, this.h());
  }
  getCapabilities() { return this.http.get<Capabilities>(`${API}/capabilities`); }
  getPagos() { return this.http.get<{ items: Pago[] }>(`${API}/pagos`, this.h()); }
  getNotificaciones() { return this.http.get<{ items: Notificacion[] }>(`${API}/notificaciones`, this.h()); }

  // ---- Trámite ----
  crearTramite(serviceId: number, details = '') {
    return this.http.post<CaseRow>(`${API}/tramites`, { serviceId, details }, this.h());
  }
  getTramite(id: number) { return this.http.get<CaseDetail>(`${API}/tramites/${id}`, this.h()); }
  cambiarEstado(id: number, status: string, reason = '') {
    return this.http.patch<CaseRow>(`${API}/tramites/${id}/estado`, { status, reason }, this.h());
  }
  // ---- Carrito: el servidor calcula siempre los montos; el cliente solo envía qué trámites y el código del cupón ----
  getCarrito() { return this.http.get<{ items: CarritoItem[]; webpay: boolean }>(`${API}/carrito`, this.h()); }
  cotizar(caseIds: number[], coupon = '') { return this.http.post<Cotizacion>(`${API}/carrito/cotizar`, { caseIds, coupon }, this.h()); }
  pagarCarrito(caseIds: number[], coupon = '') {
    return this.http.post<{ orderId: number; url: string; token: string; total: number }>(`${API}/carrito/pagar`, { caseIds, coupon }, this.h());
  }
  getOrden(id: number) { return this.http.get<Orden>(`${API}/ordenes/${id}`, this.h()); }
  guardarDocumento(id: number, content: string, expectedVersion: number) {
    return this.http.post<DocumentRow>(`${API}/tramites/${id}/documentos`, { content, expectedVersion }, this.h());
  }
  subirAdjunto(id: number, name: string, base64: string) {
    return this.http.post<{ id: number; name: string }>(`${API}/tramites/${id}/adjuntos`, { name, base64 }, this.h());
  }


  // ---- Ejecutivo comercial: el backend ya filtra a sus trámites asignados ----
  getTramitesAsignados() {
    return this.http.get<{ items: (CaseRow & { client_name: string })[]; total: number }>(`${API}/tramites?limit=100`, this.h());
  }
  buscarClientes(q: string) {
    return this.http.get<{ items: ClienteResultado[] }>(`${API}/clientes`, { ...this.h(), params: { q } });
  }
  getTramitesDeCliente(id: number) {
    return this.http.get<{ items: CaseResumen[] }>(`${API}/clientes/${id}/tramites`, this.h());
  }

  descargar(ruta: string) {
    return this.http.get(`${API}${ruta}`, { ...this.h(), responseType: 'blob' });
  }
}