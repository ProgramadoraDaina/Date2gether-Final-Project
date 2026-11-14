# Date2gether

Aplicación de reuniones desde el navegador. Monorepo con backend NestJS, Socket.io y Drizzle ORM sobre PostgreSQL, y frontend Next.js 15 + React 19 en `client/`. Se usa **pnpm**.

Las reglas de producto están en [docs/requirements.md](docs/requirements.md). Este README explica cómo instalar y ejecutar la versión actual.

## Comportamiento actual

- Crear una reunión requiere una cuenta registrada y una sesión válida. Su creador queda como administrador de esa sala.
- Una persona con el enlace `/room/<código>` puede entrar **sin cuenta**, después de elegir y confirmar su nombre (entre 1 y 60 caracteres, sin contar espacios exteriores). También se puede introducir el código desde el inicio.
- El nombre visible no concede permisos. El servidor emite un pase de participante para esa sala, válido durante 24 horas. Sirve para chat y llamadas; no sirve para crear salas, consultar cuentas ni administrar roles. Cada participante recibe un identificador distinto aunque repita el nombre de otra persona.
- Los usuarios registrados conservan los roles por sala: administrador, colaborador y participante. Los invitados no reciben permisos de administración.
- Hay chat de texto persistente, presencia en tiempo real, interfaz ES/EN y tema claro/oscuro.
- Antes de entrar hay un lobby para confirmar el nombre, seleccionar cámara y micrófono y probarlos con video local y un medidor de voz. Ambos empiezan apagados y solo se solicitan permisos al activarlos. Una vez concedido el ingreso, se conectan chat y llamada con LiveKit usando la elección confirmada; hay grilla de participantes y controles para cambiar los dispositivos durante la llamada. Las llamadas admiten seis personas por defecto. También se puede compartir pantalla durante la llamada.
- El ingreso es directo por defecto. El administrador puede activar la sala de espera, admitir o rechazar solicitudes y bloquear nuevos ingresos desde **Administrar ingresos**. Quien espera no recibe chat ni pases de llamada; el cupo de admisión al chat sigue pendiente.

## Moderar el ingreso

El administrador entra con su cuenta y abre **Administrar ingresos** desde la sala. Puede activar o desactivar la espera y bloquear nuevos ingresos. La espera empieza desactivada; el anfitrión no necesita admitirse a sí mismo. Los nombres visibles nunca conceden permisos de administrador.

Con la espera activa, cada ingreso crea una solicitud propia, incluso si varias personas usan el mismo nombre. El administrador ve su nombre, si tiene cuenta y cuándo lo solicitó, y puede admitirla o rechazarla. La pantalla se actualiza automáticamente; el invitado consulta el resultado cada cinco segundos y puede cancelar. Un rechazo requiere una nueva acción de la persona para volver a solicitar acceso.

La credencial de espera se limita a consultar o cancelar esa solicitud; no sirve para chat, llamadas ni acciones de cuenta. Se conserva en sessionStorage para recuperar la espera al recargar, y vence a las 24 horas. La configuración y las decisiones se guardan en PostgreSQL y sobreviven a un reinicio. La admisión usa el ID de la solicitud como identidad estable; volver a consultar el resultado no crea otra participación.

Desactivar la espera admite las solicitudes pendientes cuando los ingresos están desbloqueados; no cambia rechazos o cancelaciones anteriores. Bloquear impide nuevas solicitudes y admisiones, sin retirar a quienes ya fueron admitidos. Si se desactiva la espera mientras está bloqueada, las solicitudes continúan pendientes hasta desbloquear. La capacidad de seis conexiones de LiveKit continúa separada del cupo de admisión al chat, que está pendiente.

Aplicar la migración versionada con `pnpm db:migrate` antes de desplegar este cambio.

## Requisitos

- Node.js 20 o superior (ver las restricciones de las dependencias instaladas).
- pnpm **11.18.0**, fijado en `package.json`.
- Docker Engine y Docker Compose, o PostgreSQL 16 accesible.
- Para probar audio y video: LiveKit local con Docker o el despliegue EC2 documentado. No hace falta acceso a Chime SDK.

## Instalar y preparar la base

