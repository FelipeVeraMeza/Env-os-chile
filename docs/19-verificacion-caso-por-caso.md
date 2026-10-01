# 19 · Verificación caso por caso

Generado por `npm run verificar:casos` el 01-10-2026, 1:23:50 a. m. con el reporte `qa/reportes/qa-local-2026-10-01T04-21-50-570Z.xml`
y las pruebas unitarias corridas en ese momento. No editar a mano: se vuelve a generar.

## Resumen

| | Cantidad |
|---|---|
| Errores corregidos revisados (QA-01 a QA-104) | **104** |
| ✅ Con prueba automática que pasó en esta corrida | **91** |
| ⚠️ Verificados por revisión de código, navegador o ejecución manual (sin prueba automática propia) | **13** |
| ❌ Con una prueba que falló o no se encontró | **0** |
| Casos QA de la API en el reporte | 169 · ✔ 167 · ✖ 0 · omitidos 2 (solo aplican con AUTH_MODE=jwt) |
| Pruebas unitarias | 67 · ✔ 67 · ✖ 0 |
| Verificaciones en el navegador (`npm run interfaz`) | 22 · ✔ 22 · ✖ 0 (01-10-2026, 1:23:20 a. m.) |

Los casos ⚠️ quedan cubiertos además por la regresión completa (flujo completo por la interfaz, accesibilidad y carga),
pero no tienen una prueba que falle si ese error puntual vuelve. Son candidatos a automatizar en la próxima iteración.

## Detalle

