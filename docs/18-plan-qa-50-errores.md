# 18 · Plan QA: 100 errores encontrados y corregidos (01-10-2026)

**Rol:** jefatura de proyecto y QA · **Versión revisada:** último commit subido (`30-09-1`) · **Estado:** ✅ dos rondas cerradas: QA-01 a QA-52 (primera ronda, 50 + 2 encontrados por las pruebas) y QA-53 a QA-102 (segunda ronda, 50). **102 errores corregidos en total**, más QA-103, QA-104 y 7 mejoras de la página encontrados en la verificación caso por caso ([sección 6](#6-verificación-caso-por-caso-y-mejoras-de-la-página-01-10-2026)).

La segunda ronda está en la [sección 5](#5-segunda-ronda-qa-53-a-qa-102).

## 1. Objetivo y alcance

Encontrar y corregir 50 errores reales de la plataforma antes de la fecha meta (26-10-2026), sin romper nada de lo que ya funciona.

- **Alcance:** API (`server/`), interfaz (`web/`), base de datos (migraciones, carga inicial) y configuración de despliegue.
- **Fuera de alcance:** cambios de reglas de negocio pendientes del cliente (docs/11) y la integración de una pasarela de pago real.

## 2. Método

| Paso | Qué se hizo |
|---|---|
| 1. Línea base | Se levantó la app con PostgreSQL 16 local y se corrieron todas las suites: 51 unitarias y 135 casos QA en verde. |
| 2. Revisión de código | Revisión línea por línea de las rutas, reglas, librerías, migraciones e interfaz, buscando: datos expuestos, reglas de negocio mal aplicadas, validaciones faltantes, errores 500, inconsistencias de datos y fallas de robustez. |
| 3. Clasificación | Cada hallazgo se clasificó con la escala de severidad del plan QA (docs/08 §6). |
| 4. Corrección | Cambio mínimo y localizado por error, con un comentario en el código que explica el porqué. |
| 5. Prueba de cada corrección | 8 pruebas unitarias nuevas (`tests/unit/correcciones-qa.test.js`) y 19 casos QA nuevos de API, CP-200 a CP-218 (`qa/specs/20-plan-qa-50-errores.test.js`). Cada prueba indica el N° de error que protege. |
| 6. Regresión completa | Unitarias, QA de la API, flujo completo por la interfaz, accesibilidad WCAG 2.1 AA y prueba de carga. |

## 3. Resultado

| Suite | Antes | Después |
|---|---|---|
| Pruebas unitarias (`npm test`) | 51 ✔ | **59 ✔** (0 fallas) |
| QA de la API (`npm run qa:local`) | 135 ✔ · 2 omitidas | **154 ✔** · 2 omitidas (las mismas) · 0 fallas |
| Flujo completo por la interfaz (`npm run e2e`) | ✔ | ✔ |
| Accesibilidad WCAG 2.1 AA (`npm run accesibilidad`) | ✔ | ✔ |
| Carga: 40 clientes + 15 repartidores (`npm run carga`) | ✔ | ✔ 200/200 envíos · folios únicos · 0 errores |

| Severidad | Cantidad |
|---|---|
| Crítica | 4 |
| Alta | 13 |
| Media | 25 |
| Baja | 10 |
| **Total** | **52** |

## 4. Los 50 errores (y dos más)

### Seguridad y datos personales

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-01 | Alta | El repartidor veía el **recargo por sobredimensión** (y el reembolso y la referencia de pago) del envío: la lista de montos ocultos no tenía los campos nuevos. | Se ocultan todos los campos con dinero. `server/lib/reglas.js` | CP-200, unitaria |
| QA-02 | Crítica | Con inicio de sesión real, una URL que **contenía** "localhost" (p. ej. `localhost.miempresa.cl`) se tomaba como computador local y se aceptaba una `JWT_SECRET` débil o de ejemplo: cualquiera podría fabricar una sesión de administrador. | Se compara el nombre del servidor, no el texto. `server/config.js` | unitaria |
| QA-03 | Media | Ajustes aceptaba claves heredadas de JavaScript (`constructor`, `__proto__`, `toString`) y las guardaba en la base, alterando la configuración leída. | Solo claves propias (`Object.hasOwn`). `server/routes/catalogos.js` | CP-201 |
| QA-04 | Crítica | `LIMITE_API_POR_MINUTO=` (vacío en Railway) se leía como 0 y **apagaba el límite de peticiones** (protección contra robots y ataques). | Vacío o inválido usa el valor por defecto; solo un 0 explícito lo desactiva. `server/config.js` | unitaria |
| QA-05 | Media | El registro de inicios de sesión fallidos crecía sin tope: probando miles de correos inventados se podía agotar la memoria del servidor. | Tope de 20.000 registros con limpieza. `server/routes/cuentas.js` | revisión |
| QA-06 | Media | Buscar `%` o `_` devolvía **todos** los envíos, comunas o destinatarios (comodines sin escapar) y la búsqueda no tenía largo máximo. | Se escapan los comodines y se limita a 100 caracteres. `server/lib/http.js` | CP-206, unitaria |
| QA-07 | Baja | Al descargar una foto o boleta, el nombre del archivo salía con códigos (`ca%C3%B1on.jpg`) y un nombre con comillas podía romper la cabecera. | Nombre según RFC 6266 (ASCII + `filename*` UTF-8). `server/routes/operacion.js` | CP-217 |
| QA-08 | Media | Una foto JPEG con bytes de relleno antes de un marcador **no se le quitaba el EXIF** (que incluye la ubicación GPS de quien sacó la foto). | Se saltan los bytes de relleno. `server/lib/exif.js` | unitaria |
| QA-47 | Alta | Un destinatario **anonimizado** a pedido del titular (Ley 21.719) se podía volver a editar y agregarle direcciones, re-identificándolo. | Se bloquea con 409. `server/routes/catalogos.js` | CP-214 |
| QA-49 | Alta | El repartidor podía **cotizar** (`/api/envios/cotizar`) y consultar pagos (`/api/pagos/:token`), obteniendo montos que no debe ver. | Solo cliente y administración. `server/routes/envios.js`, `operacion.js` | CP-200 |

### Tarifas y dinero

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-09 | Crítica | Cambiar la **tarifa estándar** en *Tarifas y reglas* no cambiaba lo cobrado en Santiago: las comunas en cobertura cobran la tarifa de su zona, que quedó fija en $3.500 desde la carga inicial. | Al guardar la tarifa estándar se actualizan las zonas que seguían con la anterior. `server/routes/catalogos.js` | CP-203 |
| QA-10 | Alta | Un paquete de 10,004 kg se cobraba como sobredimensionado (+$2.000) pero quedaba guardado como 10,00 kg (estándar). | El peso se redondea a 2 decimales antes de cotizar. `server/routes/envios.js` | CP-207 |
| QA-11 | Alta | Un campo numérico **vacío** en Ajustes se guardaba como $0 (`Number('') = 0`): por ejemplo, el recargo de horario especial. | Vacío = error "no puede quedar vacío". `server/routes/catalogos.js` | CP-202 |
| QA-12 | Crítica | La tarifa estándar podía quedar en **$0**: los envíos nuevos quedaban "sin monto a pagar", no se podían pagar ni asignar a un repartidor. | Debe ser mayor que $0. `server/routes/catalogos.js` | CP-202 |
| QA-13 | Media | Zonas: una tarifa vacía o nula se guardaba como $0. | Tarifa obligatoria, entero entre $0 y $10.000.000. `server/routes/catalogos.js` | CP-205 |
| QA-18 | Media | El reporte de ganancias **sumaba a dos repartidores con el mismo nombre** como si fueran uno. | Se agrupa por persona (id). `server/routes/operacion.js` | CP-212 |
| QA-20 | Media | Se podía registrar un costo con **fecha futura** (la pantalla lo impedía, la API no), inflando meses siguientes. | Fecha válida y no futura; nota de hasta 300 caracteres. `server/routes/operacion.js` | CP-212 |
| QA-21 | Media | Reembolso con el campo de monto vacío daba error en vez de devolver el total pagado; la nota no tenía largo máximo. | Vacío = total; nota hasta 300. `server/routes/envios.js` | CP-211 |
| QA-22 | Baja | Pago manual: la referencia no tenía largo máximo y la auditoría guardaba el texto sin limpiar. | Referencia limpia de hasta 60 caracteres. `server/routes/envios.js` | CP-211 |
| QA-30 | Baja | El CSV mostraba el estado de pago con códigos internos (`en_revision`). | Texto legible (Pendiente, En revisión, Pagado, Reembolsado). `server/routes/envios.js` | CP-218 |

### Envíos, ruta y entrega

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-23 | Alta | Crear un envío con `confirmar: "false"` (texto, como envían los formularios) **lo confirmaba igual** y gastaba un folio. | Solo `true` confirma. `server/routes/envios.js` | CP-207 |
| QA-24 | Media | Las coordenadas de una dirección nueva no se validaban: se guardaba una latitud 999. | Se validan como el GPS de la entrega. `server/routes/envios.js` | CP-207 |
| QA-25 | Media | La precisión del GPS en la entrega aceptaba texto o negativos y se guardaba `NaN` en la base. | Número entre 0 y 100.000 m. `server/routes/envios.js` | CP-208 |
| QA-26 | Baja | El nombre de quien recibe la entrega no se limpiaba ni tenía largo máximo. | Recortado a 120 caracteres. `server/routes/envios.js` | CP-208 |
| QA-27 | Alta | Al **reasignar** o desasignar un repartidor, el envío conservaba la posición de la ruta del anterior y aparecía en un lugar heredado en la ruta del nuevo. | Se limpia el orden al cambiar de repartidor. `server/routes/envios.js` | CP-209 |
| QA-28 | Media | El repartidor podía "ordenar" en su ruta envíos ya entregados o anulados. | Solo envíos que siguen en su ruta. `server/routes/envios.js` | CP-209 |
| QA-29 | Media | El seguimiento rechazaba como "formato inválido" los folios de 7 dígitos (desde el envío 1.000.000 del año). | Se aceptan 6 a 9 dígitos. `server/routes/publico.js` | CP-215 |
| QA-43 | Media | Un envío podía acumular fotos y boletas sin límite, llenando el almacenamiento. | Máximo 20 adjuntos por envío. `server/routes/envios.js` | CP-217 |
| QA-48 | Alta | El QR de un envío a **punto courier** (Starken, Blue Express…) abría el mapa directo, sin indicar que la entrega es en un punto ni la empresa o sucursal (el repartidor podía terminar tocando el timbre de una casa). | Para punto courier se muestra la página con el punto, la empresa y los botones de mapa. `server/routes/publico.js` | CP-216 |

### Seguro

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-16 | Alta | Se podía reclamar el seguro (pérdida, daño, robo) de un envío que **aún no se retiraba**. | Solo después del retiro. `server/lib/reglas.js` | CP-210, unitaria |
| QA-17 | Media | El RUT del emisor de la boleta no se validaba ni normalizaba; la descripción no tenía largo máximo. | RUT validado y normalizado; descripción hasta 1000. `server/routes/operacion.js` | CP-210 |
| QA-41 | Baja | En la lista de reclamos se firmaban enlaces para boletas inexistentes (enlace roto). | Sin boleta, sin enlace. `server/routes/operacion.js` | revisión |

### Fechas y reportes

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-19 | Media | Reportes, cobranza, costos y listado de envíos aceptaban fechas imposibles (31-02, que JavaScript corre al 3 de marzo) y rangos invertidos, con errores genéricos o reportes vacíos. | Fecha de calendario válida y "desde ≤ hasta", con mensaje claro. `server/lib/http.js` | CP-212, unitaria |

### Configuración y catálogos

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-14 | Media | Crear una zona con nombre numérico provocaba **error 500**. | Se guarda como texto. `server/routes/catalogos.js` | CP-205 |
| QA-15 | Baja | El nombre de una zona podía quedar vacío al editarla y no había tarifa máxima. | Nombre obligatorio (hasta 60) y tope $10.000.000. `server/routes/catalogos.js` | CP-205 |
| QA-35 | Media | La primera dirección agregada a un destinatario desde la libreta no quedaba como principal, y `es_principal: "false"` (texto) la marcaba como principal. | Primera = principal; solo `true` marca. `server/routes/catalogos.js` | CP-214 |
| QA-36 | Media | Al desactivar la dirección principal, el destinatario quedaba sin ninguna principal. | Pasa a principal la activa más reciente. `server/routes/catalogos.js` | CP-214 |
| QA-37 | Media | El nombre de la empresa podía quedar vacío (ticket y título sin nombre); el correo y el RUT de la empresa no se validaban. | Nombre obligatorio, correo y RUT validados, máximo 80 caracteres. `server/routes/catalogos.js` | CP-204 |
| QA-38 | Baja | El pie del ticket no tenía largo máximo y podía desbordar la etiqueta térmica. | Hasta 200 caracteres. `server/routes/catalogos.js` | CP-204 |

### Cuentas de usuario

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-31 | Media | Crear un usuario con un correo existente escrito con espacios o mayúsculas pasaba la verificación y terminaba en un error genérico; un correo que no era texto daba **error 500**. | Se normaliza el correo antes de comparar y guardar. `server/routes/cuentas.js` | CP-213 |
| QA-32 | Baja | El nombre del usuario no tenía largo máximo. | Hasta 120 caracteres. `server/routes/cuentas.js` | CP-213 |
| QA-33 | Alta | Desactivar un usuario enviando `activo: "false"` (texto) lo dejaba **activo** sin avisar. | Debe ser verdadero o falso (422). `server/routes/cuentas.js` | CP-213 |
| QA-34 | Media | Un `ADMIN_EMAIL` con espacios (pegado en Railway) creaba un administrador con el que nadie podía iniciar sesión. | Se recorta al crearlo. `server/db/seed.js` | revisión |
| QA-50 | Baja | Teléfonos con prefijo `0056` se rechazaban, y los de 8 dígitos que empiezan con 56 se leían mal. | Se aceptan ambos formatos. `server/lib/reglas.js` | unitaria |

### Robustez del servidor y despliegue

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-39 | Alta | `JWT_DIAS` o `MAX_UPLOAD_MB` con un valor inválido quedaban en `NaN`: el inicio de sesión fallaba con error 500 y las subidas quedaban sin límite de tamaño. | Valor inválido = valor por defecto. `server/config.js` | unitaria |
| QA-40 | Alta | Si la conexión a la base se cortaba en medio de una operación, el error real se perdía y la **conexión rota volvía al pool**, haciendo fallar la petición siguiente. | Se informa el error original y se descarta la conexión. `server/db/pool.js` | revisión |
| QA-42 | Media | Con la interfaz publicada en otro dominio (Vercel) el navegador no podía leer el nombre del archivo descargado ni el tiempo de espera tras el límite de peticiones. | Se exponen esas cabeceras en CORS. `server/app.js` | CP-218 |

### Interfaz

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-44 | Alta | Si el teléfono no lograba comprimir la foto, se subía un archivo **vacío** como foto de entrega o comprobante. | Se sube la foto original. `web/js/ui.js` | interfaz |
| QA-45 | Media | Una respuesta cortada del servidor mostraba "Unexpected token…" en vez de un mensaje claro. | Mensaje "Respuesta incompleta del servidor…". `web/js/api.js` | interfaz |
| QA-46 | Baja | El estado "Reembolsado" se pintaba con el color de "Pago pendiente". | Color propio. `web/js/ui.js`, `web/css/app.css` | interfaz |

### Encontrados por las pruebas nuevas

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-51 | Media | Los nombres de archivo con tildes o ñ ("cañón.jpg") se guardaban corruptos ("caÃ±Ã³n.jpg"): el lector de formularios los leía como latin1. | Se leen como UTF-8. `server/lib/archivos.js` | CP-217 |
| QA-52 | Media | Al crear un envío, si el cliente confirmaba antes de 400 ms desde la última tecla en el paso "Paquete", el recálculo pendiente fallaba con un error de JavaScript (formulario ya cerrado). Lo detectó la prueba del flujo completo. | Se cancela el recálculo al confirmar o volver, y se ignora si el formulario ya no está. `web/js/vistas/cliente.js` | e2e (3 corridas seguidas sin errores) |

"revisión" = verificado por revisión de código y por las suites de regresión (el caso no se puede provocar desde la API sin simular fallas de red o de memoria).

## 5. Segunda ronda (QA-53 a QA-102)

Mismo método. Esta vez el foco fue lo que la primera ronda no cubrió a fondo: las pantallas (`web/js/vistas/`), el service worker, los scripts de despliegue y los flujos de dinero que quedaron como riesgo (reembolsos, conciliación, archivos huérfanos).

**Resultado de la segunda ronda**

| Suite | Antes de la ronda | Después |
|---|---|---|
| Pruebas unitarias | 59 ✔ | **65 ✔** (6 nuevas: `tests/unit/correcciones-qa-2.test.js`) |
| QA de la API | 154 ✔ · 2 omitidas | **164 ✔** · 2 omitidas (las mismas) · 10 casos nuevos CP-220 a CP-229 (`qa/specs/21-plan-qa-ronda-2.test.js`) |
| Flujo completo, accesibilidad y carga | ✔ | ✔ (carga: 200/200 envíos, 0 errores) |
| Verificación en navegador | — | Enter ya no aprueba pagos (reproducido antes y después), panel con rango inválido, cifras del inicio del cliente |

| Severidad | Cantidad |
|---|---|
| Crítica | 2 |
| Alta | 8 |
| Media | 24 |
| Baja | 16 |
| **Total** | **50** |

**Cambio de comportamiento a comunicar (QA-81):** con inicio de sesión real, quien entra con una contraseña temporal asignada por administración ya no puede usar nada hasta cambiarla (antes solo lo pedía la pantalla). La prueba CP-85 se actualizó a esta regla.

### Pantallas y aplicación

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-53 | Crítica | Al revisar un comprobante, escribir el motivo del rechazo y pulsar **Enter APROBABA el pago** (el formulario se enviaba con el primer botón, "Aprobar"). | Solo decide el botón que se pulsa. `web/js/vistas/envios.js` | navegador: antes "pagado", después sigue "en revisión" · interfaz |
| QA-54 | Alta | Lo mismo al resolver un reclamo de seguro: Enter en el monto aprobaba el reclamo. | Solo decide el botón. `web/js/vistas/envios.js` | interfaz |
| QA-55 | Media | El reembolso desde la pantalla enviaba 0 con el monto vacío (anulaba la corrección QA-21). | Vacío = reembolso total. `web/js/vistas/envios.js` | interfaz |
| QA-56 | Baja | El botón "Reclamar seguro" aparecía antes del retiro y el servidor lo rechazaba. | Mismos estados que exige el servidor. `web/js/vistas/envios.js` | interfaz |
| QA-57 | Media | Doble clic en "Pagar" (pago en línea) enviaba dos confirmaciones; la segunda mostraba un error. | Botones bloqueados mientras se procesa. `web/js/vistas/envios.js` | interfaz |
| QA-58 | Baja | El QR y la vista previa de la foto quedaban en memoria en cada refresco automático (cada 30 s): las pantallas abiertas todo el día consumían cada vez más. | Se libera la imagen anterior. `web/js/ui.js` | interfaz |
| QA-59 | Media | Panel de ganancias con "desde" posterior a "hasta": la pantalla quedaba cargando para siempre. | Mensaje claro y botón "Ver el mes actual". `web/js/vistas/admin.js` | interfaz |
| QA-60 | Media | Cobranza: el mismo problema. | Mismo manejo. `web/js/vistas/admin.js` | interfaz |
| QA-61 | Baja | Seguridad: un error al cargar o al abrir la actividad de una IP dejaba la pantalla sin respuesta. | Errores manejados. `web/js/vistas/admin.js` | interfaz |
| QA-62 | Alta | Las cifras del inicio del cliente (en curso, por pagar, entregados) se calculaban solo con sus **últimos 100 envíos**: con más, eran incorrectas. | El servidor las cuenta todas (`/api/envios/resumen`). `server/routes/envios.js`, `web/js/vistas/cliente.js` | CP-220, navegador |
| QA-63 | Baja | Libreta: "Dirección quitada" se mostraba aunque la operación fallara. | El aviso solo sale si se guardó. `web/js/vistas/cliente.js` | interfaz |
| QA-64 | Media | La libreta y el asistente de nuevo envío mostraban destinatarios anonimizados ("Titular anonimizado"). | No se listan (administración los ve con `?anonimizados=1`). `server/routes/catalogos.js` | CP-221 |
| QA-65 | Alta | El service worker no guardaba `cuenta.js`: **la app no abría sin conexión** (era la promesa de la PWA). | Incluido en la caché. `web/sw.js` | interfaz |
| QA-66 | Media | El service worker guardaba respuestas de error (404, 502 durante un despliegue) y las mostraba sin conexión. | Solo se guardan respuestas correctas. `web/sw.js` | interfaz |
| QA-67 | Baja | Ajustes → opciones del envío: un error no marcaba el campo. | Se marca el campo. `web/js/vistas/admin.js`. **Completada en la verificación caso por caso**: el servidor tampoco decía qué lista tenía el error (`server/routes/catalogos.js`). | interfaz |
| QA-68 | Baja | Con la hora del teléfono atrasada, la cuenta regresiva de espera pasaba de 5:00 y el anillo se salía de escala. | Se limita a la espera máxima. `web/js/vistas/repartidor.js` | interfaz |
| QA-69 | Media | "No se pudo entregar": mientras buscaba el GPS (hasta 25 s) no se veía nada y un segundo toque lo enviaba otra vez. | Botón bloqueado con "Obteniendo ubicación…". `web/js/vistas/repartidor.js` | interfaz |
| QA-70 | Media | Si se cambiaba la `DEMO_CLAVE`, quien tenía la anterior veía errores en cada acción sin que se le pidiera la nueva. | Se olvida la clave guardada y se vuelve a pedir. `web/js/api.js` | revisión |
| QA-71 | Baja | Al cerrar un modal, el foco del teclado se perdía (accesibilidad). | Vuelve al botón que lo abrió. `web/js/ui.js` | interfaz |

### Datos personales y seguridad

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-72 | Alta | Se podía crear un envío para un destinatario **anonimizado**, volviendo a asociarle una dirección (Ley 21.719). | 409. `server/routes/envios.js` | CP-221 |
| QA-73 | Media | El seguimiento público decía si el envío estaba pagado; como los folios son correlativos, cualquiera podía recorrerlos. | Se quitó el estado del pago. `server/routes/publico.js` | CP-224 |
| QA-81 | Crítica | Contraseña temporal asignada por administración: la API aceptaba todo sin cambiarla (solo la pantalla lo pedía), con una clave que administración conoce. | Hasta cambiarla, la sesión solo sirve para cambiarla. `server/middleware/auth.js`, `web/js/app.js` | CP-85 (actualizado) |
| QA-83 | Alta | Todos los repartidores veían **nombre, teléfono, depto y referencia** del destinatario de todos los envíos disponibles, aunque no los tomaran. | Ven comuna, calle y bultos; el resto, al tomarlo. `server/lib/reglas.js`, `server/routes/envios.js` | CP-223, unitaria |
| QA-84 | Media | El repartidor recibía el correo del destinatario, que no necesita para entregar. | Se oculta. `server/lib/reglas.js` | CP-223, unitaria |
| QA-102 | Media | Con inicio de sesión real, los datos de la **cuenta bancaria** para transferir se entregaban a cualquiera sin iniciar sesión. | Solo con sesión (o en la demo). `server/routes/catalogos.js`, `web/js/app.js` | revisión |

### Dinero: reembolsos, cobranza y conciliación

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-74 | Alta | El reembolso no quedaba en la bitácora del pago ni se descontaba en Cobranza (riesgo anotado en la primera ronda). | Evento "reembolso" en la bitácora (migración 012) y "reembolsado" en el resumen. `server/routes/envios.js`, `cobranza.js` | CP-225 |
| QA-78 | Alta | Cada transferencia aprobada aparecía como **"abono por llegar" de una pasarela** y se podía "conciliar", registrando un costo de pasarela que no existe. | Transferencias, pagos manuales y simulador no se concilian. `server/lib/cobranza.js`, `cobranza.js`, `admin.js` | CP-226, unitaria |
| QA-76 | Media | La conciliación aceptaba una fecha de abono anterior al pago. | Rechazada. `server/lib/cobranza.js` | unitaria |
| QA-77 | Baja | Una fecha de abono imposible (31-02) se corría al mes siguiente. | Rechazada. `server/lib/cobranza.js` | unitaria |
| QA-86 | Media | Si un envío se pagaba por transferencia o a mano, su cobro en línea abierto quedaba para siempre como "pago sin respuesta de la pasarela". | Se anula al pagarse; el aviso solo cuenta envíos aún sin pagar. `server/lib/pagos.js`, `cobranza.js` | CP-227 |
| QA-82 | Media | El CSV escribía el peso con punto decimal: Excel en español lo leía como 25 en vez de 2,5. | Coma decimal. `server/routes/envios.js` | CP-228 |
| QA-79 | Baja | La tasa de intentos fallidos del panel contaba borradores y anulados en el total. | Solo envíos que salieron a ruta. `server/routes/operacion.js` | revisión |

### Operación y validaciones

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-75 | Media | Si la operación fallaba después de subir la foto, boleta o comprobante (p. ej. otra persona cambió el envío), el archivo quedaba en el almacenamiento sin registro (riesgo anotado en la primera ronda). | Se borra si la operación falla. `server/lib/archivos.js` y rutas | unitaria |
| QA-80 | Media | "Cerrados hoy" del repartidor contaba un envío devuelto otro día si hoy se le hacía otro cambio (p. ej. un reembolso). | Cuenta la fecha real del cierre. `server/routes/envios.js` | CP-130 |
| QA-85 | Baja | La nota al resolver un reclamo no tenía largo máximo. | Hasta 500. `server/routes/operacion.js` | CP-229 |
| QA-87 | Media | Descripción, observaciones y punto courier del envío no tenían largo máximo (desbordaban la etiqueta térmica). | 200 / 300 / 120 caracteres. `server/lib/reglas.js` | CP-229, unitaria |
| QA-88 | Baja | Nombre, notas y dirección del destinatario no tenían largo máximo. | Largos máximos. `server/lib/reglas.js` | CP-229, unitaria |
| QA-89 | Baja | El RUT "0-0" se aceptaba como válido. | Rechazado. `server/lib/reglas.js` | CP-229, unitaria |
| QA-96 | Media | Administración podía crear envíos a nombre de un cliente **desactivado**. | Solo clientes activos. `server/routes/envios.js` | CP-222 |
| QA-97 | Media | Administración podía crear destinatarios en la "libreta" de un repartidor o de otro administrador. | Solo clientes. `server/routes/catalogos.js` | CP-222 |
| QA-101 | Media | Dentro de un edificio el GPS de alta precisión no responde y el repartidor no podía cerrar la entrega. | Si no responde, se usa la ubicación aproximada del teléfono. `web/js/ui.js` | interfaz |

### Servidor y despliegue

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-90 | Alta | `npm run verificar` **nunca podía terminar en "Todo listo"**: su archivo de prueba no era un PDF real y el almacenamiento lo rechazaba. | Archivo de prueba válido. `scripts/verificar-despliegue.js` | ejecutado antes (✖) y después (✔) |
| QA-91 | Baja | La verificación dejaba su archivo de prueba en el disco. | Se borra. `scripts/verificar-despliegue.js` | ejecutado |
| QA-92 | Media | La verificación daba por buena una `JWT_SECRET` de ejemplo de las plantillas (tiene 44 caracteres). | Se rechazan las claves de ejemplo. `scripts/verificar-despliegue.js` | ejecutado |
| QA-93 | Media | `npm run publicar` subía a Railway los valores con sus comillas (`JWT_SECRET="…"` quedaba con comillas). | Lector común que las quita. `scripts/publicar.js`, `qa/entornos.js` | unitaria |
| QA-94 | Baja | En `entornos.env`, los espacios al final y los comentarios al final de la línea quedaban pegados a las URLs. | Se quitan. `qa/entornos.js` | unitaria |
| QA-95 | Baja | El SQL para Supabase decía que la verificación debía mostrar 5 claves de configuración; son 7. | Se calcula al generarlo. `scripts/generar-sql-supabase.js` | unitaria |
| QA-98 | Media | Sin red de seguridad: en Node 22 una promesa rechazada sin manejar termina el proceso y Railway reinicia la app, cortando a todos. | Se registra y el servidor sigue. `server/index.js` | revisión |
| QA-99 | Media | `CORS_ORIGINS` con barra final (`https://x.vercel.app/`) bloqueaba la interfaz publicada en Vercel. | Se quita la barra. `server/config.js` | unitaria |
| QA-100 | Baja | `web/config.js` estaba desactualizado: el selector de servidor no ofrecía la URL de Railway. | Regenerado con `npm run build:web`. | unitaria |

"revisión" = verificado por revisión de código y por las suites de regresión (flujo completo, accesibilidad, carga).

## 6. Verificación caso por caso y mejoras de la página (01-10-2026)

### 6.1 Verificación

Se revisó uno por uno cada error corregido y cada pantalla de los tres perfiles, en celular (390 px) y en escritorio (1280 px).
El informe completo, con la evidencia de cada caso, está en **[docs/19](19-verificacion-caso-por-caso.md)** y se regenera con
`npm run verificar:casos`.

- Nueva suite **`npm run interfaz`** (`qa/e2e/correcciones-interfaz.js`): reproduce en un navegador real 18 correcciones de pantalla que
  antes solo se habían revisado leyendo el código (Enter en revisiones, reembolso vacío, doble clic en pagar, rangos inválidos,
  GPS de respaldo, foco de los modales, app sin conexión…). Corre en GitHub Actions.
- Resultado: de 102 errores, **90 con prueba automática que pasa** y **12 verificados a mano** (necesitan inicio de sesión real,
  simular una caída de la base o ejecutar un script de despliegue). **Ninguno falla.**
- La verificación encontró que **QA-67 estaba incompleta**: la pantalla marcaba el campo con error, pero el servidor no decía qué lista
  fallaba. Corregido.

### 6.2 Errores nuevos encontrados en la verificación

| N° | Sev. | Qué pasaba | Corrección | Prueba |
|---|---|---|---|---|
| QA-103 | Media | En Cobranza, desde el celular, un comprobante usado en muchos envíos mostraba **todos** los folios en una sola línea sin corte: la pantalla quedaba de 68.000 px de ancho. | Se muestran 3 folios y "y N más" (la lista completa queda al pasar el cursor). `web/js/ui.js`, `admin.js`, `envios.js` | recorrido de pantallas sin desborde |
| QA-104 | Alta | "Disponibles para tomar" devolvía solo los **100 envíos más antiguos** y decía que eran todos: con más de 100 envíos pagados sin asignar, los nuevos no le aparecían a ningún repartidor. Lo detectó la regresión final (CP-223). | Total real y lista por páginas; "Ver más" carga el resto. `server/routes/envios.js`, `web/js/vistas/repartidor.js` | CP-232 |

### 6.3 Mejoras de la página

| N° | Mejora | Dónde |
|---|---|---|
| M-01 | El folio ya no se corta en dos líneas ("ENV-2026-" / "000983") en las tarjetas de envíos. | `web/css/app.css` |
| M-02 | El historial del envío muestra los pasos del pago, en verde y en orden: comprobante enviado, pago aprobado o rechazado (con el motivo) y reembolso. | `web/js/vistas/envios.js`, `server/lib/envios.js` |
| M-03 | "Mi ruta": cada sección (en ruta / por retirar) se numera desde 1 y las flechas mueven dentro de la sección; antes la numeración saltaba (1, 3, 4 arriba y 2 abajo). En el celular el folio y la dirección usan todo el ancho. | `web/js/vistas/repartidor.js`, `web/css/app.css` |
| M-04 | "Disponibles para tomar" muestra 10 envíos y un botón "Ver los N restantes" (antes la lista de 40 o más tapaba la ruta propia). | `web/js/vistas/repartidor.js` |
| M-05 | La libreta ya no se llena de repetidos: un envío a la misma persona (mismo nombre y teléfono) y a la misma dirección reutiliza las que ya están guardadas. | `server/routes/envios.js` · CP-230 |
| M-06 | En el detalle de un envío con un reclamo de seguro pendiente, administración tiene un acceso directo "Gestionar el reclamo en Seguros". | `web/js/vistas/envios.js` |
| M-07 | `npm run interfaz` y `npm run verificar:casos` quedan en GitHub Actions: cada cambio vuelve a verificar los 102 errores. | `.github/workflows/pruebas.yml` |

**Nota:** la libreta de las cuentas de prueba sigue teniendo los repetidos creados antes de M-05; los envíos nuevos ya no los generan.

## 7. Riesgos y pendientes para la próxima iteración

Resueltos en la segunda ronda: el reembolso ya queda en la bitácora de pagos (QA-74) y los archivos ya no quedan huérfanos (QA-75).

| Riesgo / pendiente | Acción propuesta | Responsable |
|---|---|---|
| Archivos huérfanos de antes de la segunda ronda pueden seguir en el almacenamiento. | Script de limpieza de archivos sin registro en `adjunto`. | Desarrollo |
| La regla de contraseña temporal (QA-81) y los datos bancarios con sesión (QA-102) solo se ejercitan con `AUTH_MODE=jwt`; la suite de CI corre en modo demo. | Correr `npm run qa:railway` contra un ambiente con inicio de sesión real antes de producción. | QA |
| Los límites de intentos de inicio de sesión viven en memoria (un solo servidor). | Pasarlos a la base si se usa más de una instancia en Railway. | Desarrollo |
| Las comunas con zona propia distinta de Santiago no cambian con la tarifa estándar (por diseño). | Pantalla para editar zonas en *Tarifas y reglas*. | Producto |

## 8. Cómo verificar

```bash
docker compose up -d && cp .env.example .env && npm install
npm test                 # 67 unitarias
npm run dev              # en otra terminal
npm run qa:local         # 169 casos (CP-200 a CP-232 cubren este plan)
npm run e2e && npm run accesibilidad && npm run carga
npm run interfaz         # correcciones de pantalla en el navegador
npm run verificar:casos  # informe caso por caso → docs/19
```
