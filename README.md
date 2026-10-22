# Portal Easy Office — Notaría virtual

Sistema web para **EasyOffice SpA** ([easyoffice.cl](https://easyoffice.cl)) que automatiza y centraliza la contratación de servicios en línea, la gestión documental (notaría virtual) y el seguimiento de trámites. Proyecto Capstone de Ingeniería en Informática, Duoc UC (sede San Bernardo).

> **Estado:** base ejecutable en desarrollo (Sprint 1 en adelante). Webpay y firma electrónica avanzada **aún no están integrados**; ver [Estado y pendientes](#estado-y-pendientes).

---

## Contexto

### El cliente
EasyOffice SpA es una empresa de servicios relacionados con trámites notariales y documentos (firmas electrónicas, domicilio tributario, contabilidad, asesoría a empresas). Hoy su proceso es **manual, sobre planillas Excel**, y su sitio web solo entrega información: no permite pago ni contratación en línea.

### El problema
- Contratación y generación de documentos manual y lenta.
- Errores por gestión manual de datos.
- Información de clientes y trámites dispersa.
- Sin pago en línea ni seguimiento del estado de cada trámite.

### Objetivo
Desarrollar un sistema web que permita:
- Contratar servicios en línea.
- Gestionar documentos (notaría virtual) a partir de plantillas.
- Emitir documentos con firma electrónica avanzada (integrando un proveedor, no construyéndola desde cero).
- Dar a los ejecutivos de EasyOffice un panel de gestión.

**Metas del proyecto** (objetivos a medir con procesos reales, no resultados ya demostrados):
- Reducir entre 70 % y 90 % los tiempos de ejecución de los procesos.
- Reducir en 90 % los errores derivados de la gestión manual.
- Centralizar clientes y trámites en una sola plataforma.
- Obtener documentación y certificados de forma rápida o inmediata.

### Alcance funcional
Solicitud y pago en línea de **5 tipos de documento**:
1. Contrato de servicio
2. Domicilio tributario
3. Contrato de arriendo
4. Orden de compra
5. Declaración jurada

Con generación desde plantillas, firma electrónica avanzada, pago con Webpay Plus (Transbank) y panel para ejecutivos. Cobertura geográfica: regiones Metropolitana y Valparaíso. Volumen de referencia: 5 clientes al día.

**Fuera de alcance:** la creación de empresas (la realiza una persona, no se automatiza). El portal integra los servicios existentes de EasyOffice; no reemplaza una notaría ni otorga validez legal por cambiar un estado en una tabla.

Base legal considerada para el alcance de los documentos: Ley 21.582 (desnotarización).

### Madurez tecnológica (TRL)
Estado actual: **TRL 4** (validado en laboratorio). Objetivo: **TRL 6** (demostrado en entorno relevante, con clientes piloto de EasyOffice en flujos de contratación, pago y seguimiento).

---

## Roles y permisos

| Acción | Cliente | Comercial | Finanzas | Admin |
|---|---|---|---|---|
| Ver contenido de trámites | Propios | Asignados | No | Todos |
| Crear trámite | Para sí mismo | No | No | Para clientes |
| Consultar clientes y su resumen de trámites | No | Sí (auditado) | No | Sí |
| Asignar ejecutivo | No | No | No | Sí |
| Editar documento (según estado) | Propios | Asignados | No | Todos |
| Aprobar revisión documental | No | Asignados | No | Todos |
| Informar transferencia | Propios | No | No | Todos |
| Revisar transferencia | No | No | Sí | Sí |
| Descargar comprobante interno | Propios | No | Sí | Sí |
| Gestionar usuarios, servicios y plantillas | No | No | No | Sí |
| Reportes financieros | No | No | Sí | Sí |
| Auditoría e indicadores | No | No | No | Sí |

Los registros nuevos siempre se crean como **cliente**. El primer administrador se crea solo por comando local.

---

## Flujo de un trámite

```
pendiente_pago ──(pago aprobado por Finanzas)──► en_redaccion ──► en_revision ──► aprobado ──► completado
      │                                               ▲               │
      └──► cancelado                                  └── observado ◄─┘
```

1. El cliente elige un servicio y crea el trámite (el servidor fija nombre, precio y requisito de firma).
2. El cliente informa una transferencia con una referencia única. Esto **no confirma** el pago.
3. Finanzas verifica el abono y aprueba o rechaza. Al aprobar, el trámite pasa a redacción.
4. El cliente o el comercial asignado redacta el documento. Cada guardado crea una **versión nueva**, con control de edición concurrente (un editor desactualizado recibe 409).
5. Se envía a revisión; el comercial asignado o un admin lo **aprueba** u **observa** (con motivo).
6. Si el servicio no requiere firma, se puede completar. Si requiere firma electrónica avanzada, el trámite queda en `aprobado` hasta integrar el proveedor.

El TXT que se descarga siempre va rotulado como **borrador sin firma electrónica**.

---

## Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | Angular (componentes standalone, signals), SCSS |
| Backend | Node.js (≥ 24) + Express 5, API REST |
| Base de datos | PostgreSQL (`pg`); el esquema vive en `backend/db/schema.sql` |
| Autenticación | Sesiones con token opaco Bearer, revocables |

```
.
├── backend/
│   ├── server.js
│   ├── src/              # app.js (rutas), db.js, security.js, validation.js
│   ├── db/schema.sql     # esquema de tablas
│   ├── scripts/setup.js  # crea el admin inicial y datos demo
│   └── docs/
│       ├── API.md        # contrato HTTP
│       └── ALCANCE.md    # decisiones, permisos y pendientes
└── frontend/
    └── src/app/          # login, shell, dashboards por rol, editor de documentos
```

### Seguridad implementada
- Consultas parametrizadas, límites de tamaño y paginación, CORS explícito.
- Sesiones revocables y límite de intentos en registro/login (20 cada 15 min por IP).
- Auditoría de mutaciones y accesos sensibles (sin contraseñas, tokens ni contenido de documentos).
- Adjuntos: solo PDF validado por firma de archivo, hasta 2 MiB y 10 por trámite, con descarga autenticada.
- Pagos, cambios de estado y eventos relacionados en transacciones.

---

## Puesta en marcha

### Requisitos
- Node.js 24 o superior
- PostgreSQL

### Backend

```bash
cd backend
npm install
```


Crea las tablas con `db/schema.sql` (el backend no las crea por sí solo) y luego:

```bash
npm run setup        # crea el administrador inicial
npm run setup:demo   # además carga servicios, plantilla y usuarios de ejemplo (solo desarrollo)
npm start            # http://127.0.0.1:3000/api/health
```

Los datos de `setup:demo` son ejemplos técnicos, no servicios ni precios reales.

### Frontend

```bash
cd frontend
npm install
npm start            # http://localhost:4200
```

El frontend espera la API en `http://localhost:3000/api`.

---

## API

Documentación completa en [`backend/docs/API.md`](backend/docs/API.md). Resumen de los grupos de rutas (base `/api`):

| Grupo | Rutas principales |
|---|---|
| Autenticación | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me`, `POST /auth/password` |
| Trámites | `GET/POST /tramites`, `GET /tramites/:id`, `PATCH /tramites/:id/estado`, `/asignacion` |
| Documentos | `POST /tramites/:id/documentos`, `GET …/documentos/:documentId/descarga` |
| Adjuntos | `POST /tramites/:id/adjuntos`, `GET …/adjuntos/:attachmentId/descarga` |
| Pagos | `POST /tramites/:id/pagos`, `GET /pagos`, `PATCH /pagos/:id/revision` |
| Catálogos | `GET/POST/PATCH /servicios`, `/plantillas` |
| Administración | `/usuarios`, `/clientes`, `/auditoria`, `/indicadores`, `/reportes/finanzas` |
| Estado del sistema | `GET /health`, `GET /capabilities` |

Las descargas están protegidas con Bearer, por lo que el frontend las pide como `blob` con `HttpClient` en lugar de usar un enlace directo.

---

## Estado y pendientes

**Implementado**
- API con roles, trámites, documentos versionados, adjuntos, pagos por transferencia manual, notificaciones internas y auditoría.
- Frontend: login y registro, shell por rol, listado de trámites del cliente, formulario de nuevo trámite y editor de documentos.

**Pendiente**
- Integración con **Webpay Plus** (cuenta/ambiente del comercio, confirmación, conciliación, reembolsos).
- **Firma electrónica avanzada** (proveedor/API definido, múltiples firmantes, callbacks autenticados).
- Generación del documento final en PDF a partir de plantillas aprobadas por el negocio.
- Registro de usuarios con **ClaveÚnica**.
- Formularios dinámicos por tipo de documento y plantillas reales de EasyOffice.
- Conectar al frontend los paneles de comercial, finanzas y admin (hoy con datos estáticos).
- Verificación de correo y recuperación de contraseña.
- Producción: HTTPS, dominio, backups, antivirus para adjuntos, monitoreo.
- Medición de tiempos y errores con procesos reales para validar las metas.

Detalle de decisiones y pendientes en [`backend/docs/ALCANCE.md`](backend/docs/ALCANCE.md).

---

## Equipo

Proyecto Capstone, Duoc UC — Ingeniería en Informática, sede San Bernardo.

- Kevin Tamayo
- Matías Oroz
- Andy Fuentes Leal

Cliente: **EasyOffice SpA**.