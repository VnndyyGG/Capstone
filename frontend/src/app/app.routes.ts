import { Routes } from '@angular/router';
import { Login } from './login/login';
import { Shell } from './shell/shell';
import { ClienteDashboard } from './cliente-dashboard/cliente-dashboard';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { ComercialDashboard } from './comercial-dashboard/comercial-dashboard';
import { FinanzasDashboard } from './finanzas-dashboard/finanzas-dashboard';

export const routes: Routes = [
  { path: '', component: Login },
  {
    path: '',
    component: Shell,
    children: [
      { path: 'cliente', component: ClienteDashboard },
      { path: 'admin', component: AdminDashboard },
      { path: 'comercial', component: ComercialDashboard },
      { path: 'finanzas', component: FinanzasDashboard },
    ]
  }
];