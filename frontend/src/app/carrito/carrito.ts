import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CarritoItem, Cotizacion, Orden, Tramites } from '../tramites';
import { clp, mensajeError } from '../flujo';

@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-carrito',
  styleUrl: './carrito.scss',
  templateUrl: './carrito.html',
})
export class Carrito implements OnInit, OnDestroy {
  items = signal<CarritoItem[]>([]);
  seleccion = signal<Set<number>>(new Set());
  cotizacion = signal<Cotizacion | null>(null);
  cupon = signal('');                // lo que escribe el cliente
  cuponAplicado = signal('');        // el código que el servidor ya aceptó
  errorCupon = signal('');
  webpayActivo = signal(true);
  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  orden = signal<Orden | null>(null); // se llena al volver de Webpay (?orden=ID)
  volvioConError = signal(false);

  readonly clp = clp;
  private timer: ReturnType<typeof setInterval> | null = null;
  seleccionados = computed(() => this.items().filter(i => this.seleccion().has(i.id)));

  constructor(private api: Tramites, private route: ActivatedRoute, private router: Router) {}

  ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    const ordenId = Number(params.get('orden'));
    if (ordenId) { this.cargarOrden(ordenId); return; }
    if (params.get('pago') === 'error') this.volvioConError.set(true);
    this.cargarCarrito();
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  // ---- Carrito ----
  async cargarCarrito() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.getCarrito());
      this.items.set(r.items);
      this.webpayActivo.set(r.webpay);
      this.seleccion.set(new Set(r.items.filter(i => !i.en_proceso).map(i => i.id)));
      await this.recalcular();
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  alternar(id: number) {
    this.seleccion.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    this.recalcular();
  }

  /** El total siempre lo calcula el servidor; aquí solo se muestra. */
  async recalcular(): Promise<void> {
    const ids = [...this.seleccion()];
    if (!ids.length) { this.cotizacion.set(null); return; }
    try {
      this.cotizacion.set(await firstValueFrom(this.api.cotizar(ids, this.cuponAplicado())));
    } catch (e) {
      if (this.cuponAplicado()) { // cupón inválido: se informa y se recotiza sin él
        this.errorCupon.set(mensajeError(e));
        this.cuponAplicado.set('');
        return this.recalcular();
      }
      this.error.set(mensajeError(e));
    }
  }

  async aplicarCupon() {
    const code = this.cupon().trim();
    if (!code) return;
    this.errorCupon.set('');
    this.cuponAplicado.set(code);
    await this.recalcular();
    if (this.cuponAplicado()) this.cupon.set('');
  }
  quitarCupon() { this.cuponAplicado.set(''); this.errorCupon.set(''); this.recalcular(); }

  async pagar() {
    const ids = [...this.seleccion()];
    if (!ids.length || this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.pagarCarrito(ids, this.cuponAplicado()));
      this.irAWebpay(r.url, r.token);   // la página se reemplaza: no se vuelve a habilitar el botón
    } catch (e) {
      this.error.set(mensajeError(e));
      this.ocupado.set(false);
      this.cargarCarrito();
    }
  }

  /** Webpay exige un POST del navegador con token_ws. */
  private irAWebpay(url: string, token: string) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = 'token_ws'; input.value = token;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }

  // ---- Resultado al volver de Webpay ----
  async cargarOrden(id: number, intento = 0) {
    this.cargando.set(true);
    try {
      const o = await firstValueFrom(this.api.getOrden(id));
      this.orden.set(o);
      // "procesando": el servidor está confirmando con Webpay; se reconsulta unos segundos.
      if (o.status === 'procesando' && intento < 10) {
        this.timer = setTimeout(() => this.cargarOrden(id, intento + 1), 3000) as unknown as ReturnType<typeof setInterval>;
      }
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  volverAlCarrito() {
    this.orden.set(null);
    this.volvioConError.set(false);
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
    this.cargarCarrito();
  }
}