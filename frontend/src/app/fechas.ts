const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/** Los campos de texto llamados `fecha_*` se muestran con calendario. */
export const esFecha = (key: string) => key.startsWith('fecha_');

/** "2026-01-01" (lo que entrega el calendario) → "01 DE ENERO DE 2026" (como se escribe en el contrato). */
export function fechaTexto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]} DE ${MESES[+m[2] - 1]} DE ${m[1]}` : '';
}

/** "01 DE ENERO DE 2026" → "2026-01-01". Devuelve '' si el texto no tiene ese formato. */
export function fechaIso(texto: string): string {
  const m = /^(\d{1,2}) DE ([A-Z]+) DE (\d{4})$/i.exec(texto.trim());
  const mes = m ? MESES.indexOf(m[2].toUpperCase()) + 1 : 0;
  return mes ? `${m![3]}-${String(mes).padStart(2, '0')}-${m![1].padStart(2, '0')}` : '';
}

/** Suma meses a una fecha. Si el día no existe (31 de enero + 1 mes), usa el último día del mes. */
export function sumarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12), mes = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`;
}

/** Meses exactos entre dos fechas (01/01/2026 → 01/01/2027 = 12). null si no es un número entero de meses. */
export function mesesEntre(inicio: string, fin: string): number | null {
  const [y1, m1] = inicio.split('-').map(Number), [y2, m2] = fin.split('-').map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1);
  return n > 0 && sumarMeses(inicio, n) === fin ? n : null;
}
