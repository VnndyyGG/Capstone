import { Component, signal } from '@angular/core';

@Component({
  imports: [],
  selector: 'app-cliente-dashboard',
  styleUrl: './cliente-dashboard.scss',
  templateUrl: './cliente-dashboard.html',
})
export class ClienteDashboard {
  activeTab = signal<'listado' | 'nuevo' | 'editar'>('listado');

  showTab(tab: 'listado' | 'nuevo' | 'editar') {
    this.activeTab.set(tab);
  }
}