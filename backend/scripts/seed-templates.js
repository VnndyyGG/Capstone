const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, transaction } = require('../src/db');
const tpl = require('../src/templates');
const v = require('../src/validation');

(async () => {
  const force = process.argv.includes('--force');
  const dir = path.join(__dirname, '..', 'db', 'templates');
  const { templates } = JSON.parse(fs.readFileSync(path.join(dir, 'catalogo.json'), 'utf8'));
  const db = await openDatabase();
  const now = () => new Date().toISOString();
  const summary = { creadas: 0, actualizadas: 0, sinCambios: 0, servicios: 0 };
  try {
    await transaction(db, async () => {
      for (const t of templates) {
        const content = fs.readFileSync(path.join(dir, t.file), 'utf8').replace(/\r\n/g, '\n').trim();
        const fields = tpl.cleanFields(t.fields), clauses = tpl.cleanClauses(t.clauses || []);
        tpl.assertContent(content, fields, clauses);
        const data = [t.name, tpl.category(t.category), t.description || '', JSON.stringify(fields), JSON.stringify(clauses), content];
        const row = await db.one('SELECT id FROM templates WHERE slug=?', tpl.slug(t.slug));
        if (!row) {
          const id = await db.insert('INSERT INTO templates(name,category,description,fields,clauses,content,slug,updated_at) VALUES(?,?,?,?,?,?,?,?)', ...data, t.slug, now());
          await db.run('INSERT INTO audit(actor_id,action,entity,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?)', null, 'plantilla.sembrada', 'plantilla', id, JSON.stringify({ slug: t.slug }), now());
          summary.creadas++;
        } else if (force) {
          await db.run('UPDATE templates SET name=?,category=?,description=?,fields=?,clauses=?,content=?,active=1,version=version+1,updated_at=? WHERE id=?', ...data, now(), row.id);
          await db.run('INSERT INTO audit(actor_id,action,entity,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?)', null, 'plantilla.sembrada', 'plantilla', row.id, JSON.stringify({ slug: t.slug, force: true }), now());
          summary.actualizadas++;
        } else summary.sinCambios++;
        // Servicio del catálogo (lo que ve el cliente en "Nuevo trámite"), ligado a esta plantilla.
        const tplRow = await db.one('SELECT id FROM templates WHERE slug=?', tpl.slug(t.slug));
        if (t.service) {
          const name = v.text(t.service.name, 'service.name', 120), price = v.integer(t.service.price, 'service.price', 1, 100000000);
          const signature = t.service.requiresSignature ? 1 : 0;
          const svc = await db.one('SELECT id FROM services WHERE template_id=?', tplRow.id);
          if (!svc) { await db.run('INSERT INTO services(name,price,requires_signature,template_id) VALUES(?,?,?,?)', name, price, signature, tplRow.id); summary.servicios++; }
          else if (force) { await db.run('UPDATE services SET name=?,price=?,requires_signature=?,active=1 WHERE id=?', name, price, signature, svc.id); summary.servicios++; }
        }
      }
      // La plantilla genérica de demostración deja de aparecer junto a los contratos reales.
             await db.run("UPDATE templates SET active=0 WHERE slug IS NULL AND name LIKE 'DEMO:%'");
      // Igual con los servicios DEMO: se desactivan (no se borran: los trámites antiguos los referencian).
      await db.run("UPDATE services SET active=0 WHERE template_id IS NULL AND name LIKE 'DEMO:%'");
    });
    console.log(`Plantillas: ${summary.creadas} creadas, ${summary.actualizadas} actualizadas, ${summary.sinCambios} ya existían (usa --force para sobrescribirlas). Servicios del catálogo: ${summary.servicios} creados/actualizados.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });