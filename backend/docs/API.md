# Contrato HTTP

Base local: `http://localhost:3000/api`.

Salvo `/health`, `/capabilities`, `/auth/register` y `/auth/login`, todas las rutas requieren:

```http
Authorization: Bearer <token recibido en login>
Content-Type: application/json
```

Las fechas están en ISO 8601 UTC. Los montos son enteros CLP. Los identificadores en JSON son números. No enviar montos ni roles como fuente de autoridad desde Angular.

## Autenticación

`POST /auth/register` crea exclusivamente un cliente:

```json
{"name":"Cliente de prueba","email":"cliente@example.test","password":"una contraseña de al menos 12 caracteres","rut":"12.345.678-5"}
```

`rut` es opcional y se valida su dígito verificador cuando se envía. No equivale a una verificación de identidad. No hay verificación por correo ni recuperación de contraseña todavía.

`POST /auth/login`:

```json
{"email":"cliente@example.test","password":"la contraseña configurada"}
```

Respuesta 200 (registro 201):

```json
{
  "token":"token opaco",
  "expiresAt":"2026-09-26T01:00:00.000Z",
  "perfil":{
    "id":2,"name":"Cliente de prueba","email":"cliente@example.test","rut":"",
    "tipo":"cliente","role":"Cliente","initials":"CD","avatarBg":"#15803D",
    "crumb":"Mis trámites","active":true
  }
}
```

Los valores son ilustrativos; no constituyen credenciales válidas.

- `GET /auth/me` devuelve `{perfil}`.
- `POST /auth/logout` revoca la sesión actual, 204 sin cuerpo.
- `POST /auth/password` recibe `{currentPassword,newPassword}`, revoca todas las sesiones, 204. Volver a iniciar sesión.
- Registro/login comparten un límite de 20 solicitudes cada 15 minutos por IP. Se devuelve 429 con `Retry-After`.

## Rutas y cuerpos

En las rutas de listado paginadas se permite `?limit=50&offset=0`, máximo 100. La respuesta contiene `items`; `/tramites` también incluye `total`, `limit` y `offset`. `/servicios` devuelve el catálogo activo completo.

| Método y ruta | Rol | Cuerpo / resultado |
|---|---|---|
| GET `/health` | Público | Estado del proceso |
| GET `/capabilities` | Público | Integraciones y funciones disponibles |
| GET `/usuarios` | Admin | Perfiles, nunca claves |
| POST `/usuarios` | Admin | `{name,email,password,tipo,rut?}`; 201 |
| PATCH `/usuarios/:id` | Admin | `{name?,tipo?,active?}` |
| GET `/clientes?q=texto` | Admin, comercial | Búsqueda por nombre o RUT; comercial requiere 3 caracteres |
| GET `/clientes/:id/tramites` | Admin, comercial | Resumen de seguimiento, sin contenido de documentos |
| GET `/servicios` | Cualquier usuario | Catálogo activo |
| POST `/servicios` | Admin | `{name,price,requiresSignature}`; 201 |
| PATCH `/servicios/:id` | Admin | `{name?,price?,requiresSignature?,active?}` |
| GET `/plantillas` | Admin, comercial, cliente | Plantillas activas |
| POST `/plantillas` | Admin | `{name,content}`; 201 |
| PATCH `/plantillas/:id` | Admin | `{expectedVersion,name?,content?,active?}` |
| GET `/tramites?status=estado` | Admin, comercial, cliente | Listado filtrado por alcance del rol |
| POST `/tramites` | Cliente, admin | `{serviceId,title,details?,clientId?}`; admin debe indicar cliente; 201 |
| GET `/tramites/:id` | Según acceso | Datos, historial de documentos y metadatos de adjuntos |
| PATCH `/tramites/:id/asignacion` | Admin | `{assignedId}`; comercial activo |
| PATCH `/tramites/:id/estado` | Según acceso y transición | `{status,reason?}` |
| POST `/tramites/:id/documentos` | Según acceso | `{content,expectedVersion}`; 201 |
| GET `/tramites/:id/documentos/:documentId/descarga` | Según acceso | TXT, siempre rotulado como borrador sin firma |
| POST `/tramites/:id/adjuntos` | Según acceso | `{name,base64}`; PDF hasta 2 MiB; 201 |
| GET `/tramites/:id/adjuntos/:attachmentId/descarga` | Según acceso | Descarga privada PDF |
| POST `/tramites/:id/pagos` | Cliente propietario, admin | `{reference}`; transferencia pendiente de revisión; 201 |
| POST `/tramites/:id/webpay` | Cliente propietario, admin | 503 si el trámite admite pago: integración pendiente |
| POST `/tramites/:id/firma` | Admin, comercial asignado | 503 si aprobado y requiere FEA: integración pendiente |
| GET `/pagos` | Admin, finanzas, cliente | Cliente: solo sus pagos |
| PATCH `/pagos/:id/revision` | Admin, finanzas | `{status:"aprobado" o "rechazado",reason}` |
| GET `/pagos/:id/comprobante` | Admin, finanzas, cliente propietario | TXT interno de pago aprobado; no documento tributario |
| GET `/reportes/finanzas?month=YYYY-MM` | Admin, finanzas | Ingresos, pagos aprobados/rechazados y ticket promedio |
| GET `/indicadores` | Admin | Trámites por estado, clientes activos, sin asignar, pagos pendientes |
| GET `/auditoria` | Admin | Bitácora paginada |
| GET `/notificaciones` | Usuario propietario | Avisos internos |
| PATCH `/notificaciones/:id/leida` | Usuario propietario | 204 |

