# 02 · Requerimientos funcionales y no funcionales (v2.0)

Prioridad: **I** = Imprescindible · **A** = Alta · **M** = Media. Estado del prototipo v0.1: ✅ implementado y probado · 🟡 parcial · ⬜ pendiente para desarrollo.
Columna **QA**: casos de prueba automatizados que lo verifican (ver [08](08-plan-qa-y-criterios-de-aceptacion.md)).

> **Estado al 26-09-2026: 78 de 90 requerimientos listos y probados** (60 de 65 funcionales, 18 de 25 no funcionales).
> Los 12 pendientes no dependen del código de esta etapa:
> - **Del cliente o de un proveedor:** pasarela real RF-45 (C-3), aviso automático pagado RF-55, plazo de conservación RF-59 y RNF-20 (C-11), Google Places RF-61 y operación sin señal RF-62 (C-12).
> - **De pruebas presenciales:** teléfonos reales RNF-01, cronometrar a personas RNF-02 y matriz de navegadores Safari/iPhone RNF-08.
> - **De la cuenta del cliente:** respaldos en Supabase RNF-07, traspaso del repositorio RNF-12 y revisión legal RNF-15.

## Requerimientos funcionales

### Cuentas y acceso
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-01 | El usuario inicia sesión con correo y contraseña; la cuenta se bloquea 15 min tras 5 intentos fallidos | I | ✅ `AUTH_MODE=jwt` | CP-85, CP-131 a CP-134 |
| RF-02 | Recuperación de contraseña | A | ✅ enlace de un solo uso (1 h) por correo si hay `SMTP_URL`, o administración lo comparte por WhatsApp; o contraseña temporal que se cambia al entrar | CP-87, CP-136 |
| RF-03 | La sesión dura 30 días en el dispositivo; cambiar la contraseña, cerrar sesiones o desactivar al usuario las cierra | A | ✅ | CP-85, CP-135, CP-137, CP-148 |
| RF-04 | Tres perfiles (admin, cliente, repartidor) que limitan lo que se ve y hace | I | ✅ | CP-25, CP-60 a CP-62 |
| RF-05 | El administrador crea, edita y desactiva usuarios | A | ✅ no se desactiva un repartidor con envíos en curso | CP-61, CP-74, CP-89 |

### Destinatarios y direcciones
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-06 | Registrar destinatarios con nombre y teléfono chileno (+56 9) | I | ✅ | CP-20, CP-21 |
| RF-07 | Direcciones con calle, número, depto, referencia y comuna | I | ✅ | CP-21 |
| RF-08 | Lista oficial de 346 comunas con región y provincia | I | ✅ | CP-03 |
| RF-09 | Libreta del cliente: cada destinatario con **varias direcciones** reutilizables; las antiguas se desactivan sin borrarse | A | ✅ | CP-64, CP-65 |

### Alta del envío
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-10 | Descripción del producto, bultos, peso y dimensiones | I | ✅ | CP-21 |
| RF-11 | Validación de campos obligatorios antes de continuar, marcando los errores | I | ✅ | CP-20 |
| RF-12 | Foto del paquete al crear (opcional) | M | ✅ | — |
| RF-13 | Tomar foto con la cámara del celular y poder repetirla | I | ✅ | CP-31 |
| RF-14 | La foto se comprime (≤ 1600 px) y queda asociada al envío | I | ✅ | CP-32 |
| RF-15 | Se eliminan los metadatos de ubicación (EXIF) de la foto | A | ✅ | CP-32 |
| RF-16 | La comuna determina la tarifa: $3.500 base dentro de Santiago | I | ✅ | CP-10 |
| RF-17 | El administrador define tarifas por comuna o zona | A | ✅ | CP-68 |
| RF-18 | No se pueden crear envíos a comunas fuera de cobertura | M→A | ✅ | CP-18 |
| RF-19 | Al confirmar se asigna un folio único `ENV-AAAA-NNNNNN` | I | ✅ | CP-21 |

