# 04 · Roles y permisos

Tres perfiles, según lo indicado por el cliente: **Administrador, Cliente y Repartidor**.

| Perfil | Quién es | Dispositivo típico |
|---|---|---|
| Administrador | Dueño/a u oficina del negocio de envíos | PC y celular |
| Cliente | Persona o tienda que contrata el envío y paga | Celular / PC |
| Repartidor | Quien retira y entrega | Celular (con cámara y GPS) |

## Matriz de permisos

✅ puede · 🔸 solo lo propio / con condición · ❌ no puede

| Acción | Admin | Cliente | Repartidor |
|---|:-:|:-:|:-:|
| Crear envío | ✅ (a nombre de un cliente) | 🔸 propios | ❌ |
| Ver envíos | ✅ todos | 🔸 propios | 🔸 solo asignados |
| Ver montos (tarifa, valor declarado) | ✅ | 🔸 propios | ❌ |
| Libreta de destinatarios | ✅ de cualquier cliente | 🔸 propia | ❌ |
| Descargar ticket / QR | ✅ | 🔸 propios | 🔸 QR de asignados |
| Pagar en línea | ✅ | 🔸 propios | ❌ |
| Registrar pago manual | ✅ | ❌ | ❌ |
| Asignar / desasignar repartidor | ✅ | ❌ | ❌ |
| Retirar (pasar a En ruta) | ✅ | ❌ | 🔸 asignados y **pagados** |
| Registrar "Llegué" | ✅ | ❌ | 🔸 asignados |
| Entregar (foto + GPS) | ✅ | ❌ | 🔸 asignados |
| Registrar intento fallido | ✅ | ❌ | 🔸 asignados |
| Reagendar / devolver | ✅ | ❌ | ❌ |
| Anular | ✅ | 🔸 propios, no pagados ni asignados | ❌ |
| Reclamar seguro (con boleta) | ✅ | 🔸 propios | ❌ |
| Revisar / aprobar / rechazar / pagar reclamo | ✅ | ❌ | ❌ |
| Ver boletas | ✅ | 🔸 propias | ❌ |
| Ganancias, costos, reportes | ✅ | ❌ | ❌ |
| Exportar a Excel | ✅ | 🔸 propios | ❌ |
| Tarifas, cobertura, reglas | ✅ | ❌ | ❌ |
| Usuarios | ✅ | ❌ | ❌ |
| Datos del negocio, logo, ticket | ✅ | ❌ | ❌ |
| Seguimiento público por folio | ✅ | ✅ | ✅ (y cualquier persona con el folio) |

## Reglas de seguridad

- Los permisos se validan en el **servidor**; ocultar un botón no es la protección.
- Un envío de otro cliente o no asignado responde **"no encontrado"** (no revela que existe).
- No se puede desactivar ni quitar el perfil de administrador a uno mismo.
- Toda acción sensible queda en `auditoria` (usuario, acción, entidad, fecha, IP): crear/confirmar envío, asignar, cambiar estado, pagos, reclamos, cambios de tarifas y usuarios, escaneo de QR.

## Modo demostración (prototipo)

Por pedido del cliente, el prototipo funciona **sin inicio de sesión** (`AUTH_MODE=demo`): se elige un perfil en la barra superior. **Nunca debe usarse con datos reales.** Para producción: `AUTH_MODE=jwt` (inicio de sesión con correo y contraseña, ya implementado en la API) y pantalla de login en la interfaz (tarea D-01 del plan de desarrollo).