| N° | Sev. | Error | Evidencia | Estado |
|---|---|---|---|---|
| QA-01 | Alta | El repartidor veía el recargo por sobredimensión (y el reembolso y la referencia de pago) del envío: la lista de montos ocultos no tenía los | CP-200 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-02 | Crítica | Con inicio de sesión real, una URL que contenía "localhost" (p. | 1 unitaria(s) ✔ | ✅ |
| QA-03 | Media | Ajustes aceptaba claves heredadas de JavaScript (constructor, __proto__, toString) y las guardaba en la base, alterando la configuración leí | CP-201 ✔ | ✅ |
| QA-04 | Crítica | LIMITE_API_POR_MINUTO= (vacío en Railway) se leía como 0 y apagaba el límite de peticiones (protección contra robots y ataques). | 1 unitaria(s) ✔ | ✅ |
| QA-05 | Media | El registro de inicios de sesión fallidos crecía sin tope: probando miles de correos inventados se podía agotar la memoria del servidor. | revisión | ⚠️ |
| QA-06 | Media | Buscar % o _ devolvía todos los envíos, comunas o destinatarios (comodines sin escapar) y la búsqueda no tenía largo máximo. | CP-206 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-07 | Baja | Al descargar una foto o boleta, el nombre del archivo salía con códigos (ca%C3%B1on.jpg) y un nombre con comillas podía romper la cabecera. | CP-217 ✔ | ✅ |
| QA-08 | Media | Una foto JPEG con bytes de relleno antes de un marcador no se le quitaba el EXIF (que incluye la ubicación GPS de quien sacó la foto). | 1 unitaria(s) ✔ | ✅ |
| QA-09 | Crítica | Cambiar la tarifa estándar en *Tarifas y reglas* no cambiaba lo cobrado en Santiago: las comunas en cobertura cobran la tarifa de su zona, q | CP-203 ✔ | ✅ |
| QA-10 | Alta | Un paquete de 10,004 kg se cobraba como sobredimensionado (+$2.000) pero quedaba guardado como 10,00 kg (estándar). | CP-207 ✔ | ✅ |
| QA-11 | Alta | Un campo numérico vacío en Ajustes se guardaba como $0 (Number('') = 0): por ejemplo, el recargo de horario especial. | CP-202 ✔ | ✅ |
| QA-12 | Crítica | La tarifa estándar podía quedar en $0: los envíos nuevos quedaban "sin monto a pagar", no se podían pagar ni asignar a un repartidor. | CP-202 ✔ | ✅ |
| QA-13 | Media | Zonas: una tarifa vacía o nula se guardaba como $0. | CP-205 ✔ | ✅ |
| QA-14 | Media | Crear una zona con nombre numérico provocaba error 500. | CP-205 ✔ | ✅ |
| QA-15 | Baja | El nombre de una zona podía quedar vacío al editarla y no había tarifa máxima. | CP-205 ✔ | ✅ |
| QA-16 | Alta | Se podía reclamar el seguro (pérdida, daño, robo) de un envío que aún no se retiraba. | CP-210 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-17 | Media | El RUT del emisor de la boleta no se validaba ni normalizaba; la descripción no tenía largo máximo. | CP-210 ✔ | ✅ |
| QA-18 | Media | El reporte de ganancias sumaba a dos repartidores con el mismo nombre como si fueran uno. | CP-212 ✔ | ✅ |
| QA-19 | Media | Reportes, cobranza, costos y listado de envíos aceptaban fechas imposibles (31-02, que JavaScript corre al 3 de marzo) y rangos invertidos,  | CP-212 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-20 | Media | Se podía registrar un costo con fecha futura (la pantalla lo impedía, la API no), inflando meses siguientes. | CP-212 ✔ | ✅ |
| QA-21 | Media | Reembolso con el campo de monto vacío daba error en vez de devolver el total pagado; la nota no tenía largo máximo. | CP-211 ✔ | ✅ |
| QA-22 | Baja | Pago manual: la referencia no tenía largo máximo y la auditoría guardaba el texto sin limpiar. | CP-211 ✔ | ✅ |
| QA-23 | Alta | Crear un envío con confirmar: "false" (texto, como envían los formularios) lo confirmaba igual y gastaba un folio. | CP-207 ✔ | ✅ |
| QA-24 | Media | Las coordenadas de una dirección nueva no se validaban: se guardaba una latitud 999. | CP-207 ✔ | ✅ |
| QA-25 | Media | La precisión del GPS en la entrega aceptaba texto o negativos y se guardaba NaN en la base. | CP-208 ✔ | ✅ |
| QA-26 | Baja | El nombre de quien recibe la entrega no se limpiaba ni tenía largo máximo. | CP-208 ✔ | ✅ |
| QA-27 | Alta | Al reasignar o desasignar un repartidor, el envío conservaba la posición de la ruta del anterior y aparecía en un lugar heredado en la ruta  | CP-209 ✔ | ✅ |
| QA-28 | Media | El repartidor podía "ordenar" en su ruta envíos ya entregados o anulados. | CP-209 ✔ | ✅ |
| QA-29 | Media | El seguimiento rechazaba como "formato inválido" los folios de 7 dígitos (desde el envío 1.000.000 del año). | CP-215 ✔ | ✅ |
| QA-30 | Baja | El CSV mostraba el estado de pago con códigos internos (en_revision). | CP-218 ✔ | ✅ |
| QA-31 | Media | Crear un usuario con un correo existente escrito con espacios o mayúsculas pasaba la verificación y terminaba en un error genérico; un corre | CP-213 ✔ | ✅ |
| QA-32 | Baja | El nombre del usuario no tenía largo máximo. | CP-213 ✔ | ✅ |
| QA-33 | Alta | Desactivar un usuario enviando activo: "false" (texto) lo dejaba activo sin avisar. | CP-213 ✔ | ✅ |
| QA-34 | Media | Un ADMIN_EMAIL con espacios (pegado en Railway) creaba un administrador con el que nadie podía iniciar sesión. | revisión | ⚠️ |
| QA-35 | Media | La primera dirección agregada a un destinatario desde la libreta no quedaba como principal, y es_principal: "false" (texto) la marcaba como  | CP-214 ✔ | ✅ |
| QA-36 | Media | Al desactivar la dirección principal, el destinatario quedaba sin ninguna principal. | CP-214 ✔ | ✅ |
| QA-37 | Media | El nombre de la empresa podía quedar vacío (ticket y título sin nombre); el correo y el RUT de la empresa no se validaban. | CP-204 ✔ | ✅ |
| QA-38 | Baja | El pie del ticket no tenía largo máximo y podía desbordar la etiqueta térmica. | CP-204 ✔ | ✅ |
| QA-39 | Alta | JWT_DIAS o MAX_UPLOAD_MB con un valor inválido quedaban en NaN: el inicio de sesión fallaba con error 500 y las subidas quedaban sin límite  | 1 unitaria(s) ✔ | ✅ |
| QA-40 | Alta | Si la conexión a la base se cortaba en medio de una operación, el error real se perdía y la conexión rota volvía al pool, haciendo fallar la | revisión | ⚠️ |
| QA-41 | Baja | En la lista de reclamos se firmaban enlaces para boletas inexistentes (enlace roto). | revisión | ⚠️ |
| QA-42 | Media | Con la interfaz publicada en otro dominio (Vercel) el navegador no podía leer el nombre del archivo descargado ni el tiempo de espera tras e | CP-218 ✔ | ✅ |
| QA-43 | Media | Un envío podía acumular fotos y boletas sin límite, llenando el almacenamiento. | CP-217 ✔ | ✅ |
| QA-44 | Alta | Si el teléfono no lograba comprimir la foto, se subía un archivo vacío como foto de entrega o comprobante. | navegador ✔ | ✅ |
| QA-45 | Media | Una respuesta cortada del servidor mostraba "Unexpected token…" en vez de un mensaje claro. | navegador ✔ | ✅ |
| QA-46 | Baja | El estado "Reembolsado" se pintaba con el color de "Pago pendiente". | navegador ✔ | ✅ |
| QA-47 | Alta | Un destinatario anonimizado a pedido del titular (Ley 21.719) se podía volver a editar y agregarle direcciones, re-identificándolo. | CP-214 ✔ | ✅ |
| QA-48 | Alta | El QR de un envío a punto courier (Starken, Blue Express…) abría el mapa directo, sin indicar que la entrega es en un punto ni la empresa o  | CP-216 ✔ | ✅ |
| QA-49 | Alta | El repartidor podía cotizar (/api/envios/cotizar) y consultar pagos (/api/pagos/:token), obteniendo montos que no debe ver. | CP-200 ✔ | ✅ |
| QA-50 | Baja | Teléfonos con prefijo 0056 se rechazaban, y los de 8 dígitos que empiezan con 56 se leían mal. | 1 unitaria(s) ✔ | ✅ |
| QA-51 | Media | Los nombres de archivo con tildes o ñ ("cañón.jpg") se guardaban corruptos ("caÃ±Ã³n.jpg"): el lector de formularios los leía como latin1. | CP-217 ✔ | ✅ |
| QA-52 | Media | Al crear un envío, si el cliente confirmaba antes de 400 ms desde la última tecla en el paso "Paquete", el recálculo pendiente fallaba con u | e2e (3 corridas seguidas sin errores) | ⚠️ |
| QA-53 | Crítica | Al revisar un comprobante, escribir el motivo del rechazo y pulsar Enter APROBABA el pago (el formulario se enviaba con el primer botón, "Ap | navegador ✔ · navegador: antes "pagado" después sigue "en revisión" | ✅ |
| QA-54 | Alta | Lo mismo al resolver un reclamo de seguro: Enter en el monto aprobaba el reclamo. | navegador ✔ | ✅ |
| QA-55 | Media | El reembolso desde la pantalla enviaba 0 con el monto vacío (anulaba la corrección QA-21). | navegador ✔ | ✅ |
| QA-56 | Baja | El botón "Reclamar seguro" aparecía antes del retiro y el servidor lo rechazaba. | navegador ✔ | ✅ |
| QA-57 | Media | Doble clic en "Pagar" (pago en línea) enviaba dos confirmaciones; la segunda mostraba un error. | navegador ✔ | ✅ |
| QA-58 | Baja | El QR y la vista previa de la foto quedaban en memoria en cada refresco automático (cada 30 s): las pantallas abiertas todo el día consumían | navegador ✔ | ✅ |
| QA-59 | Media | Panel de ganancias con "desde" posterior a "hasta": la pantalla quedaba cargando para siempre. | navegador ✔ | ✅ |
| QA-60 | Media | Cobranza: el mismo problema. | navegador ✔ | ✅ |
| QA-61 | Baja | Seguridad: un error al cargar o al abrir la actividad de una IP dejaba la pantalla sin respuesta. | navegador ✔ | ✅ |
| QA-62 | Alta | Las cifras del inicio del cliente (en curso, por pagar, entregados) se calculaban solo con sus últimos 100 envíos: con más, eran incorrectas | CP-220 ✔ · navegador | ✅ |
| QA-63 | Baja | Libreta: "Dirección quitada" se mostraba aunque la operación fallara. | navegador ✔ | ✅ |
| QA-64 | Media | La libreta y el asistente de nuevo envío mostraban destinatarios anonimizados ("Titular anonimizado"). | CP-221 ✔ | ✅ |
| QA-65 | Alta | El service worker no guardaba cuenta.js: la app no abría sin conexión (era la promesa de la PWA). | navegador ✔ | ✅ |
| QA-66 | Media | El service worker guardaba respuestas de error (404, 502 durante un despliegue) y las mostraba sin conexión. | navegador ✔ | ✅ |
| QA-67 | Baja | Ajustes → opciones del envío: un error no marcaba el campo. | navegador ✔ | ✅ |
| QA-68 | Baja | Con la hora del teléfono atrasada, la cuenta regresiva de espera pasaba de 5:00 y el anillo se salía de escala. | navegador ✔ | ✅ |
| QA-69 | Media | "No se pudo entregar": mientras buscaba el GPS (hasta 25 s) no se veía nada y un segundo toque lo enviaba otra vez. | navegador ✔ | ✅ |
| QA-70 | Media | Si se cambiaba la DEMO_CLAVE, quien tenía la anterior veía errores en cada acción sin que se le pidiera la nueva. | revisión | ⚠️ |
| QA-71 | Baja | Al cerrar un modal, el foco del teclado se perdía (accesibilidad). | navegador ✔ | ✅ |
| QA-72 | Alta | Se podía crear un envío para un destinatario anonimizado, volviendo a asociarle una dirección (Ley 21.719). | CP-221 ✔ | ✅ |
| QA-73 | Media | El seguimiento público decía si el envío estaba pagado; como los folios son correlativos, cualquiera podía recorrerlos. | CP-224 ✔ | ✅ |
| QA-74 | Alta | El reembolso no quedaba en la bitácora del pago ni se descontaba en Cobranza (riesgo anotado en la primera ronda). | CP-225 ✔ | ✅ |
| QA-75 | Media | Si la operación fallaba después de subir la foto, boleta o comprobante (p. | 1 unitaria(s) ✔ | ✅ |
| QA-76 | Media | La conciliación aceptaba una fecha de abono anterior al pago. | 1 unitaria(s) ✔ | ✅ |
| QA-77 | Baja | Una fecha de abono imposible (31-02) se corría al mes siguiente. | 1 unitaria(s) ✔ | ✅ |
| QA-78 | Alta | Cada transferencia aprobada aparecía como "abono por llegar" de una pasarela y se podía "conciliar", registrando un costo de pasarela que no | CP-226 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-79 | Baja | La tasa de intentos fallidos del panel contaba borradores y anulados en el total. | revisión | ⚠️ |
| QA-80 | Media | "Cerrados hoy" del repartidor contaba un envío devuelto otro día si hoy se le hacía otro cambio (p. | CP-130 ✔ | ✅ |
| QA-81 | Crítica | Contraseña temporal asignada por administración: la API aceptaba todo sin cambiarla (solo la pantalla lo pedía), con una clave que administr | CP-85 ✔ | ✅ |
| QA-82 | Media | El CSV escribía el peso con punto decimal: Excel en español lo leía como 25 en vez de 2,5. | CP-228 ✔ | ✅ |
| QA-83 | Alta | Todos los repartidores veían nombre, teléfono, depto y referencia del destinatario de todos los envíos disponibles, aunque no los tomaran. | CP-223 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-84 | Media | El repartidor recibía el correo del destinatario, que no necesita para entregar. | CP-223 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-85 | Baja | La nota al resolver un reclamo no tenía largo máximo. | CP-229 ✔ | ✅ |
| QA-86 | Media | Si un envío se pagaba por transferencia o a mano, su cobro en línea abierto quedaba para siempre como "pago sin respuesta de la pasarela". | CP-227 ✔ | ✅ |
| QA-87 | Media | Descripción, observaciones y punto courier del envío no tenían largo máximo (desbordaban la etiqueta térmica). | CP-229 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-88 | Baja | Nombre, notas y dirección del destinatario no tenían largo máximo. | CP-229 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-89 | Baja | El RUT "0-0" se aceptaba como válido. | CP-229 ✔ · 1 unitaria(s) ✔ | ✅ |
| QA-90 | Alta | npm run verificar nunca podía terminar en "Todo listo": su archivo de prueba no era un PDF real y el almacenamiento lo rechazaba. | ejecutado antes (✖) y después (✔) | ⚠️ |
| QA-91 | Baja | La verificación dejaba su archivo de prueba en el disco. | ejecutado | ⚠️ |
| QA-92 | Media | La verificación daba por buena una JWT_SECRET de ejemplo de las plantillas (tiene 44 caracteres). | ejecutado | ⚠️ |
| QA-93 | Media | npm run publicar subía a Railway los valores con sus comillas (JWT_SECRET="…" quedaba con comillas). | 1 unitaria(s) ✔ | ✅ |
| QA-94 | Baja | En entornos.env, los espacios al final y los comentarios al final de la línea quedaban pegados a las URLs. | 1 unitaria(s) ✔ | ✅ |
| QA-95 | Baja | El SQL para Supabase decía que la verificación debía mostrar 5 claves de configuración; son 7. | 1 unitaria(s) ✔ | ✅ |
| QA-96 | Media | Administración podía crear envíos a nombre de un cliente desactivado. | CP-222 ✔ | ✅ |
| QA-97 | Media | Administración podía crear destinatarios en la "libreta" de un repartidor o de otro administrador. | CP-222 ✔ | ✅ |
| QA-98 | Media | Sin red de seguridad: en Node 22 una promesa rechazada sin manejar termina el proceso y Railway reinicia la app, cortando a todos. | revisión | ⚠️ |
| QA-99 | Media | CORS_ORIGINS con barra final (https://x.vercel.app/) bloqueaba la interfaz publicada en Vercel. | 1 unitaria(s) ✔ | ✅ |
| QA-100 | Baja | web/config.js estaba desactualizado: el selector de servidor no ofrecía la URL de Railway. | 1 unitaria(s) ✔ | ✅ |
| QA-101 | Media | Dentro de un edificio el GPS de alta precisión no responde y el repartidor no podía cerrar la entrega. | navegador ✔ | ✅ |
| QA-102 | Media | Con inicio de sesión real, los datos de la cuenta bancaria para transferir se entregaban a cualquiera sin iniciar sesión. | revisión | ⚠️ |
| QA-103 | Media | En Cobranza, desde el celular, un comprobante usado en muchos envíos mostraba todos los folios en una sola línea sin corte: la pantalla qued | recorrido de pantallas sin desborde | ⚠️ |
| QA-104 | Alta | "Disponibles para tomar" devolvía solo los 100 envíos más antiguos y decía que eran todos: con más de 100 envíos pagados sin asignar, los nu | CP-232 ✔ | ✅ |
