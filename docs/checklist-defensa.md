# Checklist previo a la defensa

Esta lista se completa antes de la presentación, de preferencia el día anterior y de nuevo 30 minutos antes. Todas las URL asumen el dominio `app.date2gether.duckdns.org`. No escribir contraseñas reales en este archivo ni en el repositorio.

## 1. Encender la infraestructura

La EC2 se apaga sola **dos horas después de cada arranque** (temporizador `date2gether-autostop.timer`, ver [deploy/ec2/README.md](../deploy/ec2/README.md)). Por eso hay que encenderla poco antes y recordar que se detendrá durante la defensa si pasan más de dos horas.

- [ ] Iniciar la instancia desde **AWS Console > EC2 > Instances > Start instance** (región `us-east-2`; el stack se llama `date2gether-demo`). La IP reservada se mantiene y los contenedores arrancan solos.
- [ ] Esperar unos minutos a que Docker levante los servicios. Verificar desde **EC2 > Connect > Session Manager**:

```bash
sudo docker compose -f /opt/date2gether/deploy/ec2/compose.yaml ps
sudo systemctl status date2gether-autostop.timer
```

- [ ] Si se necesita más de dos horas, desactivar temporalmente el timer desde esa terminal y volver a habilitarlo al terminar. El apagado interrumpe las llamadas activas.
- [ ] Confirmar que la sesión AWS y el saldo de créditos siguen vigentes en **AWS Settings > Billing**. Si hay un límite de gasto configurado y se superó, el proyecto se pausa.

## 2. El dominio no volvió a `sslip.io`

El dominio sale del parámetro `BaseDomain` del stack. Si una actualización del stack se ejecuta sin ese parámetro, la plantilla vuelve a generar `https://app.<IP>.sslip.io` (ver `deploy/ec2/cloudformation.json`, salidas `ApplicationUrl` y `MediaUrl`).

- [ ] **CloudFormation > Stacks > `date2gether-demo` > Outputs**: `ApplicationUrl` debe ser `https://app.date2gether.duckdns.org` y `MediaUrl` debe ser `wss://media.date2gether.duckdns.org`. Si aparece `sslip.io`, no está bien: no seguir hasta corregirlo.
- [ ] Desde la terminal de Session Manager, comprobar los hosts que Caddy usa: `sudo ls /opt/date2gether/deploy/ec2/runtime/` y revisar `caddy.json` (los hosts `app.`, `media.` y `turn.` deben terminar en `date2gether.duckdns.org`).
- [ ] Los tres registros DNS (`app`, `media`, `turn`) apuntan a la IP pública de la salida `PublicIp` del stack:

```bash
nslookup app.date2gether.duckdns.org
nslookup media.date2gether.duckdns.org
nslookup turn.date2gether.duckdns.org
```

## 3. La aplicación responde

```bash
curl -I https://app.date2gether.duckdns.org/
curl -i https://app.date2gether.duckdns.org/api/health
```

- [ ] Ambas respuestas son `200`. El certificado HTTPS es válido (sin advertencias en el navegador).
- [ ] `/api/health` llega al backend como `/health`: Caddy quita el prefijo `/api` (`deploy/ec2/configure.py`).

## 4. Usuarios de prueba en producción

No hay un script de seed para usuarios de demostración en el repositorio. Las cuentas se crean registrándose desde la interfaz y el rol global `admin` se asigna a mano con `scripts/promote-admin.mjs` (`pnpm admin:promote <email>`, que requiere `DATABASE_URL` apuntando a la base; ver la sección "Administradores globales" del README).

- [ ] Iniciar sesión en `https://app.date2gether.duckdns.org/login` con la cuenta **admin** de prueba: debe poder entrar a `/admin`.
- [ ] Iniciar sesión con la cuenta **user** de prueba: no debe ver el panel `/admin`.
- [ ] Si falta alguna, registrarla desde `/register` y, para el admin, promoverla desde la terminal de la instancia (la base está dentro del contenedor `postgres`, que solo escucha en `127.0.0.1`). Las credenciales de prueba se comparten por un canal privado del equipo, no por el repositorio.
- [ ] Las cuentas de prueba tienen datos para mostrar (al menos una sala y algo de historial).

## 5. Rúbrica en ventana de incógnito

Usar una ventana privada nueva para no reutilizar sesión. Con DevTools abierto en la pestaña Network. Reemplazar los valores entre `<>`.

- [ ] **Registro, login y logout:** registrar una cuenta nueva, cerrar sesión, iniciar sesión de nuevo y cerrar sesión otra vez.
- [ ] **Botón Atrás tras logout:** después de cerrar sesión, pulsar Atrás. No debe mostrarse contenido privado; la aplicación redirige al login o muestra el estado de sesión cerrada.
- [ ] **401 sin token:** el backend devuelve 401 si falta el token de acceso.

```bash
curl -i https://app.date2gether.duckdns.org/api/auth/me
```

- [ ] **403 con usuario común en un endpoint de administración:** iniciar sesión como `user`, copiar su `accessToken` de la respuesta de `/api/auth/login` y probar:

```bash
curl -i -H "Authorization: Bearer <ACCESS_TOKEN_USER>" https://app.date2gether.duckdns.org/api/admin/users
```

  Esperado: `403`. Con el token del admin, el mismo pedido devuelve `200`.

- [ ] **Aislamiento por ID ajeno:** con el token del usuario B, pedir un recurso que pertenece al usuario A (por ejemplo el código de una sala de A en `/api/rooms/<CODIGO_DE_A>/members`, o las notas de esa sala). Debe rechazarse (`403` o `404`), nunca devolver datos de A. Anotar el código real que devuelve cada recurso probado.
- [ ] **El hash de la contraseña nunca se expone:** revisar en Network las respuestas de `/api/auth/register`, `/api/auth/login`, `/api/auth/me` y `/api/admin/users`. Ninguna debe contener `passwordHash` ni `password_hash`.

## 6. Prueba final de la funcionalidad principal

- [ ] Crear una sala, copiar el enlace y entrar desde un segundo dispositivo o red (por ejemplo, datos móviles).
- [ ] Probar audio y video entre ambos y el chat. Confirmar que el cupo de seis participantes se respeta (ver "Prueba de la entrega" en [deploy/ec2/README.md](../deploy/ec2/README.md)).
- [ ] Dejar abierta una pestaña con la sesión del admin y otra con la del usuario, listas para la demostración.
