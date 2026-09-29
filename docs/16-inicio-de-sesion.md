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
3. Entra con `ADMIN_EMAIL` / `ADMIN_PASSWORD` (el administrador creado en el primer arranque).
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

## Probarlo en local

```bash
AUTH_MODE=jwt npm run dev                  # http://localhost:3000 → pantalla de ingreso
# Cuentas locales: admin@envios.local / Cambiar.Esta.Clave.2026 · cliente@demo.cl / Demo.2026 · repartidor@demo.cl / Demo.2026
QA_ADMIN_CORREO=admin@envios.local QA_ADMIN_PASSWORD=Cambiar.Esta.Clave.2026 npm run qa:local   # 78 casos
```

## Pendiente

- Recuperación de contraseña **por correo** (RF-02): requiere un proveedor de correo (p. ej. Resend o SendGrid).
  Mientras tanto, administración asigna una contraseña temporal.
