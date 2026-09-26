# 01 · Documento de alcance (v2.0)

**Estado:** borrador para validación del cliente · **Fecha:** 26/09/2026 · **Reemplaza:** Especificación v1.0 (18/09/2026)
**Mercado:** Chile (direcciones y tarifas por comuna)

## 1. Resumen

Plataforma web instalable en el celular (PWA) donde un **cliente** registra y **paga en línea** sus envíos, el **administrador** los asigna y controla la operación y las ganancias, y el **repartidor** retira (solo si están pagados), navega con el QR hacia la dirección y **cierra cada entrega con foto obligatoria y ubicación GPS**. Cada envío tiene un **folio** cuyo estado se puede consultar en todo momento. Si el producto se pierde o daña, el cliente puede **reclamar el seguro adjuntando obligatoriamente la boleta de compra**.

## 2. Cambios respecto de la v1.0 (por los "Puntos a tomar en cuenta" del cliente)

| # | Punto del cliente | Decisión en v2.0 | Impacto |
|---|---|---|---|
| 1 | Cobro en línea; idealmente servicio ya pagado para poder retirar | **Entra al alcance.** Pago previo obligatorio: el sistema bloquea el retiro de envíos no pagados. Pago en línea vía pasarela (Webpay Plus / Mercado Pago / Flow, a elegir) + registro manual por el administrador (transferencia/efectivo). | En v1.0 estaba **fuera**. Suma integración de pasarela y cuenta de comercio a nombre del cliente. |
| 2 | Dar ubicación GPS de cada entrega | **Entra.** Se registra latitud/longitud y precisión al cerrar la entrega (y en intentos fallidos). No es seguimiento en vivo. | Nuevo RF-44. |
| 3 | Entrega a puntos Blue, Starken u otras, sin límite de paquetes, $3.500 | **Entra.** Tipo de destino "punto courier" con empresa y sucursal; tarifa plana $3.500 sin importar la cantidad de bultos. No incluye integración con las API de los courier. | Nuevo RF-41. |
| 4 | Se describe producto y valor con boleta para cobrar seguro | **Entra.** Valor declarado por envío; reclamo de seguro con **boleta obligatoria** (archivo + N°, fecha, monto). | Nuevo módulo M10 Seguros. |
| 5 | Dentro de Santiago $3.500 hasta 20 kg y 60×60×60 cm | **Entra.** Validación de peso y dimensiones por bulto; sobre el límite requiere cotización especial (solo administración). | RF-16 actualizado, RF-42. |
| 6 | 3 intentos máx. de entrega, 5 min máx. de espera | **Entra.** Contador de intentos; al tercer fallido solo se puede devolver. Botón "Llegué" inicia una espera de 5 min; el motivo "espera excedida" se habilita al cumplirse. | RF-31 actualizado, RF-43. |
| 7 | Crear la URL en NIC.cl según el nombre que se indique | **Entra como tarea de puesta en marcha.** Dominio `.cl` a nombre del cliente, apuntado a Railway/Vercel. | Depende de la respuesta P-01. |
| 8 | Logo y nombre de la empresa por definir | Configurables desde Ajustes; mientras tanto se usa "Tu Empresa de Envíos". | Pendiente P-02. |
| 9 | Colores: azul 60%, magenta 30%, blanco 10% | Aplicado al prototipo (fondos azules, acciones magenta, texto/detalles blancos). | — |
| 10 | 3 usuarios: Admin, cliente, repartidor | **Reemplaza** a admin/operador/repartidor de la v1.0. El cliente crea sus propios envíos. | Roles rediseñados. |
| 11 | Registro del cliente como destinatario, con más de una dirección | Libreta de destinatarios por cliente, cada uno con varias direcciones (una principal). Las direcciones antiguas se desactivan, nunca se borran. | RF-09 ampliado. |
| 12 | Se debe poder ver el estado de cada folio | Página pública de seguimiento por folio (sin datos personales) + historial completo en el detalle. | Nuevo RF-46. |
| 13 | Envío especial por horario $1.000 adicional | Opción "horario especial" con franja horaria obligatoria; recargo configurable ($1.000). | Nuevo RF-47. |
| 14 | Para terminar la entrega, foto obligatoria | La entrega no se puede cerrar sin foto (regla del servidor, no solo de la pantalla). | RF-32 pasa de "Media/opcional" a **Imprescindible**. |

