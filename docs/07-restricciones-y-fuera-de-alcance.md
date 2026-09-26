# 07 · Restricciones y funcionalidades fuera de alcance

## 1. Fuera del alcance de la v1

| No hace | Por qué / qué implicaría |
|---|---|
| Emitir boleta o factura del SII | El ticket es comprobante interno. Emitir DTE requiere un proveedor autorizado. *Ojo: el seguro **recibe** la boleta de compra del cliente; no la emite.* |
| Seguimiento GPS en vivo del repartidor | Se registra el GPS **al cerrar cada entrega**, no la posición continua (batería, permisos en segundo plano y costos de mapas). |
| Asignación automática de pedidos | La asignación es manual por el administrador. |
| Optimizar rutas | El QR abre un destino a la vez. |
| Integración con API de Blue Express, Starken, Chilexpress, Correos | Se registra empresa, punto y código manualmente; no se generan etiquetas ni se consultan estados. |
| WhatsApp / SMS automáticos | Solo compartir manualmente por WhatsApp. La API oficial exige verificación y costo por conversación. |
| Inventario o bodega | El producto solo se describe. |
| App en App Store / Google Play | Es PWA instalable desde el navegador. |
| Multiempresa (vender el sistema a varios negocios) | Una sola empresa. |
| Tarifa por distancia | Tarifa por comuna/zona, peso y medidas. |
| Contabilidad, IVA, ERP | Solo gestión: ingresos, costos y neto. |
| Firma digital del receptor | Se registra nombre de quien recibe (opcional), foto y GPS. |
| Otros idiomas | Solo español de Chile. |

## 2. Restricciones

- **Pagos:** la cuenta de comercio de la pasarela debe estar a nombre del cliente; sin ella no se puede cobrar en línea. Mientras tanto se usa pago manual.
- **Dominio:** requiere el nombre definitivo de la empresa (P-01) y un titular con RUT para NIC.cl.
- **GPS:** depende del permiso del navegador y del equipo; en interiores la precisión baja. Si el repartidor niega el permiso, no puede cerrar la entrega (configurable).
- **Cobertura inicial:** solo Santiago (34 comunas). Otras regiones requieren nueva tarifa.
- **Paquetes sobre 20 kg o 60 cm:** no entran en la tarifa estándar; solo el administrador puede cotizarlos manualmente.
- **Modo demo:** sin inicio de sesión; nunca con datos reales.
- **Legal:** Ley 19.628 y Ley 21.719; confirmar con un abogado las obligaciones vigentes a la fecha de salida a producción.
- **Presupuesto:** el servicio de $220.000 CLP cubre la definición; el desarrollo se cotiza aparte.

## 3. Futura modalidad "envíos bajo demanda" (tipo plataforma)

Requerimientos identificados para una etapa posterior, **no incluidos en v1**:

| Requerimiento | Nota |
|---|---|
| Registro abierto de clientes (autoservicio) | Hoy los crea el administrador |
| Repartidores independientes que aceptan pedidos | Requiere asignación automática, reputación, pagos a repartidores |
| Seguimiento en vivo en mapa | GPS en segundo plano, costos de mapas |
| Cotización automática por distancia | Geocodificación y cálculo de rutas (pagado) |
| Notificaciones push / WhatsApp automáticas | Proveedor y costos por mensaje |
| Liquidación automática a repartidores | Cálculo de comisiones y pagos |
| Apps nativas en tiendas | Cuentas de desarrollador y ciclo de publicación |
| Multiempresa | Diseño multi-tenant desde el inicio de esa etapa |

El modelo de datos actual (estados, pagos, auditoría, roles) sirve de base para esa evolución sin rehacer el núcleo.
