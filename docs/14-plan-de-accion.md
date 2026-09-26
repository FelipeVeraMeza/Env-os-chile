# 14 · Plan de acción: qué hacer, qué tocar y qué mejorar

> Estado al 26/09/2026. La app está en línea en Railway (`/api/health` → `ok:true`) con base y archivos en Supabase.
> Fecha meta del servicio (levantamiento, análisis y definición): **26/10/2026**.
> Marca cada casilla al terminar. Responsable: **TÚ** (Railway/Supabase/cliente) · **CLIENTE** · **DESARROLLO** (código).

## A. Urgente — seguridad y puesta en línea (esta semana)

| # | Qué hacer | Responsable | Dónde |
|---|---|---|---|
| [ ] A-1 | Cambiar la **contraseña de la base** (quedó escrita en el chat) y actualizar `SUPABASE_DB_PASSWORD` | TÚ | Supabase → Project Settings → Database → Reset password · Railway → Variables |
| [ ] A-2 | Crear una **secret key nueva**, ponerla en `SUPABASE_SECRET_KEY` y **borrar la antigua** | TÚ | Supabase → Project Settings → API Keys |
| [ ] A-3 | Desactivar las **claves legacy** (anon / service_role JWT) | TÚ | Supabase → API Keys → Legacy API keys → Disable |
| [ ] A-4 | Tras A-1 a A-3, confirmar que `/api/health` sigue en `ok:true`, `base:"supabase"`, `archivos:"supabase"` | TÚ | Navegador |
| [ ] A-5 | Decidir si la demo sigue con **clave de acceso** (recomendado) o queda abierta | TÚ | — |
| [ ] A-6 | Correr el **QA completo contra Railway** (52 casos): `QA_DEMO_CLAVE` en `entornos.local.env` y `npm run qa:railway` | TÚ o DESARROLLO | Computador con el repo, o permitir `*.railway.app` en la red de la sesión |
| [ ] A-7 | Dejar **una sola rama** conectada a Railway (hoy `…-rdzym7`) | TÚ | Railway → Settings → Source |
| [ ] A-8 | Activar **respaldos** de la base (Supabase: plan con backups diarios o exportación programada) | TÚ | Supabase → Database → Backups |

## B. Pruebas en teléfonos reales (semana 1–2)

| # | Qué probar | Resultado esperado |
|---|---|---|
| [ ] B-1 | Abrir la app en **Android (Chrome)** y **iPhone (Safari)** | Colores azul/magenta/blanco correctos (sin "modo oscuro" del navegador) |
| [ ] B-2 | Instalar desde el menú del navegador (⋮ → Instalar app / Compartir → Agregar a inicio) | Ícono en la pantalla de inicio, abre sin barra del navegador |
| [ ] B-3 | **Cliente**: crear envío a domicilio, a punto Blue/Starken y con horario especial | Tarifas $3.500 / $3.500 sin límite de bultos / +$1.000; folio `ENV-2026-…` |
| [ ] B-4 | Crear envío de **21 kg** o de **61 cm** | Bloquea tarifa estándar: solo el admin cotiza |
| [ ] B-5 | **Repartidor** intenta retirar un envío **sin pagar** | Lo impide |
| [ ] B-6 | Botón **"Llegué"** y esperar 5 min | El motivo "espera excedida" aparece solo al cumplirse |
| [ ] B-7 | Cerrar entrega **sin foto** / **sin GPS** | Lo impide; con foto + GPS se cierra |
| [ ] B-8 | 3 intentos fallidos | Pasa a devolución |
| [ ] B-9 | Reclamo de **seguro sin boleta** / con monto mayor al declarado o a la boleta | Lo impide |
| [ ] B-10 | **Seguimiento público** por folio desde otro teléfono | Estado e historial, sin datos personales |
| [ ] B-11 | Imprimir **ticket 80 mm** en la impresora del cliente y escanear el QR | QR legible; abre la navegación al destino |
| [ ] B-12 | Medir tiempo de crear un envío completo | Menos de 60 s (RNF-02) |

Registrar cada falla con captura, teléfono, navegador y pasos.

## C. Pendientes del cliente (sin C-1 a C-5 no se puede cotizar el desarrollo)

