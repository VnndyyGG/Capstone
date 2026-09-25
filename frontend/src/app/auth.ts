import { Injectable, signal } from '@angular/core';

export interface Rol {
  name: string;
  role: string;
  initials: string;
  avatarBg: string;
  crumb: string;
  tipo: 'cliente' | 'admin' | 'comercial' | 'finanzas';
}

interface UsuarioDemo {
  email: string;
  password: string;
  perfil: Rol;
}

const USUARIOS_DEMO: UsuarioDemo[] = [
  {
    email: 'cliente@easyoffice.cl',
    password: '1234',
    perfil: { name: 'María José Pérez', role: 'Cliente', initials: 'MJ', avatarBg: 'linear-gradient(160deg,#22C55E,#15803D)', crumb: 'Mis trámites', tipo: 'cliente' }
  },
  {
    email: 'admin@easyoffice.cl',
    password: '1234',
    perfil: { name: 'Kevin Tamayo', role: 'Ejecutivo · Administración', initials: 'KT', avatarBg: '#6D28D9', crumb: 'Panel de administración', tipo: 'admin' }
  },
  {
    email: 'comercial@easyoffice.cl',
    password: '1234',
    perfil: { name: 'Andy Fuentes', role: 'Ejecutivo · Comercial', initials: 'AF', avatarBg: '#1D4ED8', crumb: 'Trámites asignados', tipo: 'comercial' }
  },
  {
    email: 'finanzas@easyoffice.cl',
    password: '1234',
    perfil: { name: 'Matías Oroz', role: 'Ejecutivo · Finanzas', initials: 'MO', avatarBg: '#B45309', crumb: 'Pagos y reportes', tipo: 'finanzas' }
  },
];

@Injectable({ providedIn: 'root' })
export class Auth {
  currentRole = signal<Rol | null>(null);

  attemptLogin(email: string, password: string): boolean {
    const usuario = USUARIOS_DEMO.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!usuario) return false;
    this.currentRole.set(usuario.perfil);
    return true;
  }

  logout() {
    this.currentRole.set(null);
  }
}