### Ticket, QR y mapas
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-20 | Etiqueta mínima para pegar en el paquete (pedido del cliente 03-10): logo, folio, QR, remitente (nombre, teléfono, RUT), destinatario (nombre, teléfono, RUT) y dirección con referencia, comuna y región. Bulto, pago, estado, contenido y firma se ven en la app y en el sistema | I | ✅ | CP-22, CP-84 |
| RF-21 | Formato térmico 80 mm y A4 (PDF) | A | ✅ | CP-22 |
| RF-22 | Imprimir, descargar y compartir (WhatsApp manual) | I | ✅ | — |
| RF-23 | QR único por envío | I | ✅ | CP-23 |
| RF-24 | El QR abre **Google Maps con la dirección** del destino (configurable: Google Maps, Waze o página con ambos) | I | ✅ | CP-23, CP-71, CP-84 |
| RF-25 | El administrador elige si el QR abre página, Google Maps o Waze | M | ✅ | CP-71 |
| RF-26 | Botones "Google Maps / Waze" en el detalle sin escanear | A | ✅ | CP-71 |

### Registro y estados
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-27 | Listado paginado de envíos | I | ✅ | CP-66 |
| RF-28 | Búsqueda por folio, nombre, teléfono o dirección | A | ✅ | CP-66 |
| RF-29 | Filtros por fecha, comuna, estado y repartidor | A | ✅ | CP-69 |
| RF-30 | Estados con historial de quién y cuándo | I | ✅ | CP-32 |
| RF-31 | Intento fallido con motivo obligatorio; **máximo 3 intentos**, luego devolución | I | ✅ | CP-40, CP-42 |
| RF-32 | **Foto obligatoria para cerrar la entrega** | I | ✅ | CP-29 |
| RF-33 | Los envíos se anulan, nunca se borran | A | ✅ | CP-63 |

### Ganancias y reportes
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-34 | Totales de envíos y montos por día y período | I | ✅ | CP-61, CP-70 |
| RF-35 | Desglose por comuna y repartidor | A | ✅ | CP-70 |
| RF-36 | Registro de costos y cálculo del neto | A | ✅ | CP-59 |
| RF-37 | Exportación a Excel (CSV) | A | ✅ | CP-66 |
| RF-38 | Instalable como app desde el navegador (PWA) | A | ✅ | CP-75 |
| RF-39 | Configuración de logo, datos del negocio y textos del ticket | M | ✅ | CP-72 |
| RF-40 | Auditoría de acciones sensibles | M | ✅ | CP-73 |

### Nuevos (puntos del cliente)
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-41 | Entrega en **puntos Blue Express, Starken u otras** con empresa y sucursal, **sin límite de bultos** por $3.500 | I | ✅ | CP-13, CP-14 |
| RF-42 | Límite de tarifa estándar: **20 kg y 60×60×60 cm por bulto**; sobre eso, cotización especial por administración | I | ✅ | CP-15 a CP-17, CP-19 |
| RF-43 | Botón "Llegué": inicia una **espera máxima de 5 minutos**; el motivo "espera excedida" solo se habilita al cumplirse | A | ✅ | CP-41 |
| RF-44 | **Ubicación GPS** obligatoria (configurable) al cerrar cada entrega; también en intentos fallidos | I | ✅ | CP-30, CP-31 |
| RF-45 | **Pago previo al retiro, solo por transferencia** (pedido 07-10): el cliente transfiere y sube el comprobante (RF-71); administración lo aprueba o rechaza. El pago en línea y el link de pago quedan apagados (`pagos.en_linea = false`). Administración puede registrar a mano un pago recibido por otro medio. Sin pago aprobado el repartidor no puede retirar | I | ✅ | CP-26 a CP-28, CP-160 a CP-170 |
| RF-46 | **Seguimiento público por folio** con estado e historial, sin datos personales | I | ✅ | CP-24, CP-44 |
| RF-47 | **Envío especial por horario**: +$1.000 con franja horaria obligatoria | A | ✅ | CP-11, CP-12 |
| RF-48 | **Seguro**: valor declarado por envío; el reclamo exige **boleta obligatoria** (archivo + N°, fecha y monto) | I | ✅ | CP-50, CP-51 |
| RF-49 | El monto reclamado no supera el valor declarado ni el de la boleta; un reclamo activo por envío | I | ✅ | CP-52, CP-55 |
| RF-50 | Administración revisa, aprueba (con monto) o rechaza (con motivo) y paga; el pago queda como costo "seguro" | I | ✅ | CP-57 a CP-59 |
| RF-51 | Nombre y logo de la empresa configurables (por definir) | M | ✅ | CP-72 |

