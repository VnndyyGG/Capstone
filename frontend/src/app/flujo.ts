
export const ESTADOS: Record<string, { label: string; clase: string }> = {
  pendiente_pago: { label: 'Pendiente de pago', clase: 'pendiente' },
  en_redaccion: { label: 'En redacción', clase: 'redaccion' },
  en_revision: { label: 'En revisión', clase: 'redaccion' },
  observado: { label: 'Observado', clase: 'pendiente' },
  aprobado: { label: 'Aprobado', clase: 'aprobado' },
  pendiente_firma: { label: 'Pendiente de firma', clase: 'firma' },
  firmado: { label: 'Firmado', clase: 'completo' },
  entregado: { label: 'Entregado', clase: 'completo' },
  completado: { label: 'Completado', clase: 'completo' },
  cancelado: { label: 'Cancelado', clase: 'rechazado' },
};

export interface Paso {
  clave: string;
  label: string;
  detalle: string;
}

export function pasosDe(requiereFirma: boolean): Paso[] {
  const pasos: Paso[] = [
    { clave: 'pago', label: 'Pago', detalle: 'Transferencia verificada por Finanzas' },
    { clave: 'redaccion', label: 'Datos del documento', detalle: 'Completas los datos y se genera el documento' },
    { clave: 'revision', label: 'Revisión', detalle: 'Un ejecutivo revisa el documento' },
    { clave: 'aprobado', label: 'Aprobado', detalle: 'Documento aprobado' },
  ];
  if (requiereFirma) {
    pasos.push({ clave: 'firma', label: 'Firma electrónica', detalle: 'Firma electrónica avanzada (Ley 19.799)' });
  }
  pasos.push({ clave: 'completado', label: 'Completado', detalle: 'Trámite cerrado' });
  return pasos;
}

/** Índice del paso EN CURSO. Los anteriores se pintan como hechos. Si devuelve pasos.length, todo está hecho. */
export function indiceActual(estado: string, requiereFirma: boolean): number {
  const total = pasosDe(requiereFirma).length;
  switch (estado) {
    case 'pendiente_pago': return 0;
    case 'en_redaccion': return 1;
    case 'en_revision':
    case 'observado': return 2;
    case 'aprobado': return 4; // aprobado listo; sigue la firma (si aplica) o el cierre
    case 'pendiente_firma': return 4;
    case 'firmado': return 5;
    case 'entregado':
    case 'completado': return total;
    default: return -1; // cancelado u otro
  }
}

export function clp(n: number): string {
  return '$' + Number(n).toLocaleString('es-CL');
}

export function mensajeError(e: any): string {
  return e?.error?.error?.message || e?.error?.message || 'Ocurrió un error. Intenta nuevamente.';
}