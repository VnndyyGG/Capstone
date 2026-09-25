# Alcance y decisiones

## Qué se encontró

- Backend: un `server.js` de 232 bytes que inicia Express; sin endpoints ni almacenamiento.
- Frontend: Angular, cuatro dashboards y `Auth` con cuatro correos/contraseña demo fija. Las tablas no consumen API.
- Administración anuncia usuarios, plantillas e indicadores, pero sus pestañas no están implementadas.
- Cliente anuncia nuevo trámite/editor, pero no tiene formularios funcionales.
- Comercial tiene un campo de búsqueda sin lógica.
- Finanzas muestra datos Webpay e indicadores estáticos.
- Las pantallas mencionan RF-09, RF-10 y RNF-04, pero los ZIP no incluyen la especificación completa de requisitos.

Por eso no se afirma que esta entrega cumpla “todo” el proyecto. Implementa una base ejecutable para las funciones visibles y registra lo que falta.

## Permisos

| Acción | Cliente | Comercial | Finanzas | Admin |
|---|---|---|---|---|
| Ver contenido de trámites | Propios | Asignados | No | Todos |
| Crear trámite | Para sí mismo | No | No | Para clientes |
| Consultar clientes y resumen de trámites | No | Sí, auditado | No | Sí |
| Asignar ejecutivo | No | No | No | Sí |
| Editar documento permitido por estado | Propios | Asignados | No | Todos |
| Aprobar revisión documental | No | Asignados | No | Todos |
| Informar transferencia | Propios | No | No | Todos |
| Revisar transferencia | No | No | Sí | Sí |
| Aprobar pago informado por sí mismo | No | No | No | No |
| Descargar comprobante interno | Propios | No | Sí | Sí |
| Gestionar usuarios/servicios/plantillas | No | No | No | Sí |
| Reportes financieros | No | No | Sí | Sí |
| Ver auditoría/indicadores | No | No | No | Sí |

Comercial puede consultar datos básicos de cualquier cliente y resúmenes de trámites para seguimiento; no obtiene el cuerpo de documentos ajenos a su asignación. Finanzas consulta pagos sin acceso a redacción ni documentos. No se usa un `clientId` enviado por un cliente para decidir qué puede ver.

## Reglas implementadas

1. Los usuarios nuevos se registran como cliente, incluso si intentan enviar un rol privilegiado.
2. El administrador inicial solo se crea por comando local, con clave elegida por el operador.
3. Trámites asociados impiden cambios de rol que dejarían referencias inconsistentes. Un comercial con trámites abiertos debe reasignarlos antes de ser desactivado.
4. Precio y requisito de firma quedan fijados al crear el trámite. Cambiar un servicio no modifica contratos anteriores.
5. Solo la revisión autorizada de un pago habilita la redacción. El cliente no puede enviar un monto propio, aprobar pagos ni saltar estados.
6. Una referencia de pago no se reutiliza. Un trámite solo puede tener un pago pendiente o aprobado. Repetir la revisión devuelve 409, sin duplicar el ingreso.
7. Los documentos se versionan con control de edición concurrente. No se modifican documentos ya en revisión, aprobados o cerrados.
8. Los adjuntos aceptan PDF con firma de archivo, hasta 2 MiB y 10 archivos por trámite. Se descargan mediante acceso autenticado. Esto es validación básica de formato, no análisis antivirus ni validación completa del PDF.
9. Se registra auditoría de mutaciones y accesos sensibles sin contraseñas, tokens ni contenido documental. La tabla bloquea UPDATE/DELETE desde la aplicación; no protege contra un administrador con control directo del archivo o del esquema.
10. Los cambios principales generan notificaciones internas. No se envían emails ni SMS.
11. Consultas parametrizadas, límites de tamaño y paginación, CORS explícito, sesiones revocables y límite de autenticación.
12. Pagos, cambios de estado y sus eventos relacionados se guardan en transacciones.

## Pendientes que requieren decisiones o recursos externos

| Pendiente | Qué se necesita |
|---|---|
| Pauta completa y reglas reales | Lista RF/RNF, campos obligatorios, tipos de servicio, responsables y excepciones |
| Webpay | Cuenta/ambiente del comercio; integración oficial de creación, confirmación, consulta, reintentos, conciliación y reembolsos; pruebas sandbox |
| Firma electrónica avanzada | Proveedor/API definidos; identificación y múltiples firmantes; callbacks autenticados, idempotencia, validación de estado y documento firmado |
| Documento final | Plantillas aprobadas por el negocio, generación PDF, identificación de firmantes y conservación del original firmado con su evidencia |
| Domicilio tributario, contabilidad, bolsas u otros servicios específicos | Reglas por servicio, cupos, vigencias, renovaciones y documentos requeridos; el catálogo genérico no automatiza estas reglas |
| Frontend | Autenticación real, guards, formularios, editor, gestión de pagos y conexión de tablas; esta entrega mantiene el frontend recibido sin editar |
| Correo y recuperación de acceso | Proveedor de correo, verificación de email y restablecimiento seguro de contraseña |
| Producción | HTTPS, dominio, proxy de confianza, disco persistente, backups/restauración, protección de datos, control operativo y monitoreo |
| Adjuntos en producción | Antivirus/cuarentena, política de retención y, según volumen, almacenamiento privado externo |
| Reportes locales | Acordar calendario financiero: esta versión agrupa por mes de verificación en UTC, no por horario de Chile |
| Métricas de reducción de tiempos/errores | Línea base y medición con procesos reales; no se pueden demostrar porcentajes solo construyendo endpoints |

SQLite facilita ejecutar y probar localmente. Se eligió para esta primera base porque no se indicó un motor. Si el proyecto exige PostgreSQL/MySQL, se debe adaptar persistencia y migraciones antes del despliegue. Esta versión está diseñada para una sola instancia Node; no ejecutar un clúster sobre el mismo archivo.

Los servicios, precios y plantilla cargados por `setup:demo` son exclusivamente ejemplos técnicos. No se implementa un sistema de notaría ni una firma legal por cambiar un estado en una tabla.
