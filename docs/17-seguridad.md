# 17 · Seguridad: vulnerabilidades, monitoreo y qué hacer ante un hackeo

> Auditoría del 29/09/2026. Todo lo descrito está probado automáticamente en `qa/specs/15-datos-maliciosos`,
> `qa/specs/16-seguridad`, `qa/specs/14-sesion` y `tests/unit/seguridad.test.js`.

## 1. Auditoría realizada

| Revisión | Resultado |
|---|---|
| Dependencias (`npm audit`) | 0 vulnerabilidades conocidas |
| Contraseñas o claves en el historial de git | Ninguna real (solo valores de ejemplo en pruebas) |
| Inyección SQL | Todas las consultas usan parámetros; ningún dato del usuario se pega en el SQL |
| Inyección de HTML/JS (XSS) | Toda la interfaz escapa lo que muestra; la página del QR también |
| Acceso a datos ajenos (IDOR) | Cada envío, reclamo, pago, destinatario y dirección verifica al dueño; responde 404 sin confirmar que existe |
| Barrido con datos maliciosos | Todas las rutas × 3 perfiles × ~20 tipos de datos basura (miles de peticiones): **0 errores internos** |

## 2. Vulnerabilidades y errores encontrados y corregidos

| # | Hallazgo | Riesgo | Corrección |
|---|---|---|---|
| V1 | **Inyección de fórmulas en Excel**: un nombre como `=HYPERLINK(...)` se ejecutaba al abrir la exportación CSV | Robo de datos o enlaces maliciosos en el computador de administración | Los textos que empiezan con `= + - @` se exportan como texto |
| V2 | Algoritmo de la firma de sesión no fijado | Falsificación de sesiones por confusión de algoritmos | Solo se acepta HS256; `alg: none` y firmas ajenas se rechazan y se registran |
| V3 | El servidor arrancaba con la **clave de firma de ejemplo** si faltaba `NODE_ENV` | Cualquiera podría fabricar una sesión de administrador | Con inicio de sesión fuera del propio equipo exige una clave propia de 32+ caracteres |
| V4 | **Cuentas demo con contraseña pública** (`Demo.2026`) | Acceso con cuentas conocidas | En producción con inicio de sesión quedan sin acceso; `SEED_DEMO=false` obligatorio |
| V5 | Sin límite de peticiones (salvo el inicio de sesión) | Robots, raspado masivo de datos, caída del servicio | Límite por IP y minuto: 600 API, 120 páginas públicas, 30 subidas, 20 inicios de sesión |
| V6 | PDF subido por usuarios se abría dentro del dominio de la plataforma | Un PDF manipulado podría actuar en la app | Los PDF se descargan; las imágenes se entregan aisladas (`CSP: sandbox`, `nosniff`) |
| V7 | Descargas de fotos y boletas **sin saber quién** | No se podía investigar una fuga | El enlace firmado incluye al usuario: cada descarga queda atribuida; alterarlo invalida la firma |
| V8 | Contraseñas débiles aceptadas (`12345678`) | Adivinación de contraseñas | Mínimo 8, letras y números, sin contraseñas comunes, sin incluir el correo o el nombre |
| V9 | Formularios sin límite de campos | Agotar la memoria del servidor | Máximo 40 campos de 64 KB por formulario |
| V10 | Bitácoras modificables | Un intruso podría borrar sus huellas | `evento_seguridad`, `auditoria` y `pago_evento` no se pueden modificar, borrar ni vaciar (ni desde la app) |
| E1 | Carácter nulo (`\u0000`) en cualquier texto → error interno en 8 rutas | Caída de funciones | Se rechaza con 400 en toda la API |
| E2 | Cuerpo de más de 1 MB o archivo en un campo equivocado → error interno | Caída de funciones | 413 / 400 con mensaje claro |
| E3 | Editar una dirección con datos inválidos desmarcaba la principal de todas y luego fallaba | Datos a medio cambiar | Validación estricta y transacción |
| E4 | Agregar dirección con valores que no son texto → error interno | Caída de funciones | Se convierten y validan |
| E5 | Textos largos sin espacios (correos, números) ensanchaban la pantalla del celular | Interfaz rota | Corte automático de palabras en toda la app |

## 3. Sistema de monitoreo: Administración → **Seguridad**

Todo lo sensible queda en la bitácora `evento_seguridad` (fecha, tipo, usuario, cuenta objetivo, IP, navegador,
ruta y **cantidad de registros o archivos extraídos**). Las reglas revisan la bitácora en cada evento y abren
**alertas**; las críticas se pueden enviar al instante a Slack, Discord, Google Chat o n8n con `SEGURIDAD_WEBHOOK_URL`.