Desde la raíz:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
cp client/.env.example client/.env
```

Completá `.env`:

```dotenv
DATABASE_URL=postgresql://date2gether:date2gether@localhost:5432/date2gether
PORT=3001
CORS_ORIGIN=http://localhost:3002
JWT_ACCESS_SECRET=<secreto-de-access>
JWT_REFRESH_SECRET=<otro-secreto-distinto>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-for-local-development-only-32chars
MAX_ROOM_PARTICIPANTS=6
GIPHY_API_KEY=<key-beta-de-developers.giphy.com>
```

Generá cada secreto por separado con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Los `.env` y las credenciales no se versionan.

```bash
docker compose up -d
pnpm db:migrate
```

Se aplican las migraciones versionadas. `0002_panoramic_nebula` incorpora roles y `0003_chime_meeting` agrega `rooms.chime_meeting_id`. `pnpm db:generate` se usa al cambiar el esquema, no para iniciar un clon existente.

Si una base de la versión anterior del PR ya aplicó `0002_fast_nebula`, registró antes la migración de Chime que la de roles. No se debe reutilizar esa secuencia como si fuera la nueva: usá una base local nueva o planificá su reconciliación conservando los datos. Las bases que siguen las migraciones de `develop` pueden aplicar `0003` normalmente.

## Levantar backend y frontend

En dos terminales, ambas desde la raíz:

```bash
# Terminal 1: API, http://localhost:3001
pnpm start:dev
```

```bash
# Terminal 2: frontend, http://localhost:3002
pnpm dev:client
```

`GET http://localhost:3001/health` comprueba el proceso de la API. No existe un script raíz `pnpm dev` que inicie ambos. Si un puerto está ocupado, revisá si el servidor ya está corriendo.

## AWS y llamadas

Audio y video utilizan **LiveKit autohospedado**. Se reemplaza la integración anterior de Chime porque no está admitida en el plan FREE del nuevo AWS experience. El plan gratuito de LiveKit Cloud tampoco es necesario para este despliegue: se utiliza su servidor abierto en EC2, con consumo de los créditos de infraestructura AWS.

La [guía de EC2](deploy/ec2/README.md) incluye una sola instancia en `us-east-2`, HTTPS, TURN para redes restrictivas, aplicación completa con PostgreSQL, generación privada de secretos y apagado automático a las dos horas. Crear el stack consume créditos; la guía explica costos residuales del disco y la IP y cómo retirar los recursos al terminar.

