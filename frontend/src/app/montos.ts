const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce',
  'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro',
  'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/** 0 a 999 en palabras: 451 → "cuatrocientos cincuenta y uno". */
function hasta999(n: number): string {
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100), r = n % 100;
  const decenas = r < 30 ? UNIDADES[r] : DECENAS[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNIDADES[r % 10] : '');
  return [CENTENAS[c], decenas].filter(Boolean).join(' ');
}

/** Delante de "mil", "millones" o "pesos", "uno" se acorta: "veintiún mil", "un millón". */
const corto = (s: string) => s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

/** 0 a 999.999 en palabras. */
function hasta999mil(n: number): string {
  const miles = Math.floor(n / 1000), resto = n % 1000;
  const partes = [];
  if (miles) partes.push(miles === 1 ? 'mil' : `${corto(hasta999(miles))} mil`);
  if (resto) partes.push(hasta999(resto));
  return partes.join(' ');
}

/**
 * Monto en palabras para el contrato, que ya agrega "pesos chilenos" después:
 * 450000 → "cuatrocientos cincuenta mil", 1000000 → "un millón de", 21000 → "veintiún mil".
 */
export function montoEnPalabras(n: number): string {
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1e6), resto = n % 1e6;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : `${corto(hasta999mil(millones))} millones`);
  if (resto) partes.push(hasta999mil(resto));
  return corto(partes.join(' ')) + (resto ? '' : ' de');   // "un millón de pesos", pero "un millón quinientos mil pesos"
}