## 3. Qué HACE el sistema (v1)

| Área | Funcionalidad |
|---|---|
| Acceso | Tres perfiles (administrador, cliente, repartidor). Sesión de 30 días en el celular. *Prototipo: modo demostración sin inicio de sesión.* |
| Envíos | Asistente de 4 pasos: destinatario → destino → paquete → confirmación. Folio `ENV-AAAA-NNNNNN` único. |
| Destinos | Domicilio dentro de la cobertura, o punto Blue Express / Starken / Chilexpress / Correos / otro. |
| Tarifas | $3.500 base (≤ 20 kg y ≤ 60×60×60 cm por bulto), bulto adicional a domicilio, puntos courier sin límite de bultos, +$1.000 horario especial. Tarifa propia por comuna o zona. |
| Pagos | Pago en línea antes del retiro; pago manual registrado por administración. |
| Ticket y QR | PDF térmico 80 mm y A4 con QR (mín. 2,5 cm, corrección alta) que abre la ruta en Google Maps o Waze. |
| Entrega | Retiro solo si está pagado → "Llegué" (espera 5 min) → entrega con foto + GPS, o intento fallido con motivo (máx. 3). |
| Seguimiento | Estado de cada folio (público, sin datos personales) e historial con quién y cuándo. |
| Seguro | Reclamo con boleta obligatoria; revisión, aprobación/rechazo y pago por administración; la indemnización se registra como costo. |
| Registro | Búsqueda, filtros, paginación y exportación a Excel (CSV). |
| Ganancias | Ingresos (entregados), cobrado, proyectado, costos, neto; por día, comuna y repartidor. |
| Administración | Usuarios, cobertura por comuna, tarifas, reglas operativas, datos del negocio, costos. Auditoría de acciones sensibles. |

## 4. Qué NO hace (resumen — detalle en [07](07-restricciones-y-fuera-de-alcance.md))

No emite boletas ni facturas del SII (el ticket es un comprobante interno) · no rastrea al repartidor en vivo · no optimiza rutas · no genera etiquetas ni consulta estados en las API de Blue/Starken/Chilexpress · no envía WhatsApp automáticos · no maneja inventario · no es app de tiendas (es PWA) · no es multiempresa · no asigna pedidos automáticamente.

## 5. Ganancias: fórmula acordada

- **Ingreso del período** = suma de tarifas de envíos **entregados** en el período.
- **Cobrado del período** = suma de tarifas **pagadas** en el período (flujo de caja).
- **Costos del período** = bencina, comisiones, peajes, mantención, otros + **indemnizaciones de seguro pagadas**.
- **Ganancia neta** = Ingreso − Costos. El valor declarado del producto **no** es ingreso.

## 6. Supuestos vigentes

Cada supuesto se marca `[SUPUESTO]` y se confirma en [11-decisiones-y-pendientes.md](11-decisiones-y-pendientes.md):

1. "Dentro de Santiago" = 32 comunas de la provincia de Santiago + Puente Alto + San Bernardo (34 comunas). Editable.
2. A domicilio, cada bulto adicional se cobra como un envío más ($3.500). A punto courier, sin recargo por bulto.
3. "5 min máx. entrega" = tiempo máximo de espera del repartidor en el destino.
4. El repartidor no ve montos (tarifa ni valor declarado).
5. El cliente puede anular su envío solo si aún no está pagado ni asignado; después, solo administración.
6. El monto a indemnizar no puede superar el valor declarado ni el monto de la boleta.
7. La ganancia considera como ingreso los envíos entregados; los pagados y no entregados se muestran como "proyectado".
