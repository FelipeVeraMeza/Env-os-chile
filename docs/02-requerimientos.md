# 02 · Requerimientos funcionales y no funcionales (v2.0)

Prioridad: **I** = Imprescindible · **A** = Alta · **M** = Media. Estado del prototipo v0.1: ✅ implementado y probado · 🟡 parcial · ⬜ pendiente para desarrollo.
Columna **QA**: casos de prueba automatizados que lo verifican (ver [08](08-plan-qa-y-criterios-de-aceptacion.md)).

## Requerimientos funcionales

### Cuentas y acceso
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-01 | El usuario inicia sesión con correo y contraseña | I | 🟡 API lista (`/api/auth/login`); la interfaz demo no pide login | — |
| RF-02 | Recuperación de contraseña por correo | A | ⬜ requiere proveedor de correo | — |
| RF-03 | La sesión dura 30 días en el dispositivo | A | 🟡 token JWT de 30 días | — |
| RF-04 | Tres perfiles (admin, cliente, repartidor) que limitan lo que se ve y hace | I | ✅ | CP-25, CP-60 a CP-62 |
| RF-05 | El administrador crea, edita y desactiva usuarios | A | ✅ | CP-61, CP-74 |

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
| RF-20 | Ticket con todos los datos del envío | I | ✅ | CP-22 |
| RF-21 | Formato térmico 80 mm y A4 (PDF) | A | ✅ | CP-22 |
| RF-22 | Imprimir, descargar y compartir (WhatsApp manual) | I | ✅ | — |
| RF-23 | QR único por envío | I | ✅ | CP-23 |
| RF-24 | El QR abre la navegación hacia el destino | I | ✅ | CP-23 |
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
| RF-45 | **Pago previo al retiro**: pago en línea o manual; sin pago el repartidor no puede retirar | I | 🟡 pasarela simulada; falta integrar el proveedor real | CP-26 a CP-28 |
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
| RF-55 | **Aviso automático al destinatario** (envío en camino, entregado, intento fallido) por WhatsApp, SMS o correo. Hoy solo se comparte el enlace de seguimiento a mano | A | ⬜ | Proveedor de mensajería (costo por mensaje) |
| RF-56 | **Registro autónomo de clientes** (sin que el administrador los cree) con verificación de correo | M | ⬜ | Pregunta C-9 · RF-01, RF-02 |
| RF-57 | **Reembolso** del pago cuando el envío se anula tras pagar o se devuelve después de 3 intentos | A | ⬜ | Pregunta C-7 · pasarela real (RF-45) |
| RF-58 | **Derechos de los titulares** (Ley 21.719): acceso, rectificación y supresión/anonimización de datos de un destinatario sin perder el historial contable | A | ⬜ | Revisión legal (RNF-15) |
| RF-59 | **Plazo de conservación**: borrar o anonimizar fotos y datos personales pasado el plazo definido | M | ⬜ | Pregunta C-11 · revisión legal · RNF-20 |
| RF-60 | **Orden de la ruta del repartidor** (por comuna o arrastrando) y vista de la ruta del día | M | ⬜ | Validar con repartidores en la semana de pruebas |
| RF-61 | **Autocompletar direcciones** (Google Places) | M | ⬜ | Pregunta C-12 · costo de la API de Google |
| RF-62 | **Operación sin señal** para el repartidor: guardar la entrega (foto + GPS) y enviarla al recuperar conexión | M | ⬜ | Pregunta C-12 |

## Requerimientos no funcionales

| ID | Requerimiento | Estado | Cómo se verifica |
|---|---|---|---|
| RNF-01 | Diseñado para celular primero, botones grandes, usable con una mano | 🟡 revisión automática en 390 px sin errores; falta equipo real | Revisión en equipo real del repartidor (semana de pruebas) |
| RNF-02 | Crear un envío completo en < 60 s con los datos a mano | ⬜ | Prueba cronometrada con 5 envíos reales |
| RNF-03 | Pantallas cargan en < 2 s con 4G | ⬜ | Lighthouse / DevTools con perfil "Fast 4G" |
| RNF-04 | Ticket con QR en < 3 s | ✅ | CP-76 (y medición de `/ticket.pdf` en Railway) |
| RNF-05 | Contraseñas con hash (bcrypt) y HTTPS siempre | ✅ | Revisión de código + certificado del dominio |
| RNF-06 | Fotos y boletas **nunca públicas**: solo con enlace firmado que expira (10 min) | ✅ | CP-33, CP-56 |
| RNF-07 | Respaldo diario de la base con 30 días de retención | ⬜ | Configuración de backups en Supabase (plan, A-8) |
| RNF-08 | Chrome y Safari (dos últimas versiones), Android e iOS | ⬜ | Matriz de navegadores en plan QA |
| RNF-09 | 20 usuarios simultáneos y 100.000 envíos sin degradarse | ⬜ | Prueba de carga previa a producción |
| RNF-10 | Español de Chile, CLP, dd-mm-aaaa, zona horaria America/Santiago | ✅ | Revisión visual; reportes calculados en America/Santiago |
| RNF-11 | El QR se genera aunque el servicio de mapas no responda | ✅ | CP-76: QR PNG generado en el servidor, sin dependencias externas |
| RNF-12 | Código documentado en un repositorio del cliente | 🟡 | Este repositorio (falta traspasarlo al cliente) |
| RNF-13 | Colores de marca: azul 60 %, magenta 30 %, blanco 10 % | ✅ | Revisión visual |
| RNF-14 | Las reglas críticas (pago antes de retirar, foto obligatoria, boleta obligatoria, tope del reclamo) se validan en el **servidor y en la base de datos**, no solo en pantalla | ✅ | CP-26, CP-29, CP-50; restricciones `CHECK`/`NOT NULL` en el esquema |
| RNF-15 | Cumplimiento de la Ley 19.628 y la Ley 21.719 (datos personales) | ⬜ | Revisión legal antes de producción |
| RNF-16 | **Límite de solicitudes por IP**: 1.200/min en la API, 60/min en el seguimiento público y la página del QR, 10 intentos de login cada 15 min. Responde 429 con `Retry-After`. Protege la demo abierta | ✅ | CP-78 y pruebas unitarias del limitador. Variables `LIMITE_API_POR_MINUTO`, `LIMITE_PUBLICO_POR_MINUTO` |
| RNF-17 | **Todo en la misma app**: la interfaz usa la API del mismo dominio (Railway sirve ambas), sin servidores ni fuentes externas; la política CSP solo permite `'self'` | ✅ | CP-77 |
| RNF-18 | **Monitoreo**: `/api/health` revisado cada 5 min con aviso por correo si falla | 🟡 endpoint listo; falta el servicio de avisos (p. ej. UptimeRobot, gratis) | Configurar el monitor y provocar una caída de prueba |
| RNF-19 | **Accesibilidad** WCAG 2.1 AA: contraste, etiquetas en todos los campos, uso con lector de pantalla | 🟡 campos con etiqueta; falta auditoría | Lighthouse Accesibilidad ≥ 90 |
| RNF-20 | **Retención de datos** definida (fotos de entrega, boletas y datos de destinatarios) | ⬜ | Documento firmado con el cliente (ver RF-59) |
| RNF-21 | La **demo abierta no se usa con datos reales**: los datos cargados en la demo son de prueba y pueden borrarse | ✅ decisión | Aviso al cliente al compartir el enlace; producción usa `AUTH_MODE=jwt` |
