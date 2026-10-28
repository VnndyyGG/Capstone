import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { clp, mensajeError } from '../flujo';
import { Agrupar, FinanzasApi, PagoVenta, ReporteVentas } from '../finanzas';

type Periodo = 'hoy' | 'semana' | 'mes' | 'anio' | 'personalizado';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** Códigos de tipo de pago que devuelve Webpay. */
const TIPOS_PAGO: Record<string, string> = {
  VD: 'Débito', VP: 'Prepago', VN: 'Crédito', VC: 'Crédito en cuotas',
  SI: '3 cuotas sin interés', S2: '2 cuotas sin interés', NC: 'Cuotas sin interés', transferencia: 'Transferencia',
};

/** Fecha local del navegador como AAAA-MM-DD (no UTC: a las 22:00 en Chile, UTC ya es mañana). */
function diaLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  imports: [FormsModule],
  selector: 'app-finanzas-dashboard',
  styleUrl: './finanzas-dashboard.scss',
  templateUrl: './finanzas-dashboard.html',
})
export class FinanzasDashboard implements OnInit {
  periodo = signal<Periodo>('mes');
  desde = signal('');
  hasta = signal('');
  reporte = signal<ReporteVentas | null>(null);
  cargando = signal(false);
  error = signal('');

  readonly clp = clp;
  readonly periodos: { key: Periodo; label: string }[] = [
    { key: 'hoy', label: 'Hoy' }, { key: 'semana', label: 'Últimos 7 días' }, { key: 'mes', label: 'Este mes' },
    { key: 'anio', label: 'Este año' }, { key: 'personalizado', label: 'Personalizado' },
  ];

  /** Hasta 2 meses se ve por día; hasta 3 años, por mes; más, por año. */
  agrupar = computed<Agrupar>(() => {
    const dias = (Date.parse(this.hasta()) - Date.parse(this.desde())) / 86400000 + 1;
    return dias <= 62 ? 'dia' : dias <= 1100 ? 'mes' : 'anio';
  });
  /** La serie con todos los días (o meses) del rango, incluidos los sin ventas, para que el gráfico no tenga huecos. */
  serie = computed(() => {
    const r = this.reporte();
    if (!r) return [];
    const valores = new Map(r.serie.map(s => [s.periodo, s]));
    const claves: string[] = [];
    const fin = new Date(r.hasta + 'T12:00:00');
    for (const d = new Date(r.desde + 'T12:00:00'); d <= fin; ) {
      const clave = this.agrupar() === 'dia' ? diaLocal(d) : this.agrupar() === 'mes' ? diaLocal(d).slice(0, 7) : String(d.getFullYear());
      if (claves.at(-1) !== clave) claves.push(clave);
      if (this.agrupar() === 'dia') d.setDate(d.getDate() + 1); else d.setMonth(d.getMonth() + 1, 1);
    }
    const max = Math.max(1, ...claves.map(c => valores.get(c)?.ingresos ?? 0));
    const cada = Math.ceil(claves.length / 12);   // como máximo ~12 etiquetas bajo el gráfico
    return claves.map((c, i) => {
      const v = valores.get(c);
      return { clave: c, etiqueta: i % cada === 0 ? this.etiqueta(c) : '', ingresos: v?.ingresos ?? 0, ventas: v?.ventas ?? 0,
        pct: ((v?.ingresos ?? 0) / max) * 100 };
    });
  });
  servicios = computed(() => {
    const r = this.reporte();
    const total = r?.actual.ingresos || 1;
    return (r?.servicios ?? []).map(s => ({ ...s, pct: Math.round((s.ingresos / total) * 100) }));
  });
  medios = computed(() => {
    const r = this.reporte();
    const total = r?.actual.ingresos || 1;
    return (r?.mediosPago ?? []).map(m => ({ ...m, label: TIPOS_PAGO[m.tipo] ?? m.tipo, pct: Math.round((m.ingresos / total) * 100) }));
  });

  constructor(private api: FinanzasApi) {}

  ngOnInit() { this.elegirPeriodo('mes'); }

  elegirPeriodo(p: Periodo) {
    this.periodo.set(p);
    if (p === 'personalizado') return;   // espera a que elija las fechas
    const hoy = new Date();
    const desde = p === 'hoy' ? hoy
      : p === 'semana' ? new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6)
      : p === 'mes' ? new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      : new Date(hoy.getFullYear(), 0, 1);
    this.desde.set(diaLocal(desde));
    this.hasta.set(diaLocal(hoy));
    this.cargar();
  }
  cambiarFechas(desde: string, hasta: string) {
    this.desde.set(desde); this.hasta.set(hasta);
    if (desde && hasta && desde <= hasta) this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      this.reporte.set(await firstValueFrom(this.api.getVentas(this.desde(), this.hasta(), this.agrupar())));
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }

  /** Variación contra el período anterior del mismo largo: "+12 %", "−5 %", "nuevo" o "". */
  variacion(actual: number, anterior: number): { texto: string; sube: boolean } {
    if (!anterior) return { texto: actual ? 'nuevo' : '', sube: true };
    const pct = Math.round(((actual - anterior) / anterior) * 100);
    return { texto: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)} %`, sube: pct >= 0 };
  }

  /** "2026-10-27" → "27 oct" · "2026-10" → "oct 2026" · "2026" → "2026" */
  etiqueta(clave: string) {
    const [a, m, d] = clave.split('-');
    return d ? `${+d} ${MESES[+m - 1]}` : m ? `${MESES[+m - 1]} ${a}` : a;
  }
  tipoPago(p: PagoVenta) {
    if (!p.tipo) return 'Transferencia';
    return (TIPOS_PAGO[p.tipo] ?? p.tipo) + (p.cuotas && p.cuotas > 1 ? ` · ${p.cuotas} cuotas` : '');
  }

  /** Descarga los pagos del período en CSV para abrir en Excel (separador ";" y BOM para que respete las tildes). */
  descargarCsv() {
    const r = this.reporte();
    if (!r) return;
    const celda = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Fecha', 'Folio', 'Cliente', 'Servicio', 'Monto', 'Cupón', 'Medio de pago', 'Tarjeta'],
      ...r.pagos.map(p => [p.fecha, p.folio, p.cliente, p.servicio, p.monto, p.cupon, this.tipoPago(p), p.tarjeta ? `**** ${p.tarjeta}` : '']),
    ];
    const csv = '\uFEFF' + filas.map(f => f.map(celda).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `ventas-${r.desde}-a-${r.hasta}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
}