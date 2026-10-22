// Plantillas de documentos: tipos (categorías), campos a completar y generación del texto.
// Las plantillas son texto plano con marcadores {{campo}}. Nada de esto produce HTML.
const v = require('./validation');

const CATEGORIES = {
  domicilio_tributario: 'Domicilio tributario y servicios',
  arriendos: 'Contratos de arriendo',
  societario: 'Acuerdos de accionistas y estatutos',
  poderes: 'Poderes y autorizaciones',
  general: 'General'
};
const FIELD_TYPES = ['text', 'textarea', 'email', 'number', 'rut', 'select'];
const KEY = /^[a-z][a-z0-9_]{0,59}$/;
const PLACEHOLDER = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const CLAUSES_TAG = 'clausulas';
const MAX_VALUE = { text: 500, email: 254, number: 30, rut: 15, select: 500, textarea: 5000 };

const category = value => {
  if (typeof value !== 'string' || !Object.hasOwn(CATEGORIES, value))
    v.fail(400, 'VALIDATION_ERROR', `category: use una de ${Object.keys(CATEGORIES).join(', ')}.`);
  return value;
};
const categoryLabel = key => CATEGORIES[key] || key;
const slug = value => {
  const s = v.text(value, 'slug', 80);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) v.fail(400, 'VALIDATION_ERROR', 'slug: solo minúsculas, números y guiones.');
  return s;
};

const placeholders = text => new Set([...String(text).matchAll(PLACEHOLDER)].map(m => m[1]));
const parseList = text => { try { const x = JSON.parse(text); return Array.isArray(x) ? x : []; } catch { return []; } };

function cleanFields(input, name = 'fields') {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) v.fail(400, 'VALIDATION_ERROR', `${name}: lista de hasta 100 campos.`);
  const seen = new Set();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) v.fail(400, 'VALIDATION_ERROR', `${name}[${i}]: objeto requerido.`);
    if (typeof raw.key !== 'string' || !KEY.test(raw.key) || raw.key === CLAUSES_TAG)
      v.fail(400, 'VALIDATION_ERROR', `${name}[${i}].key: minúsculas, números y _ (debe empezar con letra).`);
    if (seen.has(raw.key)) v.fail(400, 'VALIDATION_ERROR', `${name}: clave repetida "${raw.key}".`);
    seen.add(raw.key);
    const type = raw.type === undefined ? 'text' : raw.type;
    if (!FIELD_TYPES.includes(type)) v.fail(400, 'VALIDATION_ERROR', `${name}[${i}].type: use ${FIELD_TYPES.join(', ')}.`);
    const field = { key: raw.key, label: v.text(raw.label, `${name}[${i}].label`, 200), type,
      required: raw.required === undefined ? true : (typeof raw.required === 'boolean' ? raw.required : v.fail(400, 'VALIDATION_ERROR', `${name}[${i}].required: booleano.`)) };
    if (raw.group !== undefined) field.group = v.text(raw.group, `${name}[${i}].group`, 80);
    if (raw.placeholder !== undefined) field.placeholder = v.text(raw.placeholder, `${name}[${i}].placeholder`, 300, 0);
    if (raw.default !== undefined) field.default = v.text(raw.default, `${name}[${i}].default`, 500, 0);
    if (type === 'select') {
      if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 50) v.fail(400, 'VALIDATION_ERROR', `${name}[${i}].options: 1 a 50 opciones.`);
      field.options = raw.options.map((o, j) => v.text(o, `${name}[${i}].options[${j}]`, 500));
      if (field.default !== undefined && field.default !== '' && !field.options.includes(field.default))
        v.fail(400, 'VALIDATION_ERROR', `${name}[${i}].default: debe ser una de las opciones.`);
    }
    return field;
  });
}

function cleanClauses(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 50) v.fail(400, 'VALIDATION_ERROR', 'clauses: lista de hasta 50 artículos.');
  const seen = new Set();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) v.fail(400, 'VALIDATION_ERROR', `clauses[${i}]: objeto requerido.`);
    if (typeof raw.key !== 'string' || !KEY.test(raw.key) || seen.has(raw.key)) v.fail(400, 'VALIDATION_ERROR', `clauses[${i}].key inválida o repetida.`);
    seen.add(raw.key);
    const fields = cleanFields(raw.fields, `clauses[${i}].fields`), text = v.text(raw.text, `clauses[${i}].text`, 5000);
    const used = placeholders(text), keys = new Set(fields.map(f => f.key));
    for (const k of used) if (!keys.has(k)) v.fail(400, 'VALIDATION_ERROR', `clauses[${i}].text usa {{${k}}} sin declararlo en fields.`);
    return { key: raw.key, label: v.text(raw.label, `clauses[${i}].label`, 200), text, fields };
  });
}

