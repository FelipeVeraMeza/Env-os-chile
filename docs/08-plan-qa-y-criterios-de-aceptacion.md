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

Resultado de la última ejecución local: **52/52 aprobados** (QA) y **16/16** (unitarias).

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
