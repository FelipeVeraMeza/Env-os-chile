# 15 · Diagnóstico de envíos, cobranza y verificación de pagos

> 29/09/2026. Responde a: "creé un pedido nuevo, está pagado y al repartidor no le sale nada", y agrega
> el modelo de **cobranza** para verificar que el pago realmente se hizo y estimar sus costos.

## 1. Por qué el repartidor no veía el pedido

**Reproducido en local.** El cliente crea el envío, lo paga y el envío queda así:

| Folio | Estado | Pago | Repartidor |
|---|---|---|---|
| ENV-2026-000001 | `creado` | `pagado` | **ninguno** |

La pantalla **Mi ruta** del repartidor solo mostraba envíos **ya asignados a él**
(`asignado`, `en_ruta`, `reagendado`, `fallido` con `repartidor_id` = él). El único que podía asignar era
el administrador (Envíos → detalle → "Repartidor asignado", o el recuadro **Sin asignar** del Panel).
Nada asignaba automáticamente ni avisaba al repartidor. Por eso un envío pagado quedaba esperando sin que
nadie lo viera. **No era una falla de datos ni de Supabase**: faltaba un paso del flujo.

### Corrección

- **Disponibles para tomar** (nuevo, en *Mi ruta*): el repartidor ve los envíos **pagados y sin repartidor**
  (comuna, dirección, bultos y peso; nunca montos) y pulsa **Tomar**. Pasa a *Por retirar* y sigue el flujo normal.
- Si dos repartidores pulsan **Tomar** a la vez, solo uno lo consigue (la condición va en el mismo `UPDATE`);
  el otro recibe "ya fue tomado por otro repartidor".
- Un envío **sin pagar no aparece** como disponible y no se puede tomar (se mantiene la regla de pago previo).
- Administración puede seguir asignando a mano. En **Tarifas → Operación** hay un interruptor
  *"Los repartidores pueden tomar envíos pagados sin asignar"* (activado por defecto). Si se apaga, el
  repartidor ve el aviso "Administración te asigna los envíos".
- API: `GET /api/envios/disponibles` y `POST /api/envios/:id/tomar`. QA: CP-110 a CP-113.

### Cómo comprobarlo en Railway después del despliegue

1. Como **Cliente**: crear envío → *Pagar* (simulado).
2. Como **Repartidor**: *Mi ruta* → aparece en **Disponibles para tomar** → **Tomar** → pasa a *Por retirar* → *Retirar y salir a ruta*.
3. El envío de prueba que ya creaste también aparecerá como disponible (si está pagado y sin repartidor).
4. Si usas el teléfono con la app instalada y no ves el cambio, cierra y vuelve a abrir la app (se actualizó la caché a `envios-v4`).

## 2. Cobranza: verificar que el pago realmente ocurrió

### Qué cambia

Antes, "pagado" era solo una marca en el envío. Ahora **cada cobro es un registro de pago verificado**,
y la base de datos **no deja** marcar un envío como pagado sin él.

```
Cliente paga ──► pago "iniciado" ──► la pasarela informa ──► VERIFICACIÓN ──► pago "aprobado" ──► envío "pagado"
                    (bitácora: inicio)      (bitácora: notificación)   │            (bitácora: verificación)
                                                                        └─ no calza ─► 422, no se marca pagado
Administración ve la cartola ──► CONCILIACIÓN: monto abonado + fecha ──► comisión real = costo "pasarela"
```

**Reglas de verificación** (`server/lib/cobranza.js → verificarConfirmacion`). Un pago se aprueba solo si:

| Regla | Por qué |
|---|---|
| La orden (token) informada es la de este pago | Evita aplicar el pago de otro envío |
| El **monto es exacto** al cobrado, en **CLP** | Evita pagos parciales o manipulados |
| Viene el **identificador de transacción** del proveedor | Permite reclamar y conciliar con la cartola |
| El pago estaba `iniciado` (no procesado antes) | Evita doble procesamiento |
| No existe otro pago aprobado del mismo envío | Índice único: un envío no se cobra dos veces |

El simulador de la demo ya pasa por estas mismas reglas, así que al conectar la pasarela real solo
cambia **quién informa** (webhook o consulta a la API), no la lógica.

### Pago por transferencia con comprobante (migración `009_comprobante_transferencia.sql`)

