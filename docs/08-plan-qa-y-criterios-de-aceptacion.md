# 08 · Plan de QA y criterios de aceptación

## 1. Estrategia

| Nivel | Qué valida | Herramienta | Cuándo |
|---|---|---|---|
| Unitarias | Reglas de negocio puras: tarifas, límites, estados, intentos, espera, GPS, seguro, RUT, teléfono, EXIF, 346 comunas | `npm test` | En cada cambio |
| QA de API (extremo a extremo) | Flujos completos contra un servidor real: local, Railway o Vercel+Railway | `npm run qa:local` / `qa:railway` / `qa:vercel` | Antes de cada despliegue y después de publicar |
| Pruebas de interfaz | Recorrido visual por perfil en escritorio y celular | Manual guiada (§5) + Playwright opcional | Cada entrega al cliente |
| Aceptación (UAT) | Criterios CA-01 a CA-14 con datos y equipos reales del cliente | Checklist firmado | Semana de pruebas (F6) |

## 2. Entornos

Las URLs se configuran en **`entornos.env`** (raíz del repositorio):

```env
URL_LOCAL=http://localhost:3000
URL_RAILWAY=https://tu-app.up.railway.app
URL_VERCEL=https://tu-app.vercel.app
URL_PRODUCCION=https://envios.tuempresa.cl
QA_OBJETIVO=local
```

| Comando | Prueba contra |
|---|---|
| `npm run qa:local` | Tu computador (`npm run dev` corriendo) |
| `npm run qa:railway` | El servicio publicado en Railway (API + interfaz) |
| `npm run qa:vercel` | La interfaz en Vercel + la API en Railway |
| `node qa/run.js produccion` | El dominio definitivo |

Cada ejecución deja un reporte JUnit en `qa/reportes/` (evidencia para el cliente). Las pruebas crean sus propios usuarios `qa-…@qa.test`, por lo que **se recomienda un entorno de staging en Railway** separado de producción.

## 3. Matriz de casos de prueba automatizados

Resultado de la última ejecución local (26-09-2026): **78/78 aprobados** (QA), **40/40** (unitarias), flujo completo por interfaz, carga, 4G y accesibilidad en verde.

| Comando | Qué prueba |
|---|---|
| `npm test` | Reglas de negocio, limitador, configuración de producción, SQL de Supabase (40 pruebas) |
| `npm run qa:local` / `qa:railway` | 78 casos CP contra la API real |
| `npm run e2e` | Cliente, administración y repartidor **a la vez en tres teléfonos**: crear → pagar → asignar → retirar → entregar con foto y GPS → la pantalla del cliente se actualiza sola → seguimiento público. Deja capturas en `qa/reportes/e2e/` |
| `npm run carga` | 40 clientes y 15 repartidores simultáneos (`--clientes 100 --repartidores 30` para más). Verifica 0 errores, folios únicos y que todo termine entregado |
| `npm run rendimiento` | Cada pantalla en < 2 s con 4G simulado y teléfono lento |
| `npm run accesibilidad` | WCAG 2.1 AA con axe-core en 11 pantallas |

Todo se ejecuta solo en cada cambio con GitHub Actions (`.github/workflows/pruebas.yml`).

