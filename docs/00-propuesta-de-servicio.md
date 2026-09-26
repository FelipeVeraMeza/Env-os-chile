# Propuesta de servicio — Plataforma de Gestión de Envíos

| Campo | Valor |
|---|---|
| Servicio | Levantamiento, análisis, definición funcional y técnica |
| Monto total | **$220.000 CLP** |
| Fecha meta | **26 de octubre de 2026** |
| Versión | 2.0 — 26/09/2026 (incorpora los "Puntos a tomar en cuenta" del cliente) |
| Rol del equipo | Dirección de proyecto y aseguramiento de calidad (QA) |

## 1. Alcance del servicio

El servicio contempla el **levantamiento, análisis, definición funcional y técnica** de la solución de gestión de envíos, considerando los objetivos, metas y alcances revisados en la documentación entregada (Especificación v1.0 del 18/09/2026) y las definiciones acordadas en reuniones, incluidos los "Puntos a tomar en cuenta" entregados por el cliente.

El objetivo es dejar una base clara para determinar la solución a desarrollar, sus funcionalidades, flujo operativo, requerimientos técnicos y etapas posteriores de implementación.

## 2. Incluye

| # | Actividad | Documento donde queda |
|---|---|---|
| 1 | Levantamiento y revisión de los requerimientos del proyecto | [01](01-documento-de-alcance.md), [11](11-decisiones-y-pendientes.md) |
| 2 | Análisis del flujo de gestión de envíos | [03](03-flujo-del-sistema.md) |
| 3 | Definición de usuarios y roles involucrados | [04](04-roles-y-permisos.md) |
| 4 | Revisión del proceso de creación y seguimiento de envíos | [03](03-flujo-del-sistema.md) |
| 5 | Definición de estados y flujo de cada envío | [03](03-flujo-del-sistema.md) §3 |
| 6 | Definición del sistema de folios y códigos QR | [06](06-consideraciones-tecnicas.md) §5 |
| 7 | Revisión del uso de mapas y navegación | [06](06-consideraciones-tecnicas.md) §5 |
| 8 | Definición de información requerida para cada envío | [02](02-requerimientos.md), [06](06-consideraciones-tecnicas.md) §4 |
| 9 | Revisión del manejo de fotografías y evidencias | [02](02-requerimientos.md) RF-13 a RF-15, RF-45 |
| 10 | Definición de criterios para impresión de tickets | [06](06-consideraciones-tecnicas.md) §6 |
| 11 | Revisión de historial, filtros y consultas | [02](02-requerimientos.md) RF-27 a RF-30 |
| 12 | Tarifas, costos y ganancias | [01](01-documento-de-alcance.md) §5, [02](02-requerimientos.md) |
| 13 | Requerimientos para repartidores y administración | [04](04-roles-y-permisos.md) |
| 14 | Requerimientos de una futura modalidad de envíos bajo demanda | [07](07-restricciones-y-fuera-de-alcance.md) §3 |
| 15 | Requerimientos técnicos y no funcionales | [02](02-requerimientos.md), [06](06-consideraciones-tecnicas.md) |
| 16 | Integraciones y servicios externos | [06](06-consideraciones-tecnicas.md) §7 |
| 17 | Funcionalidades fuera del alcance inicial | [07](07-restricciones-y-fuera-de-alcance.md) |
| 18 | Priorización para la primera versión | [05](05-priorizacion-v1.md) |
| 19 | Metas, alcances, restricciones y consideraciones técnicas | [01](01-documento-de-alcance.md), [07](07-restricciones-y-fuera-de-alcance.md) |
| 20 | Base de trabajo para la etapa de desarrollo | [09](09-plan-de-desarrollo.md), código base del repositorio |

## 3. Meta del proyecto

A más tardar el **26 de octubre de 2026** debe existir una definición suficientemente clara para iniciar la siguiente etapa, sin requerimientos ambiguos ni funcionalidades no acordadas:

**Qué se va a desarrollar → cómo funcionará → quiénes lo utilizarán → qué información manejará → qué integraciones requiere → qué queda fuera del alcance → cuáles serán las siguientes etapas.**

## 4. Entregables

