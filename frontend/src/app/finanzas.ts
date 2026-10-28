import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth } from './auth';

const API = 'http://localhost:3000/api';

export type Agrupar = 'dia' | 'mes' | 'anio';
export interface ResumenVentas { ingresos: number; ventas: number; compras: number; descuentos: number; ticketPromedio: number; }
export interface PagoVenta {
  id: number; fecha: string; folio: string; cliente: string; servicio: string; monto: number;
  cupon: string | null; tipo: string | null; tarjeta: string | null; cuotas: number | null;
}
export interface ReporteVentas {
  desde: string; hasta: string;
  actual: ResumenVentas; anterior: ResumenVentas;
  serie: { periodo: string; ingresos: number; ventas: number }[];
  servicios: { servicio: string; ventas: number; ingresos: number }[];
  mediosPago: { tipo: string; compras: number; ingresos: number }[];
  fallidos: { ordenes: number; total: number };
  pagos: PagoVenta[];
}

@Injectable({ providedIn: 'root' })
export class FinanzasApi {
  constructor(private http: HttpClient, private auth: Auth) {}

  getVentas(desde: string, hasta: string, agrupar: Agrupar) {
    return this.http.get<ReporteVentas>(`${API}/reportes/ventas`, {
      headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token()}` }),
      params: { desde, hasta, agrupar },
    });
  }
}

