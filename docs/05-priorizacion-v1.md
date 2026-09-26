# 05 · Priorización de funcionalidades para la primera versión

Método **MoSCoW**: Must (debe), Should (debería), Could (podría), Won't (no en v1).

## Must — sin esto no hay v1

| Funcionalidad | RF |
|---|---|
| Tres perfiles con permisos + inicio de sesión real | RF-01, RF-04 |
| Alta de envío con validación, cobertura y folio | RF-06 a RF-11, RF-16, RF-18, RF-19 |
| Tarifa $3.500, límites 20 kg / 60 cm, puntos courier sin límite, horario +$1.000 | RF-41, RF-42, RF-47 |
| Pago en línea previo al retiro (pasarela real) | RF-45 |
| Ticket 80 mm/A4 con QR a Maps/Waze | RF-20 a RF-24 |
| Retiro → llegada (5 min) → entrega con foto + GPS; fallido con máx. 3 intentos | RF-31, RF-32, RF-43, RF-44 |
| Seguimiento por folio | RF-46 |
| Seguro con boleta obligatoria | RF-48 a RF-50 |
| Registro con búsqueda y estados con historial | RF-27, RF-28, RF-30, RF-33 |
| Ganancias del día y del mes | RF-34 |
| Dominio `.cl` (NIC.cl) con HTTPS | — |

## Should — muy deseable en v1

Libreta con varias direcciones (RF-09) · filtros completos (RF-29) · exportar CSV (RF-37) · desglose por comuna/repartidor (RF-35) · costos y neto (RF-36) · recuperación de contraseña (RF-02) · PWA instalable (RF-38) · configuración del negocio y logo (RF-39, RF-51) · auditoría (RF-40).

## Could — si el plazo lo permite

Foto del paquete al crear (RF-12) · tarifa por zona (RF-17) · elegir destino del QR (RF-25) · gráficos avanzados · plantillas de mensaje de WhatsApp manual.

## Won't — fuera de v1 (ver [07](07-restricciones-y-fuera-de-alcance.md))

GPS en vivo · asignación automática · optimización de rutas · API de couriers · WhatsApp/SMS automáticos · boletas SII · multiempresa · apps de tiendas.

## Estado en el prototipo v0.1

Todos los **Must** están implementados y probados salvo: pantalla de inicio de sesión (la API ya lo soporta), **integración con la pasarela real** (hoy simulada) y dominio NIC.cl (depende del nombre de la empresa).