| # | Entregable | Archivo | Estado |
|---|---|---|---|
| 1 | Documento de alcance actualizado | [01-documento-de-alcance.md](01-documento-de-alcance.md) | Borrador v2.0 para validación |
| 2 | Requerimientos funcionales y no funcionales | [02-requerimientos.md](02-requerimientos.md) | Borrador v2.0 |
| 3 | Flujo general del sistema | [03-flujo-del-sistema.md](03-flujo-del-sistema.md) | Borrador v2.0 |
| 4 | Definición de roles y permisos | [04-roles-y-permisos.md](04-roles-y-permisos.md) | Borrador v2.0 |
| 5 | Funcionalidades priorizadas para la v1 | [05-priorizacion-v1.md](05-priorizacion-v1.md) | Borrador v2.0 |
| 6 | Consideraciones técnicas e integraciones | [06-consideraciones-tecnicas.md](06-consideraciones-tecnicas.md) | Borrador v2.0 |
| 7 | Restricciones y funcionalidades fuera de alcance | [07-restricciones-y-fuera-de-alcance.md](07-restricciones-y-fuera-de-alcance.md) | Borrador v2.0 |
| 8 | Criterios generales para validar la solución (plan QA) | [08-plan-qa-y-criterios-de-aceptacion.md](08-plan-qa-y-criterios-de-aceptacion.md) | Borrador v2.0 |
| 9 | Base para estimar y planificar el desarrollo | [09-plan-de-desarrollo.md](09-plan-de-desarrollo.md) | Borrador v2.0 |
| + | Prototipo funcional navegable y suite QA automatizada | Carpetas `server/`, `web/`, `qa/` | v0.1 (demo sin inicio de sesión) |
| + | Guía de despliegue Railway / Vercel / NIC.cl | [10-despliegue.md](10-despliegue.md) | v1.0 |

> El prototipo es un **valor agregado** para validar el alcance con algo que se puede tocar. No reemplaza la etapa de desarrollo ni constituye la plataforma terminada (ver §5).

## 5. Consideración sobre el desarrollo

El monto indicado corresponde al **servicio de levantamiento, análisis y definición del proyecto**.

El desarrollo e implementación de la plataforma —programación de producción, infraestructura, aplicaciones para usuarios/repartidores, GPS en tiempo real, asignación automática de pedidos, integración real de pagos, notificaciones u otras funcionalidades que posteriormente se aprueben— **se evaluará y cotizará de manera independiente** según el alcance definitivo.

## 6. Cronograma del servicio

| Semana | Fechas | Actividades | Hito |
|---|---|---|---|
| S1 | 26 sep – 2 oct | Revisión de la especificación v1.0 y de los puntos del cliente. Reunión de definiciones. Envío del cuestionario de pendientes. | Alcance v2.0 en borrador ✅ |
| S2 | 3 – 9 oct | Flujo, estados, roles y permisos. Reglas de tarifas, intentos, espera y seguro. Validación con el cliente. | Flujo y roles validados |
| S3 | 10 – 16 oct | Requerimientos RF/RNF cerrados. Consideraciones técnicas e integraciones (pasarela, NIC.cl, Railway/Vercel). | Requerimientos firmados |
| S4 | 17 – 23 oct | Priorización v1, plan QA, criterios de aceptación y plan de desarrollo con estimación. Revisión del prototipo con el cliente. | Paquete completo en revisión |
| Cierre | 24 – 26 oct | Ajustes finales y entrega formal. | **Entrega 26 oct 2026** |

## 7. Valor

**VALOR TOTAL DEL SERVICIO: $220.000 CLP.** Contempla el trabajo de levantamiento, análisis, definición y documentación del alcance indicado.

## 8. Fecha meta y supuestos de cumplimiento

**Fecha objetivo de entrega: 26 de octubre de 2026.** Considera que las definiciones, información y validaciones necesarias por parte del cliente se entreguen oportunamente (ver [11-decisiones-y-pendientes.md](11-decisiones-y-pendientes.md)). Cada día de atraso en una respuesta crítica del cliente puede desplazar la fecha en igual medida.

## 9. Aceptación

| Rol | Nombre | Firma | Fecha |
|---|---|---|---|
| Cliente | | | |
| Dirección de proyecto | | | |