### Agregados en la etapa de pruebas (septiembre 2026)
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-52 | **Couriers y franjas horarias** editables en Ajustes (una opción por línea); el servidor solo acepta los valores configurados | A | ✅ | CP-67 |
| RF-53 | **Demo abierta**: se entra eligiendo un perfil, sin clave (decisión del 26-09-2026). `DEMO_CLAVE` queda opcional para volver a protegerla | A | ✅ | CP-79 |
| RF-54 | El administrador **consulta el registro de auditoría** (quién hizo qué y cuándo) en Ajustes → Actividad reciente y en `GET /api/auditoria` | M | ✅ | CP-73 |

### Pendientes detectados (no estaban en el alcance)
Faltan para operar con clientes reales. La mayoría depende de respuestas del cliente (ver [14](14-plan-de-accion.md), bloque C) o de la etapa de desarrollo.
| ID | Requerimiento | Prio. | Proto. | Depende de |
|---|---|---|---|---|
| RF-55 | **Aviso al destinatario** (en camino, entregado, intento fallido) | A | 🟡 botón "Avisar por WhatsApp" con el mensaje listo según el estado (sin costo). El envío automático requiere proveedor pagado | E2E |
| RF-56 | **Registro autónomo de clientes**, habilitable por administración (cerrado por defecto) | M | ✅ | CP-88 |
| RF-57 | **Reembolso** (total o parcial) del pago de un envío anulado o devuelto; aparece en el reporte | A | ✅ registro manual; con la pasarela real se automatiza. La política la define el cliente (C-7) | CP-90 |
| RF-58 | **Derechos de los titulares** (Ley 21.719): exportar los datos de un destinatario y anonimizarlo sin perder el historial contable | A | ✅ falta validación legal (RNF-15) | CP-91 |
| RF-59 | **Plazo de conservación**: borrar o anonimizar fotos y datos personales pasado el plazo definido | M | ⬜ | Pregunta C-11 · revisión legal · RNF-20 |
| RF-60 | **Orden de la ruta del repartidor** (subir/bajar paradas) | M | ✅ | CP-92 |
| RF-61 | **Autocompletar direcciones** (Google Places) | M | ⬜ | Pregunta C-12 · costo de la API de Google |
| RF-62 | **Operación sin señal** para el repartidor: guardar la entrega (foto + GPS) y enviarla al recuperar conexión | M | ⬜ | Pregunta C-12 |

### Agregados para operar con muchos usuarios (26-09-2026)
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-63 | **Una etiqueta por bulto** en el ticket térmico ("Bulto 2 de 3"), con el alto justo al contenido (sin papel en blanco) | A | ✅ | CP-84 |
| RF-64 | **Actualización automática**: las pantallas de ruta, detalle, inicio y registro se refrescan solas cada 30 s sin interrumpir a quien escribe | A | ✅ | E2E (el cliente ve "Entregado" sin recargar) |
| RF-65 | **Cerrar sesión** y **Mi cuenta** (cambiar contraseña) para cada usuario | A | ✅ | CP-86 |