Para probar localmente, `docker compose up -d` inicia PostgreSQL y LiveKit. Las claves `devkey` del ejemplo son públicas y se usan solo en localhost: no exponer este servicio local en Internet. El despliegue EC2 genera otras claves aleatorias. El backend necesita `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y, opcionalmente, `LIVEKIT_API_URL` para acceder al servidor por la red interna. No utiliza credenciales AWS en tiempo de ejecución.

`POST /calls/:roomCode` valida el pase de sala, confirma que la sala siga abierta y solicita a LiveKit una sala con `MAX_ROOM_PARTICIPANTS=6` (admite valores entre 2 y 20 para la demo). Emite un token temporal de 15 minutos limitado al nombre de esa sala y a la identidad/nombre confirmados del participante. No otorga administración ni grabación del servidor. LiveKit aplica el cupo al conectar, incluso ante solicitudes simultáneas; emitir un token no reserva un lugar. El chat mantiene su control de acceso pero aún no tiene un cupo equivalente de admisión. Cambiar el límite requiere cerrar las salas de medios que ya estaban creadas o esperar a que caduquen.

En el lobby se eligen los dispositivos y si se entra con cámara y micrófono encendidos o apagados. La vista previa no conecta el chat ni envía medios a otras personas. Al entrar se liberan sus capturas locales y LiveKit abre los dispositivos elegidos; un fallo de cámara o micrófono permite continuar con los medios disponibles. Se pueden activar o desactivar y elegir los dispositivos desde la llamada. La grilla muestra nombre y estado de cámara, incluido un recuadro para quien no publica video. El audio remoto se reproduce mediante LiveKit; si el navegador lo bloquea, se ofrece Activar sonido de la reunión. Rechazar un permiso no impide continuar con el resto de la reunión. Colgar o abandonar la página desconecta y libera los dispositivos.

Las llamadas requieren HTTPS o localhost. En EC2 el frontend usa `/api` para REST y Socket.io a través del mismo dominio HTTPS, evitando contenido mixto. Las credenciales privadas de LiveKit permanecen en el servidor; el navegador recibe solo su pase temporal. No se registran tokens ni se versionan archivos de configuración generados.

La columna histórica `rooms.chime_meeting_id` se conserva para no reescribir migraciones existentes; LiveKit no la utiliza. No hay una migración destructiva al cambiar de proveedor. Se deben seguir aplicando las migraciones versionadas con `pnpm db:migrate`.

La comprobación real se hace desde dos o más dispositivos y redes diferentes, con invitados y permisos rechazados; después se valida el límite de seis conexiones de medios. Las pruebas automáticas y los builds no demuestran por sí solos una videollamada real en EC2.

## Seguridad de la entrega

Las credenciales reales de LiveKit, PostgreSQL y JWT del despliegue EC2 se generan en el host y quedan en `deploy/ec2/runtime/`, ignorado por Git. Las claves `devkey` de `.env.example` y `deploy/local/livekit.yaml` son públicas y solo sirven para desarrollo local; no usarlas en un servidor accesible desde Internet. `.env*` está excluido del repositorio, con excepción de los archivos `.env.example`, que no deben contener secretos.

En desarrollo local, PostgreSQL y LiveKit publican sus puertos solo en `127.0.0.1`. Si PostgreSQL ya estaba levantado con una configuración anterior, aplicar el cambio ejecutando `docker compose up -d postgres`; Docker recrea ese contenedor y conserva su volumen de datos. No ejecutar `docker compose down -v` salvo que se desee eliminar esos datos.

Los códigos nuevos de las salas usan aleatoriedad criptográfica. Cualquier persona que posea el enlace puede solicitar acceso. Con la espera desactivada ingresa directamente; con la espera activa debe ser admitida antes de leer el chat. Tratar el enlace como privado. El proyecto todavía no implementa expulsión ni revocación completa de invitaciones. Las sesiones de cuenta se guardan en `localStorage`, por lo que una inyección de scripts en el navegador podría exponerlas; se debe revisar esa decisión antes de usar la aplicación con datos reales.

La auditoría de dependencias realizada el 27 de octubre de 2026 terminó sin vulnerabilidades conocidas en `pnpm audit` después de actualizar Next.js, body-parser, multer y herramientas de desarrollo. El resultado depende de la base de avisos en ese momento y no reemplaza una auditoría o prueba de penetración. También se revisaron los archivos versionables y las referencias Git locales buscando patrones habituales de claves, sin hallar coincidencias; esa búsqueda no garantiza detectar todos los formatos de secretos.

Los cambios de LiveKit y seguridad deben revisarse en el PR antes de desplegarlos. La plantilla prepara medidas para EC2, pero una validación local no comprueba el despliegue real, sus reglas efectivas de red ni permisos en AWS. Verificar el commit y la configuración al crear la instancia y revisar el consumo en AWS Settings > Billing.

## API y Socket.io

| Método | Ruta                                                             | Acceso                                                             |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| POST   | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Gestión de cuentas y sesión                                        |
| GET    | `/auth/me`                                                       | JWT de cuenta                                                      |
| POST   | `/rooms`                                                         | JWT de cuenta; registra al administrador                           |
| GET    | `/rooms/:code`                                                   | Consulta mediante código                                           |
| POST   | `/rooms/:code/access`                                            | Enlace/código y `{ "name": "Ana" }`; JWT de cuenta opcional        |
| POST   | `/rooms/:code/join`                                              | JWT de cuenta; membresía registrada                                |
| GET    | `/rooms/:code/members`                                           | Cuenta miembro de la sala                                          |
| PATCH  | `/rooms/:code/members/:userId`                                   | Administrador de la sala                                           |
| POST   | `/calls/:roomCode`                                               | Pase de participante de esa sala; devuelve `{ url, token, roomName, participantLimit }` |

Con ingreso directo, `POST /rooms/:code/access` devuelve `{ token, participant }`. El frontend conserva el pase en memoria durante la visita; abrir o recargar el enlace vuelve a pedir confirmación del nombre. Una reconexión automática del socket usa el mismo pase. El nombre anterior puede estar precargado, pero no se ingresa automáticamente.

Las rutas de admisión son:

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET / PATCH | `/rooms/:code/admission` | Sesión de cuenta y rol administrador de esa sala |
| PATCH | `/rooms/:code/admission/:id` | Administrador; `{ decision: "admitted" \| "rejected" }` |
| GET | `/rooms/:code/admission/:id/status` | Credencial de espera de esa solicitud |
| POST | `/rooms/:code/admission/:id/cancel` | Credencial de espera de esa solicitud |

Con espera, `POST /rooms/:code/access` devuelve `{ status: "pending", requestId, ticket }` en lugar del pase de participante. La consulta de estado devuelve `{ status: "admitted", access: { token, participant } }` solo después de la admisión. El resto de los estados son `pending`, `rejected`, `cancelled` o `expired`. Las decisiones sobre solicitudes ya resueltas no se sobrescriben; las solicitudes de otras salas no se pueden consultar ni resolver.

El namespace Socket.io es `/rooms`, con `auth: { token }` usando el pase de sala. `joinRoom` recibe `{ code }`; el nombre, el identificador y la cuenta se obtienen del pase verificado. `sendMessage` recibe `{ content }` y `leaveRoom` no requiere payload. El servidor emite `roomHistory`, `roomUsers`, `userJoined`, `userLeft`, `newMessage` y `memberRoleChanged`. La presencia incluye `{ participantId, userName, userId? }`.

## Comprobaciones y próximos pasos

```bash
pnpm build
pnpm build:client
pnpm check:client
pnpm test --runInBand
pnpm test:client --runInBand
```

La [guía E2E](e2e/README.md) explica cómo probar los recorridos con una base separada. El [README del cliente](client/README.md) detalla el flujo del navegador y las [decisiones técnicas](docs/decisiones-tecnicas.md) registran la integración de esta rama.

La entrega académica usa seis participantes por llamada. Siguen pendientes expulsión, cupo del chat, cierre de salas de la aplicación, vencimiento del chat, adjuntos, stickers, grabación local, subtítulos y fondos, según los requisitos.