| Regla | Se activa cuando… | Nivel |
|---|---|---|
| Fuerza bruta | 20 contraseñas incorrectas desde una IP en 15 min | Crítica |
| Prueba de contraseñas | Una IP intenta en 5 cuentas distintas en 1 hora | Crítica |
| Cuenta bloqueada | Una cuenta llega a 5 intentos fallidos | Alerta |
| Robo de datos (enumeración) | Un usuario o IP intenta abrir 5 envíos ajenos o inexistentes en 10 min | Crítica |
| Sesiones falsas | 10 sesiones inválidas desde una IP en 10 min | Crítica |
| Extracción masiva | Un usuario exporta 5.000 registros en 1 hora | Crítica |
| Descarga masiva | Un usuario descarga 60 fotos o boletas en 10 min | Crítica |
| Exportación grande | Una exportación de 1.000 registros o más | Aviso |
| Exceso de peticiones | Una IP supera el límite por minuto | Alerta |
| Fraude de pago | Llega una confirmación de pago con monto u orden distintos | Crítica |
| Administrador desde IP nueva | Un administrador entra desde una IP que no usaba | Aviso |
| Nuevo administrador / cambio a administrador | Se crea o se asciende un usuario a administrador | Alerta (evento) |

**¿Qué datos se están sacando y quién?** El panel muestra, por usuario: registros exportados, fotos y boletas
descargadas, intentos de ver datos ajenos, cuántas IPs usó y cuándo. Cada evento se puede filtrar por tipo, IP o usuario.

**Respuesta desde el panel:** cerrar las sesiones de un usuario (Usuarios → Cerrar sesiones), cerrar **todas** las sesiones
(Seguridad → Cerrar todas las sesiones, se confirma escribiendo CERRAR) y revisar alertas dejando una nota obligatoria.

## 4. Protocolo si sospechas un hackeo

1. **Contener (5 minutos).** Seguridad → **Cerrar todas las sesiones**. Cambia tu contraseña.
2. **Identificar.** En Seguridad mira las alertas abiertas, "¿Quién sacó datos?" y las IPs sospechosas (clic en la IP = toda su actividad).
3. **Cortar el acceso.** Desactiva o asigna contraseña nueva a las cuentas comprometidas. Si una IP ataca, bloquéala en
   Railway o en Cloudflare (si el dominio pasa por Cloudflare).
4. **Cambiar las claves del servidor** si crees que se filtraron:
   - `JWT_SECRET` en Railway (`npm run secreto`): **invalida todas las sesiones y enlaces de archivos** al instante.
   - Contraseña de la base: Supabase → Database → Reset password → `SUPABASE_DB_PASSWORD` en Railway.
   - Clave secreta de Supabase: Project Settings → API Keys → crear nueva, cambiar `SUPABASE_SECRET_KEY`, borrar la antigua.
5. **Evaluar el daño.** Con los eventos de exportación y descarga sabes exactamente qué registros y archivos salieron,
   quién los sacó y cuándo. La bitácora no se puede borrar, así que la evidencia se conserva.
6. **Avisar.** Si salieron datos personales (nombres, teléfonos, direcciones, RUT), la Ley 21.719 exige informar a la
   Agencia de Protección de Datos y, según el caso, a las personas afectadas. Guarda una exportación de la bitácora como respaldo.
7. **Cerrar.** Marca las alertas como revisadas con una nota de lo que se hizo.

## 5. Configuración recomendada en Railway

| Variable | Valor |
|---|---|
| `AUTH_MODE` | `jwt` |
| `SEED_DEMO` | `false` |
| `JWT_SECRET` | 64 caracteres aleatorios (`npm run secreto`) |
| `SEGURIDAD_WEBHOOK_URL` | (opcional) webhook de Slack/Discord/Google Chat para alertas críticas inmediatas |
| `LIMITE_API_POR_MINUTO` / `LIMITE_PUBLICO_POR_MINUTO` | (opcional) 600 / 120 por defecto |

## 6. Límites conocidos (riesgo aceptado o pendiente)

- Los límites de peticiones y de intentos viven en la memoria del servidor: con **una** instancia (lo actual) funcionan;
  si se escala a varias, deben pasar a la base o a Redis. Las **alertas** sí usan la base y funcionan con varias.
- Cualquiera puede bloquear 15 minutos una cuenta ajena equivocándose 5 veces a propósito (es el costo de frenar la fuerza bruta).
- La sesión se guarda en el navegador (`localStorage`); por eso la app escapa todo lo que muestra (sin XSS) y la política
  de contenido (CSP) no permite scripts externos.
- El seguimiento público por folio deja ver estado y comuna de cualquier folio (sin datos personales); los folios son
  correlativos. Está limitado a 120 consultas por minuto por IP.
- Recuperación de contraseña por correo: pendiente (requiere proveedor de correo).
- Recomendado a futuro: segundo factor (2FA) para administradores y respaldos cifrados probados (D-07).