### Nuevos (29/09/2026: repartidor sin envíos visibles y cobranza, ver [15](15-diagnostico-envios-y-cobranza.md))
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-66 | El repartidor ve los envíos **pagados sin asignar** y puede **tomarlos** (configurable); si dos lo toman a la vez, solo uno lo consigue | I | ✅ | CP-110 a CP-113 |
| RF-67 | Un envío solo queda "pagado" con un **pago verificado** (orden, monto exacto en CLP e ID de transacción); regla también en la base de datos | I | ✅ | CP-114, CP-115 |
| RF-68 | **Bitácora de cada pago** (inicio, notificación, verificación, rechazo, conciliación) | I | ✅ | CP-114 |
| RF-69 | **Cobranza**: cobrado, por cobrar, comisiones de la pasarela y abonos por llegar; conciliación con la cartola (la comisión real es costo "pasarela") | A | ✅ | CP-116 |
| RF-70 | **Comparador** del costo de cobrar con cada proveedor de pago y proyección mensual | M | ✅ | CP-116 |
| RF-71 | **Pago por transferencia con comprobante**: el cliente sube la imagen (o PDF) de la transferencia y el pago queda **en revisión**; administración la ve y **aprueba** o **rechaza con motivo** (el cliente sube otra). **El pago manda**: sin pago aprobado no se asigna repartidor ni se retira (la etiqueta sí se imprime antes de pagar, pedido 03-10). Avisa si el mismo comprobante o N° de operación ya se usó en otro envío | I | ✅ | CP-160 a CP-170 |
| RF-72 | **Etiqueta antes de pagar** (pedido 03-10): el cliente ve e imprime la etiqueta (80 mm y A4) apenas confirma el envío. El botón es un enlace firmado que vence en 12 horas, así el celular abre el PDF directo (antes el navegador del celular bloqueaba la pestaña y la etiqueta no salía) | I | ✅ | CP-22, CP-160, simulación por rol |
| RF-73 | **Anulación automática por falta de pago** (pedido 03-10): un envío confirmado que sigue con el pago pendiente 24 horas después (configurable con `ANULAR_SIN_PAGO_HORAS`) se anula solo y queda en su historial como "Sistema". No se anulan los que tienen un comprobante en revisión ni los que ya tienen repartidor. El cliente ve el plazo en el envío | I | ✅ | simulación de vencimiento |
| RF-74 | **Copiar datos de la transferencia** con un toque: monto exacto (sin puntos ni signo), N° de cuenta, RUT y correo, en el pago de un envío y en el carrito | A | ✅ | simulación ★1 |
| RF-75 | **Aviso antes de la anulación**: correo automático al cliente 2 horas antes (si hay SMTP), aviso en el inicio y en "Por pagar" con la hora límite, y botón "Recordar por WhatsApp" en Cobranza | A | ✅ | simulación ★2 y ★19 |
| RF-76 | **Repetir un envío**: desde el detalle, el asistente se abre con el mismo retiro, destinatario, dirección y paquete (el valor declarado no se copia) | A | ✅ | simulación ★3 |
| RF-77 | **Cobranza: por vencer**: lista de envíos sin pagar con la hora en que se anulan y cuánto falta | I | ✅ | simulación ★19 |
| RF-78 | **Etiquetas del día en lote**: un PDF con todas las etiquetas de los envíos confirmados un día (térmica: una por bulto; A4: una hoja por envío), por enlace firmado solo para administración | A | ✅ | simulación ★20 |
| RF-79 | **Reactivar** un envío que se anuló solo por falta de pago: vuelve a "creado" con 24 horas nuevas; queda en el historial. No aplica a anulaciones hechas a mano | A | ✅ | simulación ★21 |
| RF-80 | **Ordenar la ruta automáticamente** desde la ubicación del repartidor (vecino más cercano + 2-opt; GPS de la dirección o centro de la comuna) | A | ✅ | tests/unit/rutas, simulación ★36 |
| RF-81 | **Escanear la etiqueta**: la cámara lee el QR (o se escribe el folio si el teléfono no tiene lector); un envío por retirar se marca retirado y uno en ruta abre la entrega | A | ✅ | simulación ★37 |
| RF-82 | **Firma del destinatario** en la pantalla al entregar (opcional): queda como imagen del envío, también en entregas guardadas sin señal | A | ✅ | simulación ★38 |
| RF-83 | **Cuenta para transferencias obligatoria**: si falta el banco o el N° de cuenta, el panel y Cobranza avisan a administración (con enlace a Ajustes), porque el cliente no tendría a qué cuenta transferir | I | ✅ | revisión en pantalla |
| RF-84 | **Aviso al cliente cuando se revisa su comprobante**: correo al aprobarlo (envío pagado, listo para retiro) o al rechazarlo (con el motivo y el enlace para subir otro). Un carrito manda un solo correo con todos sus folios. Requiere SMTP (`SMTP_URL`); sin correo, el cliente lo ve en la app | A | ✅ con SMTP configurado | revisión con SMTP de prueba |
| RF-85 | **Nombres más claros** (pedido 07-10): el enlace del ingreso y del inicio dice "Seguimiento de envío"; la libreta de destinatarios se llama **"Guardados"** | M | ✅ | revisión en pantalla |
| RF-86 | **Anulados fuera de la vista del cliente** (pedido 07-10): un envío anulado deja de aparecer en la cuenta del cliente 24 horas después de anularse, o antes si toca **"Eliminar de mis envíos"**. No se borra de la base: administración lo sigue viendo y, si lo reactiva, vuelve a aparecer | A | ✅ | revisión en pantalla |
| RF-87 | **Recuperar contraseña sin correo configurado** (pedido 07-10): la solicitud avisa a administración (Panel y Usuarios marcan a quien la pidió) para enviarle el enlace por WhatsApp; el cliente ve un botón para escribir por WhatsApp a la empresa (teléfono de Ajustes). Con `SMTP_URL` en Railway el enlace llega solo por correo | I | ✅ | revisión en pantalla |
| RF-88 | **Seguro: "gestión" en vez de "cobro"** (pedido 07-10): la boleta es obligatoria "para la gestión del seguro" en todos los textos | B | ✅ | revisión en pantalla |
| RF-89 | **Botones más visibles** (pedido 07-10): los secundarios tienen fondo más claro, borde y sombra; los de etiqueta son blancos con ícono de impresora | M | ✅ | revisión en pantalla |
| RF-90 | **Horario de retiro visible** (pedido 07-10): "Agenda hasta las 23:59 y retiramos tu paquete al día siguiente entre las 9:00 y las 13:00 hrs." en el paso Retiro y en el inicio del cliente; se edita en Tarifas y reglas | A | ✅ | revisión en pantalla |
| RF-91 | **Cambiar la dirección de destino antes del retiro** (pedido 07-10), aunque el envío ya esté pagado: otra dirección guardada del destinatario o una nueva. Pagado, el monto no cambia y la nueva no puede costar más (administración sí puede); por pagar, la tarifa se actualiza. No se puede con un comprobante en revisión ni después del retiro. Máximo 3 cambios del cliente; queda en el historial y hay que reimprimir la etiqueta | I | ✅ | CP-240 a CP-243 |
| RF-92 | **Reagendar el retiro** (pedido 07-10) cuando el repartidor ya tomó el servicio (o antes): el cliente elige otro día, desde mañana hasta 14 días. El repartidor lo sigue teniendo y ve la nueva fecha; al ordenar la ruta ese retiro queda al final. Máximo 3 veces del cliente; queda en el historial | I | ✅ | CP-244, CP-245, CP-247 |
| RF-93 | **Ruta completa en Google Maps** (pedido 07-10): la ruta ordenada (vecino más cercano + 2-opt desde el GPS) se abre en Maps con todas las paradas en orden; con más de 10 paradas se divide en tramos. Cada paquete muestra su orden (1.º … último) | A | ✅ | CP-247, revisión en pantalla |
| RF-94 | **Envíos filtrados por cliente y por pago** (pedido 07-10): en el registro de envíos, administración filtra por cliente y por estado del pago (por pagar, pendiente de aprobación, pagado) | A | ✅ | revisión en pantalla |
| RF-95 | **Pago de muchos envíos aprobado de una vez** (pedido 07-10): Cobranza agrupa por cliente lo por pagar y lo pendiente de aprobación; con "Aprobar pago" se marcan todos (se pueden desmarcar) y se aprueban juntos: los que tienen comprobante con su comprobante (el carrito completo), los demás como transferencia con el N° de operación. Todo o nada, solo un cliente a la vez, hasta 100 envíos. El carrito del cliente acepta hasta 100 envíos por comprobante | I | ✅ | CP-250 a CP-253 |
| RF-96 | **Revisión lado a lado** (pedido 07-10): al revisar un comprobante o aprobar el pago de un cliente, el comprobante se ve a la izquierda y a la derecha los envíos (folio, destinatario, comuna, monto) con su total; al escribir el monto del comprobante avisa si coincide, cuánto falta o cuánto sobra. Ya aprobado, el comprobante sigue visible en el envío (con los envíos que pagó) | I | ✅ | CP-250, CP-251 |
| RF-97 | **Seguimiento con los intentos de entrega** (pedido 07-10): cada paso dice el intento ("En ruta: intento 2 de 3", "Intento 1 de 3: no se pudo entregar — Nadie en el domicilio") y, si se devuelve, "Devuelto al remitente después de 3 intentos". En el seguimiento público solo el motivo general, nunca el detalle del repartidor. El historial del envío muestra lo mismo con el motivo legible | I | ✅ | CP-260 |
| RF-98 | **Siguiente intento por el repartidor** (pedido 07-10): tras un intento fallido, el repartidor (o administración) programa el siguiente hasta el máximo; después del último solo administración devuelve al remitente. El cliente no reagenda intentos. "Repetir envío" pasa a llamarse **"Crear envío igual"** (crea un envío nuevo con los mismos datos; no es un reintento) | I | ✅ | CP-261 |

