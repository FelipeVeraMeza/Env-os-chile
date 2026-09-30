# 16 · Inicio de sesión: cómo activarlo

> 29/09/2026. Administrador, cliente y repartidor entran con **su correo y su contraseña** (`AUTH_MODE=jwt`).
> El modo demostración (`AUTH_MODE=demo`, elegir perfil sin contraseña) sigue disponible para mostrar el visual.

## Activarlo en Railway

1. Railway → tu servicio → **Variables**:
   | Variable | Valor |
   |---|---|
   | `AUTH_MODE` | `jwt` |
   | `SEED_DEMO` | `false` (obligatorio: el servidor no arranca sin esto) |
   | `JWT_SECRET` | la que ya tienes (64 caracteres, `npm run secreto`). Si la cambias, todos deben volver a entrar |
   | `DEMO_CLAVE` | ya no se usa (puedes borrarla) |
2. Railway redespliega solo. Al arrancar, la base aplica la migración `005_sesiones.sql` y **las cuentas demo
   (`cliente@demo.cl`, `repartidor@demo.cl`, etc.) quedan sin acceso**, porque su contraseña `Demo.2026` es pública en
   el repositorio. Sus envíos se conservan.
3. Entra con el administrador que ya existe en la base. Las cuentas y sus contraseñas (cifradas) viven **en la base de
   datos**: `ADMIN_EMAIL` / `ADMIN_PASSWORD` solo se usan si la base está vacía (primer arranque) y después se borran
   de Railway. Si la base está vacía y no están, el servidor no arranca y explica qué hacer.
4. **Usuarios → Nuevo usuario** para cada persona real. La plataforma propone una contraseña temporal: entrégasela por
   un medio seguro; al entrar por primera vez se le pide crear la suya.
5. Usuarios que ya existían sin contraseña aparecen con la marca **Sin contraseña**: usa **Contraseña** para asignarles una.

## Qué hace la plataforma

| Situación | Comportamiento |
|---|---|
| Correo o contraseña incorrectos | Mismo mensaje en ambos casos (no revela qué correos existen) |
| 5 intentos fallidos en una cuenta | Esa cuenta se bloquea 15 minutos (50 por IP, para no bloquear a una oficina entera) |
| Contraseña temporal (asignada por administración) | Al entrar se pide crear una propia; no se puede usar la app sin hacerlo |
| Cambiar la propia contraseña | Pide la actual; cierra las sesiones en otros dispositivos |
| Administración asigna contraseña o desactiva a alguien | Sus sesiones abiertas se cierran de inmediato |
| Sesión | Dura 30 días en el dispositivo (`JWT_DIAS`); al vencer vuelve a la pantalla de ingreso con aviso |
| Seguimiento por folio | Público, sin sesión (enlace en la pantalla de ingreso) |

## Clientes: crear cuenta

La pantalla de ingreso muestra **Crear cuenta de cliente** (activado desde el 30/09/2026, migración `010`). El cliente
indica nombre o empresa, correo, teléfono móvil y una contraseña segura, y entra de inmediato. Siempre queda con perfil
**cliente** (aunque alguien intente registrarse como administrador). Se puede cerrar en **Tarifas y reglas**.

## Reiniciar la plataforma (empezar de cero)

Borra **todos** los usuarios, envíos, destinatarios, pagos, reclamos, costos, fotos/boletas/comprobantes y bitácoras,
y crea el administrador que indiques. Conserva comunas, zonas, tarifas, datos de la empresa y cuenta para
transferencias. Los folios vuelven a `ENV-AAAA-000001`. **No se puede deshacer.**

1. Crea un archivo `.env` en la carpeta del proyecto con los mismos datos de Railway → Variables:
   `SUPABASE_URL`, `SUPABASE_DB_PASSWORD` (o `DATABASE_URL`) y `SUPABASE_SECRET_KEY` (para borrar los archivos).
2. Revisa qué se borraría (no borra nada):
   ```bash
   npm run reiniciar -- --correo admin@empresa.cl --clave "LaClave"
   ```
3. Si la base y los números son los correctos, ejecuta lo mismo agregando `--confirmar`.
4. Entra con ese correo y contraseña. La contraseña queda cifrada (bcrypt) en la base y no se guarda en el repositorio.

## Probarlo en local

```bash
AUTH_MODE=jwt npm run dev                  # http://localhost:3000 → pantalla de ingreso
# Cuentas locales: admin@envios.local / Cambiar.Esta.Clave.2026 · cliente@demo.cl / Demo.2026 · repartidor@demo.cl / Demo.2026
QA_ADMIN_CORREO=admin@envios.local QA_ADMIN_PASSWORD=Cambiar.Esta.Clave.2026 npm run qa:local   # 78 casos
```

## Pendiente

- Recuperación de contraseña **por correo** (RF-02): requiere un proveedor de correo (p. ej. Resend o SendGrid).
  Mientras tanto, administración asigna una contraseña temporal.
