# 10 · Despliegue: localhost, Railway, Vercel y dominio NIC.cl

## 0. El archivo de URLs: `entornos.env`

En la raíz del repositorio. **Aquí pegas la URL de Railway** (y la de Vercel y el dominio cuando existan):

```env
URL_LOCAL=http://localhost:3000
URL_RAILWAY=https://envios-production.up.railway.app   ← pega la tuya
URL_VERCEL=https://envios.vercel.app                   ← opcional
URL_PRODUCCION=https://envios.tuempresa.cl              ← cuando exista el dominio .cl
QA_OBJETIVO=local
API_OBJETIVO=mismo_origen
```

Se usa en tres lugares:
- **Pruebas QA:** `npm run qa:local`, `npm run qa:railway`, `npm run qa:vercel`.
- **Interfaz:** `npm run build:web` genera `web/config.js` con la API elegida en `API_OBJETIVO`.
- **Dentro de la app:** el botón de servidor (arriba a la derecha) permite cambiar entre localhost y Railway en caliente, sin recompilar.

## 1. Local (localhost)

Requisitos: Node.js 20 o superior y PostgreSQL (o Docker).

```bash
docker compose up -d            # PostgreSQL local en el puerto 5432 (o usa uno propio)
cp .env.example .env            # variables del servidor
npm install
npm run dev                     # crea tablas, carga 346 comunas y perfiles demo
# abrir http://localhost:3000
node scripts/datos-demo.js local   # (opcional) envíos de ejemplo
npm test                        # pruebas unitarias
npm run qa:local                # suite QA contra localhost
```

## 2. Railway

> **Base de datos en Supabase (configuración elegida):** sigue la guía [12-primera-version-railway-supabase.md](12-primera-version-railway-supabase.md). Lo que sigue en esta sección es la alternativa con PostgreSQL de Railway.


1. En [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** → elegir este repositorio. Railway lee `railway.json` (arranque `npm start`, healthcheck `/api/health`).
2. **+ New → Database → PostgreSQL** en el mismo proyecto.
3. En el servicio de la app → **Variables**:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referencia a la base) |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | una cadena larga aleatoria |
   | `PUBLIC_BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (o el dominio .cl) |
   | `CORS_ORIGINS` | URL de Vercel y dominio, separados por coma |
   | `AUTH_MODE` | `demo` para la presentación; **`jwt` con datos reales** |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | solo para el primer arranque con la base vacía; después se borran (las cuentas viven en la base) |
   | `UPLOAD_DIR` | `/data/uploads` |
   | `TZ` | `America/Santiago` |

4. **Volume:** en el servicio → *Add Volume* → montar en `/data` (fotos y boletas persisten entre despliegues).
5. **Settings → Networking → Generate Domain** → copia la URL y pégala en `entornos.env` como `URL_RAILWAY`.
6. Verifica: `npm run qa:railway` (recomendado en un proyecto de *staging*, porque las pruebas crean datos `qa-…`).

## 3. Vercel (opcional: solo la interfaz)

1. En [vercel.com](https://vercel.com): **Add New → Project** → importar el repositorio. Vercel lee `vercel.json` (publica la carpeta `web/`).
2. **Environment Variables:** `API_URL` = la URL de Railway (ej. `https://envios-production.up.railway.app`).
3. Despliega y copia la URL a `entornos.env` como `URL_VERCEL`.
4. En Railway agrega esa URL en `CORS_ORIGINS` y, si solo quieres la interfaz en Vercel, `SERVE_WEB=false`.
5. Verifica: `npm run qa:vercel` (prueba la interfaz en Vercel y la API en Railway).

## 4. Dominio en NIC.cl

1. Cuando se defina el nombre (pendiente P-01), revisar disponibilidad en [nic.cl](https://www.nic.cl) e inscribirlo **a nombre del cliente** (persona o empresa con RUT).
2. En el panel de NIC.cl configurar los servidores DNS (del proveedor de DNS que se use; NIC.cl no aloja registros por sí mismo).
3. Crear los registros según dónde vive cada parte:
   - Interfaz y API en Railway: en Railway → *Settings → Networking → Custom Domain* → agregar `envios.tuempresa.cl` y crear el **CNAME** que indique Railway.
   - Interfaz en Vercel: en Vercel → *Settings → Domains* → agregar el dominio y crear el registro que indique Vercel; la API puede quedar en `api.tuempresa.cl` apuntando a Railway.
4. Actualizar `PUBLIC_BASE_URL` (los QR usan esta URL), `CORS_ORIGINS` y `URL_PRODUCCION` en `entornos.env`.
5. Ejecutar `node qa/run.js produccion`.

> Importante: los QR impresos apuntan a `PUBLIC_BASE_URL`. **Definir el dominio antes de imprimir tickets reales** para no tener QR que apunten a una URL provisoria.

## 5. Lista de verificación antes de producción

- [ ] `AUTH_MODE=jwt` y pantalla de login (D-01)
- [ ] `JWT_SECRET` propio y contraseña de admin cambiada
- [ ] Pasarela real configurada (D-02)
- [ ] Dominio `.cl` con HTTPS y `PUBLIC_BASE_URL` definitivo
- [ ] Volume o S3/R2 para archivos; respaldos de PostgreSQL activos
- [ ] `SEED_DEMO=false` (sin perfiles de demostración)
- [ ] Suite QA verde contra el entorno final
- [ ] Revisión legal de privacidad