En cuerpos JSON, los nombres siguen camelCase cuando representan comandos. Los registros persistidos usan snake_case (`client_id`, `assigned_id`, `service_name`, `requires_signature`, etc.). Mantener este contrato o mapearlo en un servicio Angular.

## Flujo completo de prueba

Usar la base demo y sesiones separadas por rol:

1. Cliente consulta `/servicios` y crea `/tramites` con un servicio sin firma. El servidor copia nombre, precio y requisito de firma; estado `pendiente_pago`.
2. Cliente informa una transferencia con `/tramites/:id/pagos` y una referencia única. Esto **no confirma un pago**.
3. Finanzas verifica por fuera de la aplicación el abono y usa `/pagos/:id/revision` con `aprobado` y el motivo. Trámite pasa a `en_redaccion`. Solo probar referencias ficticias en la base demo.
4. Admin asigna el trámite a un comercial con `/tramites/:id/asignacion`.
5. Cliente o comercial asignado crea el documento con `expectedVersion:0`. Devuelve versión 1. Para guardar de nuevo debe enviar `expectedVersion:1`. Un editor desactualizado recibe 409.
6. Cliente o comercial solicita `en_revision` por `/estado`. Debe existir un documento.
7. Comercial asignado o admin revisa: `observado` con motivo, o `aprobado`.
8. Si fue observado, cliente o comercial pasa a `en_redaccion`, corrige y solicita revisión nuevamente.
9. Si el servicio no requiere firma, comercial/admin puede pasar de `aprobado` a `completado`. El TXT sigue siendo un borrador sin firma; completado representa cierre interno, no certificación externa.
10. Si requiere FEA, `/firma` informa 503. El estado permanece `aprobado`. No puede completarse ni marcarse firmado manualmente.
11. Cliente ve sus notificaciones y el comprobante interno del pago aprobado.

Para cancelar: solo desde `pendiente_pago` y sin pago pendiente/aprobado. Un pago rechazado permite cancelar o informar otra referencia. No se implementaron reembolsos ni cancelación de trámites ya pagados.

## Errores

```json
{"error":{"code":"VERSION_CONFLICT","message":"Existe una versión más reciente. Vuelve a cargar el documento."}}
```

- 400: validación, formato, JSON incorrecto.
- 401: credenciales inválidas, sesión ausente/expirada/revocada.
- 403: rol sin permiso, origen no permitido o autoaprobación de pago.
- 404: recurso inexistente o ajeno al alcance permitido.
- 409: estado inválido, duplicado, versión desactualizada o requisito pendiente.
- 413: cuerpo mayor a 3 MiB.
- 429: límite de autenticación.
- 503: integración externa no implementada.

## Próxima conexión Angular

El `Auth` actual es síncrono y usa `USUARIOS_DEMO`. Debe reemplazarse por peticiones HTTP asíncronas. Agregar `provideHttpClient()`, un servicio API, manejo de sesión, interceptor Bearer y guards por rol. El backend devuelve `perfil` compatible con los campos de la interfaz `Rol`; el rol siempre proviene del servidor.

Reemplazar las filas estáticas con `/tramites`, `/pagos` y `/reportes/finanzas`, implementar los formularios que hoy muestran “Aquí va...”, y gestionar estados de carga, errores y 409 de edición. Mostrar que Webpay/FEA no están disponibles usando `/capabilities`.

No confiar en guards Angular para proteger datos: la API ya aplica permisos. No renderizar `content` como HTML sin sanitizar; esta versión guarda texto plano. Las descargas protegidas deben obtenerse con HttpClient y `responseType:'blob'`, porque un enlace HTML normal no agrega el token Bearer.
