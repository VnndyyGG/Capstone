const nodemailer = require('nodemailer');

/**
 * Envío de correos por SMTP (Gmail u otro). Si faltan SMTP_USER / SMTP_PASS en el .env,
 * no envía nada y muestra el correo en la terminal del backend: sirve para desarrollo.
 */
function createMailer() {
  const { SMTP_HOST = 'smtp.gmail.com', SMTP_PORT = '465', SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    return {
      enabled: false,
      send: async ({ to, subject, text }) => console.log(`\n[correo NO enviado: falta SMTP en .env] Para: ${to}\nAsunto: ${subject}\n${text}\n`),
    };
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return {
    enabled: true,
    send: ({ to, subject, text, html }) => transport.sendMail({ from: MAIL_FROM || `Easy Office <${SMTP_USER}>`, to, subject, text, html }),
  };
}

module.exports = { createMailer };
