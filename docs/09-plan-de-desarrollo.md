# 09 · Base para estimar y planificar el desarrollo

> **Estimación, no cotización.** Los rangos son para una persona y se convierten en cotización formal cuando se cierren los pendientes de [11](11-decisiones-y-pendientes.md). El prototipo v0.1 ya adelanta parte del trabajo (marcado ✅).

## 1. Fases

| Fase | Contenido | Esfuerzo estimado | Avance con el prototipo |
|---|---|---|---|
| F0 | Cierre de definiciones, respuestas pendientes, alcance firmado | 1 semana | En curso (este servicio) |
| F1 | Base: cuentas, login, roles, base de datos, comunas, despliegue Railway | 1 – 2 semanas | ✅ mayormente (falta pantalla de login y recuperación de contraseña) |
| F2 | Alta de envíos: libreta, direcciones, validaciones, tarifas, puntos courier, horario especial, fotos | 2 – 3 semanas | ✅ mayormente |
| F3 | Ticket PDF, QR, mapas, seguimiento por folio | 1 – 2 semanas | ✅ mayormente (falta prueba en impresora real) |
| F4 | **Pagos reales** (pasarela elegida, webhook, conciliación, reembolsos) | 2 – 3 semanas | 🟡 flujo y reglas listos, pasarela simulada |
| F5 | Operación de reparto: retiro, llegada 5 min, entrega foto+GPS, intentos, reagendar/devolver | 1 – 2 semanas | ✅ mayormente |
| F6 | Seguro con boleta, costos, ganancias y reportes | 1 – 2 semanas | ✅ mayormente |
| F7 | Endurecimiento: almacenamiento S3/R2, respaldos, correo transaccional, pruebas de carga, revisión legal | 1 – 2 semanas | ⬜ |
| F8 | Pruebas en terreno con repartidores reales, ajustes, capacitación, dominio NIC.cl y puesta en marcha | 1 – 2 semanas | ⬜ |
| | **Total v1** | **11 – 20 semanas** sin prototipo · **≈ 6 – 10 semanas** partiendo del prototipo | |

## 2. Trabajo pendiente priorizado (backlog de desarrollo)

| ID | Tarea | Prio. |
|---|---|---|
| D-01 | Pantalla de inicio de sesión y paso a `AUTH_MODE=jwt` | Must |
| D-02 | Integrar pasarela real (Webpay Plus / Mercado Pago / Flow) con webhook firmado | Must |
| D-03 | Registrar dominio en NIC.cl y apuntarlo a Railway/Vercel | Must |
| D-04 | Logo, nombre y colores definitivos | Must |
| D-05 | Recuperación de contraseña por correo | Should |
| D-06 | Fotos y boletas en S3/R2 en lugar de disco | Should |
| D-07 | Respaldos automáticos y restauración probada | Must |
| D-08 | Reembolsos al anular envíos pagados | Should |
| D-09 | Prueba de impresión térmica en la impresora del cliente | Must |
| D-10 | Prueba de carga (20 usuarios, 100.000 envíos) | Should |
| D-11 | Revisión legal de privacidad (Ley 19.628 / 21.719) y textos de consentimiento | Must |
| D-12 | Autocompletado de direcciones (Google Places), si el cliente lo aprueba | Could |

## 3. Costos recurrentes (los paga el cliente)

| Servicio | Comentario |
|---|---|
| Railway (API + PostgreSQL + volumen) | Plan según uso; con bajo volumen el costo mensual es acotado |
| Vercel (opcional) | Plan Hobby gratuito para uso personal; Pro si es comercial |
| Dominio `.cl` en NIC.cl | Pago anual |
| Pasarela de pago | Comisión por transacción según proveedor |
| Almacenamiento de fotos/boletas | Crece con los envíos; se controla con la política de retención |
| Google Places (opcional) | Pago por consulta |
| Soporte y mantención | A convenir |

## 4. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La cuenta de comercio de la pasarela tarda en aprobarse | Alto: bloquea el pago en línea | Iniciar el trámite ya; mientras tanto, pago manual |
| El mapa abre una dirección equivocada | Alto | Siempre enviar comuna; probar 20 direcciones reales; evaluar Google Places |
| El QR no escanea en la térmica | Medio | QR ≥ 2,5 cm, corrección H, prueba en la impresora real |
| Repartidores niegan permiso de GPS o cámara | Alto | Capacitación; mensaje claro en pantalla; configuración de excepción |
| Mala señal en el reparto | Medio | Definir si se requiere modo sin conexión (hoy no incluido) |
| Nuevos pedidos durante el desarrollo | Alto | Este alcance firmado; todo lo nuevo es una etapa con su plazo y precio |
| Cuentas a nombre del desarrollador | Medio | Crear Railway, Vercel, NIC.cl y pasarela a nombre del cliente |
| Uso del modo demo con datos reales | Alto | `AUTH_MODE=jwt` obligatorio en producción; advertencia en el registro del servidor |
