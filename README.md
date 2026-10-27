# Date2gether

Aplicación de reuniones desde el navegador. Monorepo con backend NestJS, Socket.io y Drizzle ORM sobre PostgreSQL, y frontend Next.js 15 + React 19 en `client/`. Se usa **pnpm**.

Las reglas de producto están en [docs/requirements.md](docs/requirements.md). Este README explica cómo instalar y ejecutar la versión actual.

## Comportamiento actual

- Crear una reunión requiere una cuenta registrada y una sesión válida. Su creador queda como administrador de esa sala.
- Una persona con el enlace `/room/<código>` puede entrar **sin cuenta**, después de elegir y confirmar su nombre (entre 1 y 60 caracteres, sin contar espacios exteriores). También se puede introducir el código desde el inicio.
- El nombre visible no concede permisos. El servidor emite un pase de participante para esa sala, válido durante 24 horas. Sirve para chat y llamadas; no sirve para crear salas, consultar cuentas ni administrar roles. Cada participante recibe un identificador distinto aunque repita el nombre de otra persona.
- Los usuarios registrados conservan los roles por sala: administrador, colaborador y participante. Los invitados no reciben permisos de administración.
- Hay chat de texto persistente, presencia en tiempo real, interfaz ES/EN y tema claro/oscuro.
- El botón **Llamar** conecta audio y video con LiveKit. Hay grilla de participantes, controles y selección de cámara y micrófono; ambos dispositivos empiezan apagados. Las llamadas admiten seis personas por defecto. Compartir pantalla sigue pendiente.
- El ingreso actual es directo con enlace y nombre. La sala de espera, el bloqueo de ingresos y el cupo de admisión al chat son funcionalidades pendientes; no se presentan como controles implementados.

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

Al pulsar Llamar se conecta con cámara y micrófono apagados. Se pueden activar o desactivar y elegir los dispositivos desde la llamada. La grilla muestra nombre y estado de cámara, incluido un recuadro para quien no publica video. El audio remoto se reproduce mediante LiveKit; si el navegador lo bloquea, se ofrece Activar sonido de la reunión. Rechazar un permiso no impide continuar con el resto de la reunión. Colgar o abandonar la página desconecta y libera los dispositivos.

Las llamadas requieren HTTPS o localhost. En EC2 el frontend usa `/api` para REST y Socket.io a través del mismo dominio HTTPS, evitando contenido mixto. Las credenciales privadas de LiveKit permanecen en el servidor; el navegador recibe solo su pase temporal. No se registran tokens ni se versionan archivos de configuración generados.

La columna histórica `rooms.chime_meeting_id` se conserva para no reescribir migraciones existentes; LiveKit no la utiliza. No hay una migración destructiva al cambiar de proveedor. Se deben seguir aplicando las migraciones versionadas con `pnpm db:migrate`.

La comprobación real se hace desde dos o más dispositivos y redes diferentes, con invitados y permisos rechazados; después se valida el límite de seis conexiones de medios. Las pruebas automáticas y los builds no demuestran por sí solos una videollamada real en EC2.

## Seguridad de la entrega

Las credenciales reales de LiveKit, PostgreSQL y JWT del despliegue EC2 se generan en el host y quedan en `deploy/ec2/runtime/`, ignorado por Git. Las claves `devkey` de `.env.example` y `deploy/local/livekit.yaml` son públicas y solo sirven para desarrollo local; no usarlas en un servidor accesible desde Internet. `.env*` está excluido del repositorio, con excepción de los archivos `.env.example`, que no deben contener secretos.

En desarrollo local, PostgreSQL y LiveKit publican sus puertos solo en `127.0.0.1`. Si PostgreSQL ya estaba levantado con una configuración anterior, aplicar el cambio ejecutando `docker compose up -d postgres`; Docker recrea ese contenedor y conserva su volumen de datos. No ejecutar `docker compose down -v` salvo que se desee eliminar esos datos.

Los códigos nuevos de las salas usan aleatoriedad criptográfica. Cualquier persona que posea el enlace puede solicitar acceso y leer el chat de esa sala; tratar el enlace como privado. El proyecto todavía no implementa sala de espera, expulsión ni revocación completa de invitaciones. Las sesiones de cuenta se guardan en `localStorage`, por lo que una inyección de scripts en el navegador podría exponerlas; se debe revisar esa decisión antes de usar la aplicación con datos reales.

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

`POST /rooms/:code/access` devuelve `{ token, participant }`. El frontend conserva el pase en memoria durante la visita; abrir o recargar el enlace vuelve a pedir confirmación del nombre. Una reconexión automática del socket usa el mismo pase. El nombre anterior puede estar precargado, pero no se ingresa automáticamente.

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

La entrega académica usa seis participantes por llamada. Siguen pendientes la previsualización antes de entrar, compartir pantalla, moderación de acceso, cupo del chat, cierre de salas de la aplicación, vencimiento del chat, adjuntos, stickers, grabación local, subtítulos y fondos, según los requisitos.