| Caso | Descripción | Requerimiento |
|---|---|---|
| CP-01 | API y base de datos disponibles | RNF-03 |
| CP-02 | Interfaz carga y expone configuración de API | RNF-08 |
| CP-03 | 346 comunas con región y provincia | RF-08 |
| CP-04 | Cobertura inicial en Santiago | RF-16, RF-18 |
| CP-05 | Reglas publicadas: $3.500, +$1.000, 20 kg, 60 cm, 3 intentos, 5 min | RF-42, RF-43, RF-47 |
| CP-06 | Sin identificación no hay acceso privado | RF-04 |
| CP-10 | Domicilio en Santiago = $3.500 | RF-16 |
| CP-11 | Horario especial = $4.500 | RF-47 |
| CP-12 | Horario especial exige franja | RF-47 |
| CP-13 | Punto Blue/Starken: 12 bultos = $3.500 | RF-41 |
| CP-14 | Punto courier exige empresa y sucursal | RF-41 |
| CP-15 | > 20 kg rechazado | RF-42 |
| CP-16 | > 60 cm rechazado | RF-42 |
| CP-17 | 20 kg y 60×60×60 exactos aceptados (límite) | RF-42 |
| CP-18 | Comuna fuera de cobertura rechazada | RF-18 |
| CP-19 | Solo admin cotiza sobredimensionados | RF-42 |
| CP-67 | Couriers y franjas editables en Ajustes y aplicados al cotizar | RF-41, RF-47 |
| CP-20 | Validación marca todos los campos faltantes | RF-11 |
| CP-21 | Crear y confirmar: folio `ENV-AAAA-NNNNNN` | RF-19 |
| CP-22 | Ticket PDF 80 mm y A4 | RF-20, RF-21 |
| CP-23 | QR y página con Google Maps y Waze, sin teléfono | RF-23, RF-24 |
| CP-24 | Seguimiento por folio sin datos personales | RF-46 |
| CP-25 | Repartidor no ve envíos no asignados | RF-04 |
| CP-26 | **No se retira sin pago** | RF-45 |
| CP-27 | Pago en línea marca pagado; no se procesa dos veces | RF-45 |
| CP-28 | Retiro con pago; repartidor no ve montos | RF-45, RF-04 |
| CP-29 | **Entrega sin foto rechazada** | RF-32 |
| CP-30 | **Entrega sin GPS rechazada** | RF-44 |
| CP-31 | Entrega con foto + GPS registra coordenadas | RF-32, RF-44 |
| CP-32 | Historial completo; foto sin EXIF | RF-15, RF-30 |
| CP-33 | Enlace de archivo alterado o sin firma rechazado | RNF-06 |
| CP-40 | Fallido exige motivo | RF-31 |
| CP-41 | "Espera excedida" solo tras llegada + 5 min | RF-43 |
| CP-42 | **Máximo 3 intentos**, luego solo devolver | RF-31 |
| CP-43 | Estado final no admite cambios | RF-30 |
| CP-44 | Seguimiento muestra intentos x/3 | RF-46 |
| CP-50 | **Sin boleta no se cobra el seguro** | RF-48 |
| CP-51 | Boleta sin N°, fecha o monto rechazada | RF-48 |
| CP-52 | Monto no supera valor declarado ni boleta | RF-49 |
| CP-53 | Repartidor no puede reclamar | RF-04 |
| CP-54 | Reclamo válido `SEG-AAAA-NNNNNN` | RF-48 |
| CP-55 | Un solo reclamo activo por envío | RF-49 |
| CP-56 | Boleta solo con enlace firmado | RNF-06 |
| CP-57 | Cliente no aprueba su propio reclamo | RF-50 |
| CP-58 | Aprobación dentro del tope | RF-50 |
| CP-59 | Pago de indemnización registrado como costo | RF-50, RF-36 |
| CP-60 | Cliente no ve envíos de otro cliente | RF-04 |
| CP-61 | Solo admin ve ganancias, usuarios y asigna | RF-04, RF-34 |
| CP-62 | Repartidor no crea envíos | RF-04 |
| CP-63 | Cliente anula su envío no pagado; no se borra | RF-33 |
| CP-64 | Libreta: varias direcciones por destinatario | RF-09 |
| CP-65 | No se usa la libreta de otro cliente | RF-09, RF-04 |
| CP-66 | Búsqueda por folio y exportación CSV | RF-28, RF-37 |
| CP-68 | Tarifa propia de una comuna se aplica al cotizar | RF-17 |
| CP-69 | Filtros por estado, comuna, repartidor y fecha | RF-29 |
| CP-70 | Reporte con desglose por día, comuna y repartidor | RF-34, RF-35 |
| CP-71 | QR abre página, Google Maps o Waze según Ajustes | RF-25, RF-26 |
| CP-72 | Datos de la empresa editables y publicados | RF-39, RF-51 |
| CP-73 | Auditoría registrada y consultable solo por admin | RF-40, RF-54 |
| CP-74 | Usuario desactivado no puede operar | RF-05 |
| CP-75 | PWA: manifiesto y service worker | RF-38 |
| CP-76 | Ticket con QR en < 3 s, QR generado en el servidor | RNF-04, RNF-11 |
| CP-77 | Web y API en la misma app, sin servidores ni fuentes externas | RNF-17 |
| CP-78 | Límite de solicitudes por IP (API y seguimiento público) | RNF-16 |
| CP-79 | Demo abierta: perfiles sin clave | RF-53 |
| CP-80 | 5 "intento fallido" simultáneos sobre un envío: se registra uno | RNF-22 |
| CP-81 | Dos administradores asignan a la vez: gana uno | RNF-22 |
| CP-82 | Confirmaciones y pagos simultáneos: un folio y un cobro | RNF-22 |
| CP-83 | 8 clientes × 5 envíos simultáneos: folios únicos | RNF-22, RNF-09 |
| CP-84 | Ticket: una etiqueta por bulto y QR a Google Maps con la dirección | RF-20, RF-24, RF-63 |
| CP-85 | Inicio de sesión y sesión de 30 días | RF-01, RF-03 |
| CP-86 | Cambiar contraseña cierra las otras sesiones | RF-02, RF-65 |
| CP-87 | Enlace de recuperación de un solo uso | RF-02 |
| CP-88 | Registro de clientes cerrado por defecto y habilitable | RF-56 |
| CP-89 | No se desactiva un repartidor con envíos en curso | RF-05 |
| CP-90 | Reembolso de envíos anulados/devueltos, una vez y con tope | RF-57 |
| CP-91 | Exportar y anonimizar un destinatario sin perder envíos | RF-58 |
| CP-92 | El repartidor ordena su ruta; no toca envíos ajenos | RF-60 |

