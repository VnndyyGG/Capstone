import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Auth } from './auth';

export interface Tramite {
  folio: string;
  documento: string;
  fecha: string;
  estado: string;
}

interface CaseRow {
  folio: string;
  service_name: string;
  created_at: string;
  status: string;
}

interface TramitesResponse {
  items: CaseRow[];
  total: number;
}

const API_URL = 'http://localhost:3000/api/tramites';

@Injectable({ providedIn: 'root' })
export class Tramites {
  constructor(private http: HttpClient, private auth: Auth) {}

  getMisTramites(): Observable<Tramite[]> {
    const headers = new HttpHeaders({
      Authorization: `Bearer ${this.auth.token()}`
    });
    return this.http.get<TramitesResponse>(API_URL, { headers }).pipe(
      map(res => res.items.map(c => ({
        folio: c.folio,
        documento: c.service_name,
        fecha: c.created_at.slice(0, 10),
        estado: c.status,
      })))
    );
  }
}