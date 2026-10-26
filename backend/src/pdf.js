// Generación de PDF: documento del trámite y comprobante de pago.
// Usa pdfkit con Liberation Serif embebida (cubre tildes, ñ y comillas tipográficas) y el logo de assets/.
const PDFDocument = require('pdfkit');
const path = require('node:path');
const crypto = require('node:crypto');

const ASSETS = path.join(__dirname, '..', 'assets');
const LOGO = path.join(ASSETS, 'logo.png');
const FONTS = {
  serif: path.join(ASSETS, 'fonts', 'LiberationSerif-Regular.ttf'),
  'serif-bold': path.join(ASSETS, 'fonts', 'LiberationSerif-Bold.ttf'),
  'serif-italic': path.join(ASSETS, 'fonts', 'LiberationSerif-Italic.ttf'),
  'serif-bolditalic': path.join(ASSETS, 'fonts', 'LiberationSerif-BoldItalic.ttf')
};
const COLOR = { green: '#15803D', ink: '#14181A', soft: '#4B5563', line: '#D5DDD8', amber: '#B45309', amberBg: '#FEF3E2' };

// Mientras no exista firma electrónica avanzada (ver POST /tramites/:id/firma), todo documento es borrador.
// Cuando se integre el proveedor de firma, pasar { borrador: false } desde el endpoint de documentos firmados.
const MARGINS = { top: 100, bottom: 86, left: 72, right: 72 };

const fechaCL = iso => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};
const clp = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n) || 0);

function nuevoPdf(info) {
  const doc = new PDFDocument({
    size: 'LETTER', margins: { ...MARGINS }, bufferPages: true,
    info: { Title: info.title, Subject: info.subject, Author: 'Easy Office', Creator: 'Portal Easy Office' }
  });
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, file);
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  return { doc, done };
}

// Encabezado, pie, numeración y marca de agua en todas las páginas (se dibuja al final, cuando ya se sabe el total).
function decorar(doc, { derecha, pie, huella, borrador }) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const W = doc.page.width, H = doc.page.height, L = MARGINS.left, R = W - MARGINS.right;
    doc.page.margins.bottom = 0; // escribir en el pie no debe provocar un salto de página

    if (borrador) {
      doc.save();
      doc.rotate(-38, { origin: [W / 2, H / 2] });
      doc.fillColor(COLOR.green).fillOpacity(0.06).font('serif-bold').fontSize(104);
      doc.text('BORRADOR', 0, H / 2 - 52, { width: W, align: 'center', lineBreak: false });
      doc.restore();
    }

    doc.image(LOGO, L, 34, { height: 38 });
    doc.fillColor(COLOR.soft).fillOpacity(1).font('Helvetica').fontSize(8.5);
    doc.text(derecha[0], L, 44, { width: R - L, align: 'right', lineBreak: false });
    doc.text(derecha[1] || '', L, 56, { width: R - L, align: 'right', lineBreak: false });
    doc.moveTo(L, 82).lineTo(R, 82).lineWidth(1.4).strokeColor(COLOR.green).stroke();

    doc.moveTo(L, H - 70).lineTo(R, H - 70).lineWidth(0.5).strokeColor(COLOR.line).stroke();
    doc.fillColor(COLOR.soft).font('Helvetica').fontSize(8);
    doc.text(pie, L, H - 62, { width: (R - L) * 0.78, align: 'left', lineBreak: false });
    doc.text(`Página ${i - start + 1} de ${count}`, L, H - 62, { width: R - L, align: 'right', lineBreak: false });
    if (huella) doc.fontSize(7).fillColor('#8A948E').text(`Huella SHA-256 del contenido: ${huella}`, L, H - 48, { width: R - L, lineBreak: false });
    doc.page.margins.bottom = MARGINS.bottom;
  }
}

// ---------- Documento del trámite ----------
const ORDINAL = new RegExp(
  '^(?:(?:D[ÉE]CIMO|DEC[ÍI]MO|VIG[ÉE]SIMO|TRIG[ÉE]SIMO)[A-ZÁÉÍÓÚ]*(?:\\s+(?:PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO))?' +
  '|PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO|[ÚU]NICO|PRELIMINAR)(?=\\s)');
const ITEM = /^[a-zA-Z0-9]{1,3}\)\s/;
const esMayusculas = s => /^[A-ZÁÉÍÓÚÑ ]{4,}$/.test(s.trim()); // "EL ARRENDADOR" sí; "RUT: 12.345.678-5" no