**Plan QA de 50 errores (01-10-2026, ver [docs/18](18-plan-qa-50-errores.md)):**

| Caso | Descripción | Error que protege |
|---|---|---|
| CP-200 | El repartidor no ve recargos ni puede cotizar o consultar pagos | QA-01, QA-49 |
| CP-201 | Ajustes rechaza claves heredadas (constructor, __proto__) | QA-03 |
| CP-202 | Número vacío en Ajustes no se guarda como 0; tarifa estándar > $0 | QA-11, QA-12 |
| CP-203 | La tarifa estándar de Ajustes se aplica a las comunas en cobertura | QA-09 |
| CP-204 | Datos del negocio y pie del ticket validados | QA-37, QA-38 |
| CP-205 | Zonas: tarifa y nombre obligatorios, sin error 500 | QA-13, QA-14, QA-15 |
| CP-206 | Buscar % o _ no devuelve todo | QA-06 |
| CP-207 | confirmar:"false" no confirma; coordenadas y peso validados | QA-10, QA-23, QA-24 |
| CP-208 | Entrega: precisión GPS y receptor validados | QA-25, QA-26 |
| CP-209 | Reasignar limpia el orden de ruta; no se ordenan envíos cerrados | QA-27, QA-28 |
| CP-210 | Seguro solo tras el retiro; RUT del emisor validado | QA-16, QA-17 |
| CP-211 | Reembolso con monto vacío = total; referencia de pago acotada | QA-21, QA-22 |
| CP-212 | Fechas imposibles, rangos invertidos y costos futuros rechazados | QA-18, QA-19, QA-20 |
| CP-213 | Usuarios: correo normalizado, nombre acotado, activo booleano | QA-31, QA-32, QA-33 |
| CP-214 | Libreta: dirección principal y titular anonimizado | QA-35, QA-36, QA-47 |
| CP-215 | Seguimiento de folios de 7 dígitos | QA-29 |
| CP-216 | QR de punto courier muestra el punto | QA-48 |
| CP-217 | Máximo de adjuntos y nombres con tildes | QA-07, QA-43, QA-51 |
| CP-218 | CSV legible y cabeceras CORS expuestas | QA-30, QA-42 |

