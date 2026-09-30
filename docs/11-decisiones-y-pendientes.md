# 11 · Registro de decisiones y pendientes del cliente

## Decisiones tomadas (26/09/2026, a partir de los "Puntos a tomar en cuenta")

| ID | Decisión | Origen |
|---|---|---|
| DEC-01 | El QR significa **Maps** (navegación), no Mercado Pago. El cobro en línea se resuelve con una pasarela aparte. | Especificación v1.0 D-0 + punto 1 del cliente |
| DEC-02 | Pago **previo** al retiro, obligatorio | Punto 1 |
| DEC-03 | Perfiles: Admin, Cliente, Repartidor | "3 usuarios" |
| DEC-04 | Tarifa $3.500 dentro de Santiago hasta 20 kg y 60×60×60 cm | Punto del cliente |
| DEC-05 | Puntos Blue/Starken/otros sin límite de paquetes por $3.500 | Punto 3 |
| DEC-06 | Horario especial +$1.000 | Punto del cliente |
| DEC-07 | Máximo 3 intentos y 5 minutos de espera | Punto del cliente |
| DEC-08 | Foto obligatoria para terminar la entrega + GPS | Puntos 2 y final |
| DEC-09 | Seguro con valor declarado y **boleta obligatoria** para cobrarlo | Punto del cliente |
| DEC-10 | Libreta: el destinatario queda registrado con varias direcciones | Punto del cliente |
| DEC-11 | Estado visible por folio | Punto del cliente |
| DEC-12 | Colores azul 60 % / magenta 30 % / blanco 10 % | Punto del cliente |
| DEC-13 | Despliegue en Railway y posiblemente Vercel | Pedido del cliente |
| DEC-14 | Prototipo sin inicio de sesión para revisar el visual | Pedido del cliente |
| DEC-15 | Los **repartidores toman** los pedidos pagados que les aparecen, **de cualquier zona** (sin filtro por comuna); administración puede igual asignar o reasignar | Respuesta a P-17 (29/09/2026) |
| DEC-16 | La **boleta/factura electrónica** por cada cobro se deja **como último recurso**: no se integra con el SII salvo que sea indispensable; el ticket es un comprobante interno | Respuesta a P-18 (29/09/2026, confirmado) |
| DEC-18 | **La seguridad es la prioridad**: monitoreo de ataques y de extracción de datos, bitácoras inmutables y protocolo de incidentes (ver [17](17-seguridad.md)) | Pedido del cliente (29/09/2026) |
| DEC-19 | **Link de pago**: se genera desde el detalle del envío y se paga sin iniciar sesión ni clave; vence en 7 días y **no se imprime en la etiqueta** | Pedido del cliente (30/09/2026) |
| DEC-20 | La **etiqueta no muestra montos** (ni tarifa ni valor declarado); el valor declarado solo lo ve administración, para cobrar el seguro | Pedido del cliente (30/09/2026) |
| DEC-21 | **Demo sin clave**: `DEMO_CLAVE` es opcional (confirma la decisión A-5 del 26/09). Para operar con datos reales se usa `AUTH_MODE=jwt` | Pedido del cliente (30/09/2026) |
| DEC-22 | Se integran las dos versiones (26/09 y 29/09) en una sola rama | Pedido del cliente (30/09/2026) |
| DEC-23 | **Pago por transferencia con comprobante** revisado por administración (aprueba o rechaza con motivo). **El pago manda en todo**: sin pago aprobado no hay ticket para el cliente, ni asignación de repartidor, ni retiro. La boleta electrónica del SII al aprobar el pago queda **para más adelante** (D-13) | Pedido del cliente (30/09/2026) |
| DEC-24 | Los **clientes crean su cuenta** desde la pantalla de ingreso (registro abierto por defecto). La plataforma se **reinicia** antes de operar (`npm run reiniciar`): se borran usuarios y datos de prueba y se crea el administrador definitivo | Pedido del cliente (30/09/2026) |
| DEC-17 | Se agrega **inicio de sesión** con correo y contraseña para administrador, cliente y repartidor (`AUTH_MODE=jwt`) | Pedido del cliente (29/09/2026) |

## Pendientes que necesitamos del cliente

Ordenados por impacto. **Sin P-01 a P-05 no se puede cotizar el desarrollo.**

| ID | Pregunta | Por qué importa | Supuesto actual |
|---|---|---|---|
| P-01 | ¿Nombre de la empresa y dominio deseado en NIC.cl? ¿Titular (persona/empresa y RUT)? | Dominio, QR impresos, marca | "Tu Empresa de Envíos" |
| P-02 | ¿Logo en buena calidad (PNG/SVG)? | Ticket, app, PDF | Ícono genérico |
| P-03 | ¿Qué pasarela prefieren (Webpay Plus, Mercado Pago, Flow)? ¿Ya tienen cuenta de comercio? | Plazo y costo del módulo de pagos | Simulada |
| P-04 | ¿"Dentro de Santiago" son las 34 comunas propuestas? ¿Hay tarifa para otras comunas? | Cobertura y tarifas | 32 de la provincia de Santiago + Puente Alto + San Bernardo |
| P-05 | A domicilio, ¿cada bulto extra se cobra $3.500 o hay otra regla? | Cálculo de tarifa | $3.500 por bulto extra |
| P-06 | ¿Pagarán Google Places para direcciones exactas? | Precisión del mapa | No |
| P-07 | "5 min máx. entrega": ¿es tiempo de espera en el domicilio? | Regla de fallido | Sí, espera en destino |
| P-08 | ¿Qué franjas horarias ofrecen en el envío especial? | Opciones del formulario (editables en Ajustes) | 6 franjas de 08:00 a 23:00 |
| P-09 | ¿Qué pasa con el pago si el envío se devuelve tras 3 intentos? ¿Se reembolsa? | Reembolsos y ganancias | No se reembolsa (visita realizada) |
| P-10 | ¿El seguro tiene un tope máximo por envío o un costo adicional (prima)? | Cálculo y ganancia | Sin tope adicional ni prima |
| P-11 | ¿Qué plazo tiene el cliente para reclamar el seguro? | Regla del reclamo | Sin plazo definido |
| P-12 | ¿El repartidor ve la tarifa del envío? | Permisos | No ve montos |
| P-13 | ¿Los clientes se registran solos o los crea el administrador? | Registro | Los crea el administrador |
| P-14 | ¿Se necesita funcionar sin señal? | Arquitectura | No |
| P-15 | ¿Impresora térmica 80 mm, A4 o ambas? ¿Modelo? | Prueba de ticket | Ambas |
| P-16 | ¿Quién será responsable de los datos personales (RUT)? ¿Retención de fotos y boletas? | Legal | Fotos 12 meses, envíos 5 años |
| ~~P-17~~ | ~~¿Los repartidores toman los envíos o solo administración asigna?~~ | Resuelto: DEC-15 | — |
| ~~P-18~~ | ~~¿Se emitirá boleta/factura electrónica por cada cobro?~~ | Resuelto: DEC-16 (más adelante) | — |

## Control de versiones

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 18/09/2026 | Especificación inicial para revisión |
| 2.0 | 26/09/2026 | Incorpora puntos del cliente: pago previo, GPS, puntos courier, seguro con boleta, límites 20 kg/60 cm, 3 intentos, 5 min, horario especial, 3 perfiles, libreta, seguimiento por folio, colores. Prototipo v0.1 y suite QA. |
