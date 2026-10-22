import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Servicio, Tramites, Tramite } from '../tramites';
import { ESTADOS, clp, mensajeError } from '../flujo';
import { TramiteDetalle } from '../tramite-detalle/tramite-detalle';

@Component({
  imports: [FormsModule, TramiteDetalle],
  selector: 'app-cliente-dashboard',
  styleUrl: './cliente-dashboard.scss',
  templateUrl: './cliente-dashboard.html',
})
export class ClienteDashboard implements OnInit {
  activeTab = signal<'listado' | 'nuevo'>('listado');
  tramites = signal<Tramite[]>([]);
  cargando = signal(true);
  error = signal(false);

  // Trámite abierto (vista de detalle con el flujo)
  seleccionado = signal<number | null>(null);

  // Formulario "nuevo trámite"
  servicios = signal<Servicio[]>([]);
  servicioId = signal<number | null>(null);
  titulo = signal('');
  detalles = signal('');
  creando = signal(false);
  errorNuevo = signal('');

  readonly clp = clp;

  constructor(private tramitesService: Tramites) {}

  ngOnInit() {
    this.cargarListado();
    this.tramitesService.getServicios().subscribe({
      next: r => this.servicios.set(r.items),
      error: () => { /* el formulario mostrará la lista vacía */ },
    });
  }

  cargarListado() {
    this.tramitesService.getMisTramites().subscribe({
      next: (data) => { this.tramites.set(data); this.cargando.set(false); this.error.set(false); },
      error: () => { this.error.set(true); this.cargando.set(false); }
    });
  }

  showTab(tab: 'listado' | 'nuevo') { this.activeTab.set(tab); }
  abrir(id: number) { this.seleccionado.set(id); }
  cerrarDetalle() { this.seleccionado.set(null); this.cargarListado(); }

  async crear() {
    const sid = this.servicioId();
    if (sid === null || !this.titulo().trim()) {
      this.errorNuevo.set('Elige un servicio e indica un título.');
      return;
    }
    this.creando.set(true);
    this.errorNuevo.set('');
    try {
      const nuevo = await firstValueFrom(
        this.tramitesService.crearTramite(sid, this.titulo().trim(), this.detalles().trim())
      );
      this.titulo.set(''); this.detalles.set(''); this.servicioId.set(null);
      this.cargarListado();
      this.activeTab.set('listado');
      this.seleccionado.set(nuevo.id); // lo lleva directo al paso de pago
    } catch (e) {
      this.errorNuevo.set(mensajeError(e));
    } finally {
      this.creando.set(false);
    }
  }

  estadoLabel(estado: string): string { return ESTADOS[estado]?.label ?? estado; }
  estadoClase(estado: string): string { return ESTADOS[estado]?.clase ?? ''; }
}