| # | Pregunta (ver [11](11-decisiones-y-pendientes.md)) | Supuesto actual |
|---|---|---|
| [ ] C-1 | Nombre de la empresa, dominio en NIC.cl y titular (RUT) — P-01 | "Tu Empresa de Envíos" |
| [ ] C-2 | Logo PNG/SVG en buena calidad — P-02 | Ícono genérico |
| [ ] C-3 | Pasarela: Webpay Plus, Mercado Pago o Flow; ¿cuenta de comercio? — P-03 | Simulada |
| [ ] C-4 | Cobertura "dentro de Santiago" (¿34 comunas?) y tarifas fuera — P-04 | 34 comunas |
| [ ] C-5 | Bultos adicionales a domicilio — P-05 | $3.500 por bulto extra |
| [ ] C-6 | Franjas horarias del envío especial — P-08 | 6 franjas 08:00–23:00 |
| [ ] C-7 | Reembolso si se devuelve tras 3 intentos — P-09 | No se reembolsa |
| [ ] C-8 | Tope o prima del seguro — P-10 · plazo para reclamar — P-11 | Sin tope ni plazo |
| [ ] C-9 | ¿El repartidor ve la tarifa? — P-12 · ¿clientes se registran solos? — P-13 | No · los crea el admin |
| [ ] C-10 | Impresora (80 mm / A4, modelo) — P-15 | Ambas |
| [ ] C-11 | Responsable de datos personales y retención de fotos/boletas — P-16 | Fotos 12 meses, envíos 5 años |
| [ ] C-12 | ¿Google Places para direcciones exactas? — P-06 · ¿funcionar sin señal? — P-14 | No · No |

Cuando respondan: nombre, logo, datos del negocio, tarifas, límites e intentos se cargan desde **Administrador → Ajustes** (sin tocar código). Couriers y franjas horarias hoy requieren código (ver D-a).

## D. Mejoras de código (DESARROLLO)

### Antes de entregar el prototipo (hasta 26/10)
| # | Mejora | Motivo |
|---|---|---|
| [ ] D-a | **Couriers** (Blue Express, Starken, …) y **franjas horarias** editables en Ajustes | Hoy están fijos en el código |
| [ ] D-b | Revisión visual completa en teléfono de cada pantalla (admin, cliente, repartidor) | RNF-01, RNF-13 |
| [ ] D-c | Actualizar documentos 02, 05, 09, 12 y 13 con lo hecho en esta etapa | Supabase Storage ya reemplaza S3/R2 (D-06); validación de variables en producción |
| [ ] D-d | Medir carga de pantallas con perfil 4G (Lighthouse) | RNF-03 |

### Etapa de desarrollo (se cotiza aparte, ver [09](09-plan-de-desarrollo.md))
| # | Tarea | Prio. |
|---|---|---|
| [ ] D-01 | Pantalla de **inicio de sesión** y `AUTH_MODE=jwt` en producción | Must |
| [ ] D-02 | **Pasarela real** con webhook firmado y conciliación | Must |
| [ ] D-03 | **Dominio .cl** apuntado a Railway con HTTPS | Must |
| [ ] D-04 | Logo, nombre y colores definitivos | Must |
| [ ] D-05 | Recuperación de contraseña por correo | Should |
| [ ] D-07 | Respaldos automáticos y **restauración probada** | Must |
| [ ] D-08 | Reembolsos al anular envíos pagados | Should |
| [ ] D-09 | Prueba en la impresora térmica del cliente | Must |
| [ ] D-10 | Prueba de carga: 20 usuarios, 100.000 envíos | Should |
| [ ] D-11 | Revisión legal: Ley 19.628 / 21.719, textos de consentimiento | Must |
| [ ] D-12 | Autocompletado de direcciones (Google Places), si se aprueba | Could |

## E. Calendario sugerido hasta la fecha meta

| Semana | Foco |
|---|---|
| 29/09 – 03/10 | Bloque A completo · enviar preguntas del bloque C al cliente |
| 06/10 – 10/10 | Bloque B (teléfonos reales e impresora) · correcciones |
| 13/10 – 17/10 | Cargar respuestas del cliente (C) · mejoras D-a a D-d |
| 20/10 – 24/10 | Documentos finales, alcance firmado y cotización del desarrollo |
| **26/10** | **Entrega del servicio** |
