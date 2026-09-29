# 12 · Subir la primera versión: Railway + Supabase

Tiempo estimado: **20–30 minutos**. Resultado: un enlace `https://…up.railway.app` protegido con una clave, que puedes mandar al cliente para que recorra la plataforma **sin inicio de sesión** (elige Administrador, Cliente o Repartidor).

```
Celular / PC ──► Railway (API + interfaz) ──► Supabase: PostgreSQL (datos)
                                          └──► Supabase Storage (fotos y boletas, bucket privado)
```

---

## Paso 1 · Supabase (base de datos y archivos)

1. Entra a [supabase.com](https://supabase.com) → **New project**.
   - **Region:** elige la **misma zona que usarás en Railway**. Recomendado: **East US (North Virginia)** en ambos (Railway no tiene región en Sudamérica y la API hace muchas consultas a la base: estar juntos la hace rápida).
   - **Database password:** usa una clave **solo de letras y números** (los símbolos `@ : / # ?` rompen la URL). Guárdala.
2. Cuando el proyecto esté listo, copia estos datos.

   **Opción fácil (recomendada):** solo necesitas la **Project URL**, la **Secret key** y la **contraseña de la base** (la que pusiste al crear el proyecto). Ponlas en `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SUPABASE_DB_PASSWORD`, sin `DATABASE_URL`: el servidor encuentra solo el pooler y su región (en el log verás `[db] pooler encontrado: …`). Con esta opción la contraseña puede tener símbolos.

   **Opción manual:**

   | Dato | Dónde está | Variable en Railway |
   |---|---|---|
   | URL de conexión | Botón **Connect** (arriba) → pestaña **Connection string** → método **Session pooler** → copiar la URI. Se ve así: `postgresql://postgres.abcd…:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres` (el host puede empezar con `aws-0-` o `aws-1-`). Reemplaza `[YOUR-PASSWORD]` por tu clave. | `DATABASE_URL` |
   | Project URL | **Project Settings → Data API** (o API) → `https://abcd….supabase.co` | `SUPABASE_URL` |
   | Clave secreta | **Project Settings → API Keys** → **Secret keys** → `sb_secret_…` (si tu proyecto usa las claves antiguas: `service_role`) | `SUPABASE_SECRET_KEY` |

   > ⚠ Usa el **Session pooler** (puerto **5432**), **no** la "Direct connection" (`db.xxx.supabase.co`): esa es solo IPv6 y Railway no llega. Tampoco uses el "Transaction pooler" (puerto 6543).
   >
   > ⚠ La clave secreta da acceso total a tu proyecto: va **solo** en las variables de Railway, nunca en el código ni en el navegador.

3. **Crear la base de datos** (recomendado, 1 minuto): en Supabase → **SQL Editor** → **New query** → pega **todo** el archivo [`supabase/base-de-datos-completa.sql`](../supabase/base-de-datos-completa.sql) → **Run**. Al final muestra `346 | 34 | 5 | 001_inicial.sql, 002_seguridad_supabase.sql`. Crea:
   - las 15 tablas con seguridad RLS (la API pública de Supabase no puede leer nada),
   - las 346 comunas de Chile (34 en cobertura dentro de Santiago),
   - tarifas y reglas ($3.500, +$1.000 horario especial, 20 kg / 60 cm, 3 intentos, 5 min),
   - el bucket **privado** `envios-privado` para fotos y boletas.

   Se puede ejecutar más de una vez sin problema. Si te lo saltas, la app crea lo mismo sola en su primer arranque. **Los usuarios** (administrador y perfiles demo) los crea la app al arrancar en Railway, con `ADMIN_EMAIL` / `ADMIN_PASSWORD`, para que ninguna contraseña quede escrita en el repositorio.

## Paso 2 · Probar la conexión desde tu computador (recomendado)

Antes de subir, verifica que los datos están bien:

```bash
cp .env.railway.example .env      # y completa los valores reales
npm install
npm run verificar:railway
```

Debe terminar en **"✔ Todo listo para desplegar"**. Si algo falla, el mensaje dice qué corregir (ver también la tabla del final). Luego borra el `.env` o vuelve a los valores locales.

## Paso 3 · Railway

1. Entra a [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → elige **`Env-os-chile`**.
2. En el servicio creado → **Settings**:
   - **Source → Branch:** elige la rama donde está el código (`claude/shipping-management-platform-rdzym7`, o `main` si ya la uniste).
   - **Deploy → Region:** la misma zona de Supabase (p. ej. US East).
   - No hace falta configurar el build: Railway lee `railway.json` (instala con `npm ci`, arranca con `node server/index.js`, revisa `/api/health`).
3. **Settings → Networking → Generate Domain.** Te da algo como `https://env-os-chile-production.up.railway.app`. (Los QR usarán esta dirección automáticamente).
4. **Variables → Raw Editor** → pega el contenido de [`.env.railway.example`](../.env.railway.example) con tus valores:

   | Variable | Qué poner |
   |---|---|
   | `DATABASE_URL` | URI del Session pooler (Paso 1) |
   | `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Paso 1 |
   | `JWT_SECRET` | Resultado de `npm run secreto` (64 caracteres) |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Tu correo y una clave segura |
   | `DEMO_CLAVE` | La clave que le darás al cliente para entrar a la demo |
   | `AUTH_MODE` | `demo` (primera versión, sin inicio de sesión) |

   Guarda con **Update Variables** → Railway despliega solo.
5. **Deployments → View logs.** Un arranque correcto muestra:

   ```
   [db] conectando a aws-0-us-east-1.pooler.supabase.com (Supabase, pooler) · SSL sí
   [db] migración aplicada: 001_inicial.sql
   [db] migración aplicada: 002_seguridad_supabase.sql
   [db] 346 comunas cargadas
   [db] usuarios iniciales creados (admin: admin@tuempresa.cl)
   [archivos] bucket privado "envios-privado" creado en Supabase Storage
   [api] lista en https://env-os-chile-production.up.railway.app (puerto 8080, modo demo)
   ```

6. Abre `https://…up.railway.app/api/health` → debe decir `"ok":true, "base":"supabase", "archivos":"supabase"`.

## Paso 4 · Verificar y cargar datos de ejemplo

1. En [`entornos.env`](../entornos.env) pega tu dominio en `URL_RAILWAY=`.
2. Crea `entornos.local.env` (no se sube al repositorio) con `QA_DEMO_CLAVE=<tu DEMO_CLAVE>`.
3. Opcional, para que el cliente vea la plataforma "con vida":
   ```bash
   npm run datos-demo -- railway      # crea 17 envíos de ejemplo en distintos estados
   ```
4. Opcional, pruebas automáticas contra Railway:
   ```bash
   npm run qa:railway
   ```
   > Las pruebas crean usuarios y envíos `QA …` (no aparecen en el selector de perfiles, pero sí en reportes). Hazlo **antes** de mandar el enlace al cliente o en un segundo proyecto de Railway/Supabase de pruebas.

## Paso 5 · Mandar la primera versión

Mensaje sugerido:

> Te comparto la primera versión de la plataforma: **https://…up.railway.app**
> Clave de acceso: **(tu DEMO_CLAVE)**
> Arriba a la derecha eliges el perfil (Administrador, Cliente o Repartidor). Te recomiendo abrirla también en el celular para ver la vista del repartidor. Es una versión de demostración: los pagos son simulados (no se cobra dinero) y no ingreses datos reales de clientes.

---

## Si algo falla

| Síntoma en los logs | Solución |
|---|---|
| `ENOTFOUND db.xxx.supabase.co` / `ENETUNREACH` | Estás usando la conexión directa. Cambia `DATABASE_URL` por la del **Session pooler**. |
| `password authentication failed` | Clave incorrecta, o quedó `[YOUR-PASSWORD]` en la URL. Puedes resetearla en Supabase → Database → Settings. |
| `Tenant or user not found` | El usuario del pooler debe ser `postgres.<ref-del-proyecto>` (con punto y el ref). |
| `Invalid URL` o conexión rara | La clave tiene símbolos. Cambia la clave de la base por una solo con letras y números. |
| `Supabase Storage (autorización…) respondió 401/403` | `SUPABASE_SECRET_KEY` incorrecta (no uses la *publishable/anon*, usa la **secret/service_role**). |
| `ECONNREFUSED` / `timeout` | El proyecto de Supabase está pausado (plan gratis tras 7 días sin uso): entra a Supabase y presiona **Restore**. |
| `npm warn config production Use --omit=dev instead` (en rojo) | Solo un aviso de npm, no un error. Ya no aparece: la app arranca con `node server/index.js`. |
| Healthcheck falla / "Application failed to respond" | Revisa los logs: casi siempre es `DATABASE_URL`. |
| La página pide clave y no la acepta | Revisa `DEMO_CLAVE` en Railway (distingue mayúsculas). |
| Las fotos no cargan | Revisa en los logs la línea `[archivos]`; debe decir Supabase Storage. |

## Notas importantes

- **Plan gratuito de Supabase:** pausa el proyecto tras ~1 semana sin actividad. Para producción real, plan Pro.
- **Seguridad de la demo:** con `AUTH_MODE=demo` cualquiera que tenga la clave entra como administrador. Es para mostrar, **no para datos reales**. Para operar de verdad: `AUTH_MODE=jwt` y `SEED_DEMO=false` (inicio de sesión real, ver [16](16-inicio-de-sesion.md)).
- **Los QR apuntan al dominio de Railway.** Cuando exista el dominio `.cl` (NIC.cl), define `PUBLIC_BASE_URL` y reimprime los tickets de prueba.
- **Actualizaciones:** cada `git push` a la rama configurada redespliega solo. Las migraciones nuevas se aplican automáticamente y no se repiten.
- **Respaldos:** Supabase hace respaldos diarios en los planes pagados; en el gratuito, exporta periódicamente (Database → Backups).
