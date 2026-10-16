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

  constructor(private http: HttpClient) { }

  async attemptLogin(email: string, password: string): Promise<boolean> {
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${API_URL}/auth/login`, { email, password })
      );
      this.token.set(result.token);
      this.currentRole.set(result.perfil);
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

  logout() {
    this.token.set(null);
    this.currentRole.set(null);
  }
}