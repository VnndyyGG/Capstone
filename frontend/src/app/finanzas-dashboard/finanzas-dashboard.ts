import { Component, signal } from '@angular/core';

@Component({
  imports: [],
  selector: 'app-finanzas-dashboard',
  styleUrl: './finanzas-dashboard.scss',
  templateUrl: './finanzas-dashboard.html',
})
export class FinanzasDashboard {
  activeTab = signal<'pagos' | 'comprobantes' | 'reportes'>('pagos');

  showTab(tab: 'pagos' | 'comprobantes' | 'reportes') {
    this.activeTab.set(tab);
  }
}