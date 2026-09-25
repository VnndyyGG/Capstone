import { Component, signal } from '@angular/core';

@Component({
  imports: [],
  selector: 'app-comercial-dashboard',
  styleUrl: './comercial-dashboard.scss',
  templateUrl: './comercial-dashboard.html',
})
export class ComercialDashboard {
  activeTab = signal<'mistramites' | 'buscar'>('mistramites');

  showTab(tab: 'mistramites' | 'buscar') {
    this.activeTab.set(tab);
  }
}