```
Cliente transfiere y sube la imagen ──► pago "en_revision" · envío "en_revision" (sin ticket, sin asignar, sin retiro)
                                              │
Administración (Cobranza → Revisar) ──► APRUEBA ──► pago "aprobado" (verificación manual) ──► envío "pagado" ──► ticket, asignación, retiro
                                        RECHAZA con motivo ──► pago "rechazado" ──► envío "pendiente" ──► el cliente ve el motivo y sube otro
```

- La cuenta a la que se transfiere se configura en **Ajustes → Cuenta para transferencias** y se muestra al cliente al pagar.
- Un envío tiene **un solo comprobante en revisión** a la vez (índice único), y mientras está en revisión no se puede pagar en línea, generar link de pago ni registrar pago manual (evita cobrar dos veces).
- Al revisar, se avisa si el **mismo archivo** (hash) o el **mismo N° de operación** ya se usó en otro envío.
- El repartidor nunca ve el comprobante. Aprobar y rechazar quedan en la bitácora del pago y en la auditoría.
- **El pago manda**: la base de datos no deja un envío asignado, en ruta o reagendado sin pago (`envio_asignado_pagado`).
- **Pendiente a futuro (D-13)**: emitir la boleta electrónica en el SII al aprobar el pago.

### Modelo de datos (migración `003_cobranza.sql`)

| Tabla / columna | Para qué |
|---|---|
| `pago.medio`, `transaccion_id` | Cómo pagó y el ID de la pasarela (único por proveedor) |
| `pago.verificacion` | `simulado` · `webhook` · `consulta_api` · `manual` |
| `pago.verificado_en`, `verificado_por` | Cuándo y quién (en pagos manuales, el administrador que revisó la cartola) |
| `pago.comision_estimada`, `neto_estimado`, `abono_estimado_en` | Lo que se lleva la pasarela y cuándo debería llegar el dinero |
| `pago.monto_abonado`, `comision_real`, `abonado_en`, `conciliado_por` | Lo que **realmente** llegó a la cuenta |
| `pago_evento` (tabla nueva) | Bitácora inmutable: inicio, notificación, verificación, rechazo, conciliación |
| `costo.tipo = 'pasarela'`, `costo.pago_id` | La comisión real descuenta de la ganancia neta |
| Trigger `envio_pago_verificado` | **Regla dura**: `estado_pago = 'pagado'` exige un pago aprobado y verificado |
| `CHECK pago_aprobado_verificado`, `pago_conciliado_cuadra` | Aprobado ⇒ verificado; abonado + comisión = cobrado |

Los pagos que ya existían se migran solos: los simulados aprobados quedan verificados como `simulado`, y
los envíos marcados como pagados a mano reciben su fila de pago `manual` (probado con datos previos).

### Pantalla nueva: Administración → **Cobranza**

- **Cobrado (verificado)**, **comisiones de pago**, **por cobrar** (envíos confirmados sin pagar y antigüedad)
  y **abonos por llegar** (con los atrasados).
- Aviso de pagos iniciados hace más de 30 minutos sin respuesta (cliente abandonó o el aviso no llegó).
- Tabla de pagos con su verificación y el botón **Conciliar** para registrar el abono de la cartola.
- **Comparador de proveedores** con el volumen mensual editable.

API: `GET /api/cobranza/resumen`, `GET /api/cobranza/pagos`, `GET /api/cobranza/pagos/:id/eventos`,
`POST /api/cobranza/pagos/:id/conciliar`, `GET /api/cobranza/estimar?monto=&envios_mes=`. QA: CP-114 a CP-116.

## 3. Costo de cobrar según el sistema de pago

> **Referencial.** Son comisiones públicas aproximadas para comercios pequeños en Chile y **cambian por
> contrato, rubro y volumen**. Confírmalas con cada proveedor antes de decidir (pendiente P-03).
> Están en `PROVEEDORES_PAGO` (`server/lib/cobranza.js`) y el comparador las usa directamente.

Por envío de **$3.500** (IVA 19 % sobre la comisión):

