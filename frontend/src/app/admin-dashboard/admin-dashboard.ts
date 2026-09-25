import { Component, signal } from '@angular/core';

@Component({
  imports: [],
  selector: 'app-admin-dashboard',
  styleUrl: './admin-dashboard.scss',
  templateUrl: './admin-dashboard.html',
})
export class AdminDashboard {
  activeTab = signal<'tramites' | 'usuarios' | 'plantillas' | 'indicadores'>('tramites');

  showTab(tab: 'tramites' | 'usuarios' | 'plantillas' | 'indicadores') {
    this.activeTab.set(tab);
  }
}