// Todo marcador del contenido debe tener un campo declarado: evita plantillas que nunca se pueden completar.
function assertContent(content, fields, clauses) {
  const keys = new Set(fields.map(f => f.key));
  for (const k of placeholders(content)) {
    if (k === CLAUSES_TAG) { if (!clauses.length) v.fail(400, 'VALIDATION_ERROR', 'El contenido usa {{clausulas}} pero la plantilla no define artículos (clauses).'); continue; }
    if (!keys.has(k)) v.fail(400, 'VALIDATION_ERROR', `El contenido usa {{${k}}} sin declararlo en fields.`);
  }
}

function present(row, withContent = false) {
  const out = { id: row.id, slug: row.slug, name: row.name, category: row.category, categoryLabel: categoryLabel(row.category),
    description: row.description, version: row.version, active: row.active, updated_at: row.updated_at,
    fields: parseList(row.fields), clauses: parseList(row.clauses) };
  if (withContent) out.content = row.content;
  return out;
}

function formatRut(value) {
  const clean = v.rut(value); // valida dígito verificador
  const [body, dv] = clean.split('-');
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

function cleanValue(field, raw) {
  const name = `values.${field.key}`;
  if (raw === undefined || raw === null || raw === '') return field.default || '';
  if (typeof raw !== 'string') v.fail(400, 'VALIDATION_ERROR', `${name}: se requiere texto.`);
  const value = raw.replace(/\r\n/g, '\n').trim();
  if (!value) return field.default || '';
  if (value.length > MAX_VALUE[field.type]) v.fail(400, 'VALIDATION_ERROR', `${name}: máximo ${MAX_VALUE[field.type]} caracteres.`);
  // Sin caracteres de control (salvo salto de línea en textarea ni tabulación).
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) || (field.type !== 'textarea' && value.includes('\n')))
    v.fail(400, 'VALIDATION_ERROR', `${name}: contiene caracteres no permitidos.`);
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) v.fail(400, 'VALIDATION_ERROR', `${name}: correo inválido.`);
  if (field.type === 'number' && !/^[0-9][0-9.,]*$/.test(value)) v.fail(400, 'VALIDATION_ERROR', `${name}: número inválido.`);
  if (field.type === 'select' && !field.options.includes(value)) v.fail(400, 'VALIDATION_ERROR', `${name}: valor fuera de las opciones.`);
  if (field.type === 'rut') return formatRut(value);
  return value;
}

// Reemplazo en una sola pasada: un valor que contenga "{{otro}}" no se vuelve a expandir.
function fill(text, fields, input, missing, prefix = '') {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) v.fail(400, 'VALIDATION_ERROR', 'values: objeto requerido.');
  const given = input || {}, byKey = new Map(fields.map(f => [f.key, f]));
  for (const k of Object.keys(given)) if (!byKey.has(k)) v.fail(400, 'VALIDATION_ERROR', `values.${k}: campo desconocido para esta plantilla.`);
  const resolved = new Map();
  for (const f of fields) {
    const value = cleanValue(f, given[f.key]);
    resolved.set(f.key, value);
    if (!value && f.required) missing.push(prefix + f.key);
  }
  return text.replace(PLACEHOLDER, (m, k) => {
    if (!resolved.has(k)) return m;
    return resolved.get(k) || `[${byKey.get(k).label}]`;
  });
}

function render(row, body = {}) {
  const fields = parseList(row.fields), clauses = parseList(row.clauses), missing = [];
  let content = fill(row.content, fields, body.values, missing);
  if (placeholders(row.content).has(CLAUSES_TAG)) {
    const picked = body.clauses;
    if (picked !== undefined && (!Array.isArray(picked) || picked.length > 50)) v.fail(400, 'VALIDATION_ERROR', 'clauses: lista de hasta 50 artículos.');
    if (!picked || !picked.length) missing.push(CLAUSES_TAG);
    const parts = (picked || []).map((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) v.fail(400, 'VALIDATION_ERROR', `clauses[${i}]: objeto requerido.`);
      const def = clauses.find(c => c.key === item.key);
      if (!def) v.fail(400, 'VALIDATION_ERROR', `clauses[${i}].key: artículo desconocido.`);
      return `${i + 1}.- ${fill(def.text, def.fields, item.values, missing, `clauses[${i}].`)}`;
    });
    content = content.replace(`{{${CLAUSES_TAG}}}`, () => parts.join('\n\n') || `[Artículos]`);
  }
  return { content, missing, complete: missing.length === 0 };
}

module.exports = { CATEGORIES, category, categoryLabel, slug, cleanFields, cleanClauses, assertContent, present, render, placeholders, parseList };