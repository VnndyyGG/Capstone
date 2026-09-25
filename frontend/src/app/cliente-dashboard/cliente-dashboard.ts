import { Component, OnInit, signal } from '@angular/core';
import { Tramites, Tramite } from '../tramites';

const ESTADOS: Record<string, { label: string; clase: string }> = {
  pendiente_pago: { label: 'Pendiente de pago', clase: 'pendiente' },
  en_redaccion: { label: 'En redacción', clase: 'redaccion' },
  en_revision: { label: 'En revisión', clase: 'redaccion' },
  observado: { label: 'Observado', clase: 'pendiente' },
  aprobado: { label: 'Aprobado', clase: 'firma' },
  completado: { label: 'Completado y entregado', clase: 'completo' },
  cancelado: { label: 'Cancelado', clase: 'pendiente' },
};

@Component({
  imports: [],
  selector: 'app-cliente-dashboard',
  styleUrl: './cliente-dashboard.scss',
  templateUrl: './cliente-dashboard.html',
})
export class ClienteDashboard implements OnInit {
  activeTab = signal<'listado' | 'nuevo' | 'editar'>('listado');
  tramites = signal<Tramite[]>([]);
  cargando = signal(true);
  error = signal(false);

  constructor(private tramitesService: Tramites) {}

  ngOnInit() {
    this.tramitesService.getMisTramites().subscribe({
      next: (data) => { this.tramites.set(data); this.cargando.set(false); },
      error: () => { this.error.set(true); this.cargando.set(false); }
    });
  }

  showTab(tab: 'listado' | 'nuevo' | 'editar') { this.activeTab.set(tab); }

  estadoLabel(estado: string): string {
    return ESTADOS[estado]?.label ?? estado;
  }

  estadoClase(estado: string): string {
    return ESTADOS[estado]?.clase ?? '';
  }
}