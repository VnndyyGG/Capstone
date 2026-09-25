const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const TRAMITES_DEMO = [
  { folio: "EO-2026-0521", cliente_email: "cliente@easyoffice.cl", documento: "Contrato de arriendo", fecha: "2026-08-28", estado: "firmado_entregado" },
  { folio: "EO-2026-0534", cliente_email: "cliente@easyoffice.cl", documento: "Declaración jurada", fecha: "2026-09-03", estado: "pendiente_firma" },
  { folio: "EO-2026-0540", cliente_email: "cliente@easyoffice.cl", documento: "Domicilio tributario", fecha: "2026-09-07", estado: "en_redaccion" },
  { folio: "EO-2026-0541", cliente_email: "cliente@easyoffice.cl", documento: "Orden de compra", fecha: "2026-09-09", estado: "pendiente_pago" },
];

app.get("/api/tramites", (req, res) => {
  const email = req.query.cliente_email;
  const resultado = email
    ? TRAMITES_DEMO.filter(t => t.cliente_email === email)
    : TRAMITES_DEMO;
  res.json(resultado);
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});