# 15 · Prompt para completar los requerimientos pendientes

Copia todo el bloque de abajo en una nueva sesión de Claude Code con este repositorio.

```text
Trabajas en el repositorio FelipeVeraMeza/Env-os-chile: plataforma de gestión de envíos para Chile
(Node 22 + Express + PostgreSQL/Supabase, interfaz web PWA en /web, desplegada en Railway). Responde en español de Chile.

CONTEXTO (léelo antes de tocar código)
- docs/02-requerimientos.md: 90 requerimientos (RF-01…RF-65, RNF-01…RNF-25). Al 26-09-2026 hay 78 listos (✅).
- docs/08-plan-qa-y-criterios-de-aceptacion.md: casos CP-01…CP-92 trazados a cada requerimiento.
- docs/14-plan-de-accion.md: plan, preguntas al cliente (bloque C) y tareas D.
- docs/13-prompt-para-continuar.md: reglas generales del proyecto.
- Demo ABIERTA (AUTH_MODE=demo, sin DEMO_CLAVE). La pantalla de inicio de sesión real ya existe (AUTH_MODE=jwt).
- Migraciones en server/db/migrations (la siguiente es 004_…). Después de crear una: npm run sql:supabase.

CÓMO TRABAJAR
1. Levanta PostgreSQL local (usuario/clave/base "envios") y el servidor: node server/index.js.
2. Antes de cada commit deben pasar TODAS: npm test · npm run qa:local · npm run e2e · npm run carga ·
   npm run rendimiento · npm run accesibilidad. Nunca desactives ni saltes una prueba.
3. Cada requerimiento nuevo o terminado: código + caso QA nuevo (CP-93 en adelante) + fila en docs/02 (estado ✅ y CP)
   + fila en docs/08. Si toca la base: migración + npm run sql:supabase y verifica que el SQL corra 2 veces en una base nueva.
4. Todo cambio de estado de un envío usa el bloqueo optimista (exigirSinConflicto en server/lib/envios.js).
   Pruébalo con solicitudes simultáneas como en qa/specs/08-multiusuario.test.js.
5. Lo que depende de una respuesta del cliente se implementa con un valor por defecto CONFIGURABLE desde Ajustes
   (no fijo en el código) y se anota el supuesto en docs/11-decisiones-y-pendientes.md.
6. Lo que requiere cuenta o credenciales de un proveedor (pasarela, SII, SMS, Sentry…) se deja con un
   "proveedor simulado" y un adaptador listo, activado solo por variables de entorno. Nunca subas credenciales (el repo es público).
7. Revisa en el navegador (Playwright, 390 px) cada pantalla que cambies. Sin errores de JavaScript ni respuestas 5xx.
8. Haz commits por bloque, con mensajes claros en español, y súbelos a la rama indicada. Al final actualiza el conteo
   de docs/02 (resumen del inicio) y docs/14.

PARTE 1 · LOS 12 PENDIENTES DE docs/02
- RF-45 Pasarela real: adaptador para Webpay Plus (Transbank SDK), Mercado Pago y Flow, elegido con PAGOS_PROVEEDOR.
  Webhook/retorno firmado, idempotente (el mismo aviso dos veces no cobra dos veces), conciliación diaria y
  modo integración de Transbank para probar. Reembolso automático por la pasarela (RF-57).
- RF-55 Aviso automático al destinatario: adaptador de mensajería (WhatsApp Cloud API, SMS o correo) activado por
  variables; plantillas por estado; registro de cada aviso enviado; si no hay proveedor, se mantiene el botón manual.
- RF-59 / RNF-20 Plazo de conservación: plazos configurables (por defecto: fotos 12 meses, envíos 5 años);
  tarea diaria que anonimiza y borra archivos vencidos; informe de lo purgado; nunca borra envíos con reclamo abierto.
- RF-61 Autocompletar direcciones: interruptor en Ajustes (apagado por defecto); con GOOGLE_PLACES_KEY usa Places,
  guarda lat/lon en la dirección y valida que la comuna coincida con la elegida.
- RF-62 Operación sin señal para el repartidor: cola local (IndexedDB + service worker) de entregas e intentos
  con foto y GPS; se envía al volver la conexión; conflicto → aviso claro. Probar en E2E con modo sin conexión.
- RNF-01 / RNF-02 / RNF-08: guion de prueba presencial (docs/16-guion-pruebas-telefono.md) con planilla para
  cronometrar 5 envíos, y matriz Chrome/Safari/Android/iPhone. Agrega WebKit (Safari) a npm run e2e si es posible.
- RNF-07 Respaldos: script npm run respaldo (pg_dump comprimido a Supabase Storage con retención de 30 días),
  workflow diario de GitHub Actions y un script de restauración probado en una base vacía.
- RNF-12 Repositorio del cliente: guía de traspaso (docs/17-traspaso.md): transferir repo, Railway, Supabase, dominio.
- RNF-15 Ley 19.628 / 21.719: páginas públicas de Política de privacidad y Términos del servicio (#/privacidad,
  #/terminos), casilla de aceptación en registro y en el primer envío con fecha guardada, y registro de tratamientos
  (docs/18-datos-personales.md). Marcar que requiere validación de un abogado.

PARTE 2 · REQUERIMIENTOS QUE PROBABLEMENTE SE NOS PASARON (numerar desde RF-66 / RNF-26 y agregar a docs/02)
Prioridad alta (sin esto habrá errores o reclamos al operar con muchos usuarios):
- Limpieza de datos de prueba: script que borra usuarios y envíos "qa-…" de una base (hoy el QA contra Railway los deja).
- Documento tributario: la empresa debe emitir boleta/factura electrónica (SII) por cada envío pagado.
  Adaptador para un proveedor (OpenFactura, Bsale o Haulmer), simulado por defecto; el folio del DTE en el envío y en el ticket.
- Clientes empresa: tarifa especial por cliente (convenio), crédito con pago mensual y estado de cuenta.
- Asignación masiva: seleccionar varios envíos y asignarlos a un repartidor; sugerencia automática por comuna.
- Impresión masiva de etiquetas de varios envíos a la vez y hoja de ruta del día por repartidor (PDF).
- Carga masiva de envíos desde Excel/CSV para tiendas (plantilla descargable, validación fila por fila, informe de errores).
- Reagendar con fecha y franja nuevas (hoy "reagendado" no guarda cuándo).
- Constancia de entrega para el cliente: ver la foto y descargar un PDF con fecha, GPS y quién recibió.
- Cierre de caja diario del efectivo y las transferencias registradas a mano, por repartidor y por día.
- Liquidación de repartidores: entregas por período y monto a pagar (comisión configurable).
- Avisos internos para administración: envíos pagados sin asignar, reclamos nuevos, intentos fallidos (contador en el menú).
- Límite de solicitudes compartido (tabla en PostgreSQL o Redis) para cuando Railway use más de una instancia.
- Registro de errores del servidor con alertas (Sentry u otro, opcional por variable) y registros estructurados.
Prioridad media:
- Código de verificación (PIN) para entregas de alto valor declarado, que el destinatario dicta al repartidor.
- Calificación de la entrega por el destinatario desde la página de seguimiento (1 a 5 y comentario).
- Doble factor (código por correo) para cuentas de administración.
- Ambiente de pruebas separado en Railway (staging) para correr el QA sin tocar producción.
- Optimización automática del orden de la ruta a partir de las coordenadas guardadas.

ENTREGA ESPERADA
- Todos los requerimientos anteriores implementados y probados, o con el motivo concreto de por qué no
  (falta una credencial o una decisión del cliente), dejando el adaptador listo y el supuesto documentado.
- docs/02 con el conteo final, docs/08 con todos los casos CP nuevos y docs/14 actualizado.
- Al terminar, un resumen en español: qué quedó listo, qué debe hacer el dueño (variables, cuentas de proveedores)
  y qué debe responder el cliente.
```