| Proveedor | Comisión | Costo por envío | Recibes | 300 envíos/mes | Abono | Verificación |
|---|---|---|---|---|---|---|
| Transferencia manual | 0 % | $0 | $3.500 | $0 (+ horas de revisar cartola) | Inmediato | Manual |
| Khipu | 1 % + IVA | $42 | $3.458 | $12.600 | 1 día hábil | Webhook |
| Flow | 2,89 % + IVA | $120 | $3.380 | $36.000 | 3 días hábiles | Webhook + getStatus |
| Webpay Plus (Transbank) | 2,95 % + IVA | $123 | $3.377 | $36.900 | 2 días hábiles | Commit por API |
| Mercado Pago Checkout Pro | 3,19 % + IVA | $133 | $3.367 | $39.900 | Inmediato | Webhook + consulta |

**Recomendación.** Para arrancar: **Flow** (un solo contrato que ofrece Webpay, Khipu y otros al cliente,
verificación firmada) **más transferencia manual** para clientes empresa frecuentes. Si el cliente ya tiene
cuenta de comercio en Transbank o Mercado Pago, conviene usar esa y evitar un trámite nuevo.

**Costo de integración (etapa de desarrollo, tarea D-02):** la base (modelo, verificación, bitácora,
conciliación y pantalla) ya está hecha. Falta el adaptador del proveedor elegido: crear la orden, recibir
el webhook, validar la firma y consultar el estado. Estimación: **2 a 4 días** de desarrollo + pruebas en
el ambiente de integración del proveedor. No incluye trámites de afiliación del comercio (los hace el cliente).

## 4. Partes del proyecto

| Parte | Carpeta | Qué contiene |
|---|---|---|
| API / servidor | `server/` | Express. `routes/` (envíos, cobranza, operación, catálogos, cuentas, público), `lib/` (reglas de negocio puras: `reglas.js`, `cobranza.js`), `middleware/auth.js` |
| Base de datos | `server/db/` | Migraciones en orden (`001` esquema, `002` seguridad Supabase, `003` cobranza), carga inicial, conexión |
| Interfaz (PWA) | `web/` | `js/vistas/`: `cliente.js`, `repartidor.js`, `admin.js`, `envios.js`, `publico.js`; `sw.js` caché de la app |
| Supabase | `supabase/` | `base-de-datos-completa.sql` generado desde las migraciones (`npm run sql:supabase`) |
| Scripts | `scripts/` | Publicar, verificar despliegue, datos demo, generar SQL |
| Pruebas | `tests/unit/` (reglas, 40 casos) · `qa/specs/` (flujo completo contra la API, 59 casos) |
| Documentación | `docs/` | Alcance, requerimientos, flujo, roles, QA, despliegue, decisiones |

## 5. Requerimientos que se agregan y los que aún faltan

**Agregados** (ver [02](02-requerimientos.md)): RF-66 a RF-70.

**Faltan o dependen del cliente:**

| # | Falta | Tipo |
|---|---|---|
| 1 | Elegir pasarela y afiliar el comercio (P-03) → integrar webhook firmado (D-02) | Cliente + desarrollo |
| 2 | Decidir si los repartidores **toman** envíos o solo **administración asigna** (P-17). Hoy: pueden tomar | Cliente |
| 3 | **Aviso** al repartidor cuando hay envíos nuevos (notificación push o WhatsApp); hoy debe abrir *Mi ruta* | Desarrollo (Should) |
| 4 | Reembolsos (`estado_pago = reembolsado`) al anular envíos pagados (D-08, P-09) | Desarrollo |
| 5 | Boleta/factura electrónica SII por cada cobro (si el cliente la emitirá desde la plataforma) | Cliente |
| 6 | Inicio de sesión real (`AUTH_MODE=jwt`) antes de cobrar dinero real (D-01) | Desarrollo (Must) |
| 7 | Correr el QA completo contra Railway (A-6) tras este despliegue | Tú |

## 6. Link de pago (30/09/2026)

Desde el detalle de un envío sin pagar, el cliente o administración pulsa **Link de pago**: se genera un enlace
(`/#/pagar/<token>`) para compartir por WhatsApp. Quien lo abre paga **sin iniciar sesión ni clave**, con la misma
verificación que un pago dentro de la app (monto exacto, id de transacción, bitácora). Muestra solo folio, monto y
empresa; vence en 7 días, deja de servir al pagarse o anularse y **nunca aparece en la etiqueta**. Los enlaces
inventados quedan en la bitácora de seguridad y 10 en 10 minutos desde una IP abren una alerta crítica. QA: CP-150 a CP-155.
