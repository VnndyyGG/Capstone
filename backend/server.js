const { createApp } = require('./src/app');
const { openDatabase } = require('./src/db');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválido');
const db = openDatabase(process.env.DB_PATH || './data/easyoffice.sqlite');
const app = createApp(db);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`API Easy Office en http://${process.env.HOST || '127.0.0.1'}:${port}/api/health`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