## 4. Criterios de aceptación (UAT con el cliente)

La solución se da por aceptada cuando, **con datos reales y en un celular real del repartidor**:

| ID | Criterio | Evidencia |
|---|---|---|
| CA-01 | Cada perfil ve solo lo que le corresponde | Recorrido por perfil |
| CA-02 | Un envío completo se crea en menos de 60 segundos | Cronómetro, 5 envíos |
| CA-03 | El formulario no deja avanzar con datos faltantes y los marca | Captura |
| CA-04 | La tarifa calculada coincide con la tabla acordada en 10 casos (domicilio, punto courier, bultos, horario especial) | Tabla firmada |
| CA-05 | Al confirmar se emite folio único y ticket con QR | PDF |
| CA-06 | El ticket se imprime legible en la impresora del cliente y el QR escanea a la primera | Foto del ticket |
| CA-07 | Con 20 direcciones reales, al menos 19 abren el mapa en el lugar correcto | Planilla |
| CA-08 | Un envío no pagado no se puede retirar; tras pagar sí | Recorrido |
| CA-09 | La entrega no se cierra sin foto; queda con GPS, hora y foto visible en el detalle | Detalle del envío |
| CA-10 | El contador de 5 minutos funciona y los 3 intentos se respetan | Recorrido |
| CA-11 | Un reclamo de seguro sin boleta es rechazado; con boleta sigue el flujo hasta pagado | Recorrido |
| CA-12 | El estado de cualquier folio se consulta sin iniciar sesión | Página de seguimiento |
| CA-13 | La ganancia del día y del mes cuadra con la suma manual de envíos entregados menos costos | Planilla vs pantalla |
| CA-14 | La suite QA pasa completa contra el entorno de producción/staging | Reporte JUnit |

## 5. Guion de prueba manual (interfaz)

1. **Cliente** → Nuevo envío → intentar avanzar vacío (debe marcar errores) → completar → probar 25 kg (debe bloquear) → 3,5 kg → horario especial (tarifa sube a $4.500) → confirmar → pagar (tarjeta de prueba) → descargar tickets.
2. **Admin** → Envíos → abrir el envío → asignar repartidor.
3. **Repartidor** (celular) → Mi ruta → abrir envío → Retirar → Ir con Maps → Llegué (ver contador) → No se pudo entregar (ver que "espera excedida" está bloqueado) → Cancelar → Entregar → tomar foto → confirmar.
4. **Seguimiento** → ingresar el folio → ver historial sin datos personales.
5. **Cliente** → detalle → Reclamar seguro sin boleta (debe bloquear) → con boleta → **Admin** → Seguros → Resolver → Pagar → Panel (costo "seguro" descontado).

## 6. Gestión de defectos

| Severidad | Definición | Tiempo de respuesta objetivo |
|---|---|---|
| Crítica | Bloquea crear, pagar, retirar o entregar; expone datos | Mismo día |
| Alta | Regla de negocio incorrecta (tarifa, intentos, seguro) | 2 días hábiles |
| Media | Funcionalidad secundaria con alternativa | Siguiente entrega |
| Baja | Visual o texto | Backlog |

Formato de reporte: **ID · título · perfil · pasos · resultado esperado · resultado obtenido · evidencia (captura) · entorno (local/Railway/Vercel) · severidad.**

## 7. Definición de "terminado" para cada funcionalidad

Código revisado · reglas validadas en el servidor · caso QA automatizado agregado y en verde · probado en celular · documentación actualizada.
