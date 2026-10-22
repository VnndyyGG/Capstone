import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface Rol {
  id: number;
  name: string;
  email: string;
  rut: string;
  role: string;
  initials: string;
  avatarBg: string;
  crumb: string;
  tipo: 'cliente' | 'admin' | 'comercial' | 'finanzas';
  active: boolean;
}

const API_URL = 'http://localhost:3000/api';

@Injectable({ providedIn: 'root' })
export class Auth {
  currentRole = signal<Rol | null>(null);
  token = signal<string | null>(null);

  constructor(private http: HttpClient) {
    try {
      const t = sessionStorage.getItem('token');
      const p = sessionStorage.getItem('perfil');
      if (t && p) {
        this.token.set(t);
        this.currentRole.set(JSON.parse(p));
      }
    } catch { /* sin storage disponible */ }
  }

  async attemptLogin(email: string, password: string): Promise<boolean> {
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${API_URL}/auth/login`, { email, password })
      );
      this.guardarSesion(result.token, result.perfil);
      return true;
    } catch (e: any) {
      console.error('Login falló:', e.status, e.error);
      return false;
    }
  }

  async register(name: string, email: string, rut: string, password: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${API_URL}/auth/register`, { name, email, rut, password })
      );
      this.token.set(result.token);
      this.currentRole.set(result.perfil);
      return { ok: true };
    } catch (e: any) {
      console.error('Registro falló:', e.status, JSON.stringify(e.error));
      const msg = e.error?.error?.message || e.error?.message || 'No se pudo crear la cuenta.';
      return { ok: false, message: msg };
    }
  }

  private guardarSesion(token: string, perfil: Rol) {
    this.token.set(token);
    this.currentRole.set(perfil);
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('perfil', JSON.stringify(perfil));
  }

  logout() {
    const token = this.token();
    if (token) {
      this.http.post(`${API_URL}/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      }).subscribe({ error: () => { } });
    }
    this.token.set(null);
    this.currentRole.set(null);
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('perfil');
  }
}