## Requerimientos no funcionales

| ID | Requerimiento | Estado | Cómo se verifica |
|---|---|---|---|
| RNF-01 | Diseñado para celular primero, botones grandes, usable con una mano | 🟡 flujo completo probado por interfaz en 390 px (E2E); falta equipo real | Revisión en equipo real del repartidor (semana de pruebas) |
| RNF-02 | Crear un envío completo en < 60 s con los datos a mano | 🟡 el formulario (4 pasos) se completa en ~1 s automatizado; falta cronometrar a personas | Prueba cronometrada con 5 envíos reales |
| RNF-03 | Pantallas cargan en < 2 s con 4G | ✅ local con 4G simulado (150 ms, 9 Mbps, CPU ×4, sin caché): 0,9 a 1,7 s. Módulos precargados y respuestas comprimidas (gzip). Repetir contra Railway | `npm run rendimiento` |
| RNF-04 | Ticket con QR en < 3 s | ✅ | CP-76 (y medición de `/ticket.pdf` en Railway) |
| RNF-05 | Contraseñas con hash (bcrypt) y HTTPS siempre | ✅ | Revisión de código + certificado del dominio |
| RNF-06 | Fotos y boletas **nunca públicas**: solo con enlace firmado que expira (10 min) | ✅ | CP-33, CP-56 |
| RNF-07 | Respaldo diario de la base con 30 días de retención | ⬜ | Configuración de backups en Supabase (plan, A-8) |
| RNF-08 | Chrome y Safari (dos últimas versiones), Android e iOS | ⬜ | Matriz de navegadores en plan QA |
| RNF-09 | 20 usuarios simultáneos y 100.000 envíos sin degradarse | ✅ local: 100 clientes + 30 repartidores a la vez, 3.231 solicitudes, 0 errores, p95 347 ms (pool de 5 conexiones, como Supabase); con 100.000 envíos las consultas responden en < 0,25 s. Repetir contra Railway | `npm run carga` |
| RNF-10 | Español de Chile, CLP, dd-mm-aaaa, zona horaria America/Santiago | ✅ | Revisión visual; reportes calculados en America/Santiago |
| RNF-11 | El QR se genera aunque el servicio de mapas no responda | ✅ | CP-76: QR PNG generado en el servidor, sin dependencias externas |
| RNF-12 | Código documentado en un repositorio del cliente | 🟡 | Este repositorio (falta traspasarlo al cliente) |
| RNF-13 | Colores de marca: azul 60 %, magenta 30 %, blanco 10 % | ✅ | Revisión visual |
| RNF-14 | Las reglas críticas (pago antes de retirar, foto obligatoria, boleta obligatoria, tope del reclamo) se validan en el **servidor y en la base de datos**, no solo en pantalla | ✅ | CP-26, CP-29, CP-50; restricciones `CHECK`/`NOT NULL` en el esquema |
| RNF-15 | Cumplimiento de la Ley 19.628 y la Ley 21.719 (datos personales) | ⬜ | Revisión legal antes de producción |
| RNF-16 | **Límite de solicitudes por IP**: 1.200/min en la API, 60/min en el seguimiento público y la página del QR, 10 intentos de login cada 15 min. Responde 429 con `Retry-After`. Protege la demo abierta | ✅ | CP-78 y pruebas unitarias del limitador. Variables `LIMITE_API_POR_MINUTO`, `LIMITE_PUBLICO_POR_MINUTO` |
| RNF-17 | **Todo en la misma app**: la interfaz usa la API del mismo dominio (Railway sirve ambas), sin servidores ni fuentes externas; la política CSP solo permite `'self'` | ✅ | CP-77 |
| RNF-18 | **Monitoreo**: `/api/health` revisado cada 15 min, con aviso por correo si falla | ✅ GitHub Actions (`.github/workflows/monitoreo.yml`); se activa al llegar a la rama principal | Pestaña Actions → Monitoreo |
| RNF-19 | **Accesibilidad** WCAG 2.1 AA: contraste, etiquetas en todos los campos, uso con teclado y lector de pantalla | ✅ 11 pantallas sin problemas graves (axe-core); falta prueba con lector de pantalla real | `npm run accesibilidad` |
| RNF-20 | **Retención de datos** definida (fotos de entrega, boletas y datos de destinatarios) | ⬜ | Documento firmado con el cliente (ver RF-59) |
| RNF-22 | **Varias personas sobre el mismo envío a la vez** sin pisarse: cada cambio se aplica solo si el envío sigue como estaba (si no, 409 y se pide recargar). Folios, pagos, asignaciones, intentos y reclamos nunca se duplican | ✅ | CP-80 a CP-83 (fallaban con el código anterior) |
| RNF-23 | **Prueba extremo a extremo por la interfaz**: cliente, administración y repartidor en teléfonos distintos al mismo tiempo | ✅ | `npm run e2e` |
| RNF-25 | **Pruebas automáticas en cada cambio** (unitarias, QA, carga, extremo a extremo y accesibilidad) | ✅ | `.github/workflows/pruebas.yml` |
| RNF-24 | La base de datos se crea igual en Supabase y en el servidor, y el script SQL se puede ejecutar varias veces sin errores | ✅ | Verificado en base nueva (2 ejecuciones) |
| RNF-21 | La **demo abierta no se usa con datos reales**: los datos cargados en la demo son de prueba y pueden borrarse | ✅ decisión | Aviso al cliente al compartir el enlace; producción usa `AUTH_MODE=jwt` |
