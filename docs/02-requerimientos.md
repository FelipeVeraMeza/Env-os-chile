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
| RF-05 | El administrador crea, edita y desactiva usuarios | A | ✅ | CP-61 |

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
| RF-17 | El administrador define tarifas por comuna o zona | A | ✅ | — |
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
| RF-25 | El administrador elige si el QR abre página, Google Maps o Waze | M | ✅ | — |
| RF-26 | Botones "Google Maps / Waze" en el detalle sin escanear | A | ✅ | — |

### Registro y estados
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-27 | Listado paginado de envíos | I | ✅ | CP-66 |
| RF-28 | Búsqueda por folio, nombre, teléfono o dirección | A | ✅ | CP-66 |
| RF-29 | Filtros por fecha, comuna, estado y repartidor | A | ✅ | — |
| RF-30 | Estados con historial de quién y cuándo | I | ✅ | CP-32 |
| RF-31 | Intento fallido con motivo obligatorio; **máximo 3 intentos**, luego devolución | I | ✅ | CP-40, CP-42 |
| RF-32 | **Foto obligatoria para cerrar la entrega** | I | ✅ | CP-29 |
| RF-33 | Los envíos se anulan, nunca se borran | A | ✅ | CP-63 |

### Ganancias y reportes
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-34 | Totales de envíos y montos por día y período | I | ✅ | CP-61 |
| RF-35 | Desglose por comuna y repartidor | A | ✅ | — |
| RF-36 | Registro de costos y cálculo del neto | A | ✅ | CP-59 |
| RF-37 | Exportación a Excel (CSV) | A | ✅ | CP-66 |
| RF-38 | Instalable como app desde el navegador (PWA) | A | ✅ | — |
| RF-39 | Configuración de logo, datos del negocio y textos del ticket | M | ✅ | — |
| RF-40 | Auditoría de acciones sensibles | M | ✅ | — |

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
| RF-51 | Nombre y logo de la empresa configurables (por definir) | M | ✅ | — |

### Nuevos (29/09/2026: repartidor sin envíos visibles y cobranza, ver [15](15-diagnostico-envios-y-cobranza.md))
| ID | Requerimiento | Prio. | Proto. | QA |
|---|---|---|---|---|
| RF-52 | El repartidor ve los envíos **pagados sin asignar** y puede **tomarlos** (configurable); si dos lo toman a la vez, solo uno lo consigue | I | ✅ | CP-70 a CP-73 |
| RF-53 | Un envío solo queda "pagado" con un **pago verificado** (orden, monto exacto en CLP e ID de transacción); regla también en la base de datos | I | ✅ | CP-74, CP-75 |
| RF-54 | **Bitácora de cada pago** (inicio, notificación, verificación, rechazo, conciliación) | I | ✅ | CP-74 |
| RF-55 | **Cobranza**: cobrado, por cobrar, comisiones de la pasarela y abonos por llegar; conciliación con la cartola (la comisión real es costo "pasarela") | A | ✅ | CP-76 |
| RF-56 | **Comparador** del costo de cobrar con cada proveedor de pago y proyección mensual | M | ✅ | CP-76 |

## Requerimientos no funcionales

| ID | Requerimiento | Cómo se verifica |
|---|---|---|
| RNF-01 | Diseñado para celular primero, botones grandes, usable con una mano | Revisión en equipo real del repartidor (semana de pruebas) |
| RNF-02 | Crear un envío completo en < 60 s con los datos a mano | Prueba cronometrada con 5 envíos reales |
| RNF-03 | Pantallas cargan en < 2 s con 4G | Lighthouse / DevTools con perfil "Fast 4G" |
| RNF-04 | Ticket con QR en < 3 s | Medición de `/ticket.pdf` en Railway |
| RNF-05 | Contraseñas con hash (bcrypt) y HTTPS siempre | Revisión de código + certificado del dominio |
| RNF-06 | Fotos y boletas **nunca públicas**: solo con enlace firmado que expira (10 min) | CP-33, CP-56 |
| RNF-07 | Respaldo diario de la base con 30 días de retención | Configuración de backups en Railway |
| RNF-08 | Chrome y Safari (dos últimas versiones), Android e iOS | Matriz de navegadores en plan QA |
| RNF-09 | 20 usuarios simultáneos y 100.000 envíos sin degradarse | Prueba de carga previa a producción |
| RNF-10 | Español de Chile, CLP, dd-mm-aaaa, zona horaria America/Santiago | Revisión visual |
| RNF-11 | El QR se genera aunque el servicio de mapas no responda | QR generado en el servidor, sin dependencias externas |
| RNF-12 | Código documentado en un repositorio del cliente | Este repositorio |
| RNF-13 | Colores de marca: azul 60 %, magenta 30 %, blanco 10 % | Revisión visual |
| RNF-14 | Las reglas críticas (pago antes de retirar, foto obligatoria, boleta obligatoria, tope del reclamo) se validan en el **servidor y en la base de datos**, no solo en pantalla | CP-26, CP-29, CP-50; restricciones `CHECK`/`NOT NULL` en el esquema |
| RNF-15 | Cumplimiento de la Ley 19.628 y la Ley 21.719 (datos personales) | Revisión legal antes de producción |