function cuerpo(doc, texto) {
  const ancho = doc.page.width - MARGINS.left - MARGINS.right;
  const limite = () => doc.page.height - MARGINS.bottom;
  const parrafos = texto.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  // El primer párrafo corto y sin cláusula es el título del documento.
  if (parrafos.length && !parrafos[0].includes('\n') && parrafos[0].length <= 120 && !ORDINAL.test(parrafos[0])) {
    doc.font('serif-bold').fontSize(15).fillColor(COLOR.ink).text(parrafos.shift().toUpperCase(), { align: 'center', characterSpacing: 0.6 });
    doc.moveDown(1.4);
  }

  doc.fillColor(COLOR.ink).fontSize(11);
  for (const p of parrafos) {
    const lineas = p.split('\n');
    if (lineas.length > 1) { // bloque corto (firmas, listas de datos): se mantiene junto y alineado a la izquierda
      doc.font('serif').fontSize(11);
      const alto = lineas.reduce((h, l) => h + doc.heightOfString(l || ' ', { width: ancho, lineGap: 2 }), 0);
      if (doc.y + alto > limite()) doc.addPage();
      if (lineas.some(l => /_{4,}/.test(l))) doc.moveDown(1.6);
      for (const l of lineas) doc.font(esMayusculas(l) ? 'serif-bold' : 'serif').text(l, { align: 'left', lineGap: 2 });
      doc.moveDown(0.9);
      continue;
    }
    const clausula = ORDINAL.exec(p);
    const item = !clausula && ITEM.test(p);
    const opts = { align: 'justify', lineGap: 3.2, width: ancho - (item ? 22 : 0) };
    const x = MARGINS.left + (item ? 22 : 0);
    if (doc.y + doc.heightOfString(p.slice(0, 200), { ...opts }) > limite()) doc.addPage();
    if (clausula) {
      doc.font('serif-bold').text(clausula[0] + ' ', MARGINS.left, doc.y, { ...opts, continued: true });
      doc.font('serif').text(p.slice(clausula[0].length).trimStart(), opts);
    } else {
      doc.font('serif').text(p, x, doc.y, opts);
    }
    doc.moveDown(0.7);
  }
}

function documentoPdf({ folio, version, servicio, contenido, creadoEn, borrador = true }) {
  const { doc, done } = nuevoPdf({ title: `${folio} · versión ${version}`, subject: servicio || 'Documento' });
  doc.y = MARGINS.top;
  cuerpo(doc, String(contenido ?? ''));
  const huella = crypto.createHash('sha256').update(String(contenido ?? '')).digest('hex');
  decorar(doc, {
    derecha: [`Trámite ${folio} · Versión ${version}`, servicio || ''],
    pie: borrador
      ? `Borrador sin firma electrónica · Generado el ${fechaCL(new Date())} · easyoffice.cl`
      : `Generado el ${fechaCL(new Date())} · easyoffice.cl`,
    huella: huella.slice(0, 32) + '…',
    borrador
  });
  doc.end();
  return done;
}

// ---------- Comprobante de pago ----------
function comprobantePdf({ pago, orden }) {
  const { doc, done } = nuevoPdf({ title: `Comprobante de pago ${pago.folio}`, subject: 'Comprobante interno de pago' });
  const L = MARGINS.left, W = doc.page.width - L - MARGINS.right;
  doc.y = MARGINS.top;

  doc.font('serif-bold').fontSize(18).fillColor(COLOR.ink).text('COMPROBANTE DE PAGO', { align: 'center', characterSpacing: 0.6 });
  doc.moveDown(0.6);
  const aviso = 'Comprobante interno. No corresponde a boleta ni factura.';
  doc.font('Helvetica').fontSize(9.5);
  const yAviso = doc.y;
  doc.roundedRect(L + W * 0.18, yAviso, W * 0.64, 24, 4).fill(COLOR.amberBg);
  doc.fillColor(COLOR.amber).text(aviso, L, yAviso + 7.5, { width: W, align: 'center' });
  doc.y = yAviso + 24;

  doc.moveDown(2).fillColor(COLOR.soft).font('Helvetica').fontSize(9).text('Monto pagado', { align: 'center' });
  doc.font('serif-bold').fontSize(32).fillColor(COLOR.green).text(`${clp(pago.amount)}`, { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.soft).text('Pesos chilenos (CLP)', { align: 'center' });
  doc.moveDown(1.8);

  const filas = [
    ['Trámite', pago.folio],
    ['Método de pago', pago.method === 'transferencia' ? 'Transferencia' : String(pago.method)],
    ['Referencia', pago.reference]
  ];
  if (orden) {
    filas.push(['Orden de compra', orden.buy_order]);
    filas.push(['Total de la orden', clp(orden.total)]);
    if (orden.coupon_code) filas.push(['Cupón aplicado', `${orden.coupon_code} (−${clp(orden.discount)})`]);
    filas.push(['Código de autorización', orden.authorization_code]);
    filas.push(['Tarjeta', `•••• ${orden.card_last4}`]);
  }
  filas.push(['Pago verificado el', fechaCL(pago.reviewed_at)]);

  const alto = 30;
  doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.8).strokeColor(COLOR.green).stroke();
  for (const [k, val] of filas) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.soft).text(k, L + 6, y + 10, { width: W * 0.4, lineBreak: false });
    doc.font('serif').fontSize(12).fillColor(COLOR.ink).text(String(val ?? '—'), L + W * 0.4, y + 7.5, { width: W * 0.6 - 6, align: 'right', lineBreak: false });
    doc.moveTo(L, y + alto).lineTo(L + W, y + alto).lineWidth(0.5).strokeColor(COLOR.line).stroke();
    doc.y = y + alto;
  }

  decorar(doc, {
    derecha: [`Trámite ${pago.folio}`, 'Comprobante de pago'],
    pie: `Generado el ${fechaCL(new Date())} · easyoffice.cl`,
    huella: null, borrador: false
  });
  doc.end();
  return done;
}

module.exports = { documentoPdf, comprobantePdf };
