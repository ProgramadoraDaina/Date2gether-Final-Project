# Date2gether

Aplicación de reuniones desde el navegador. Monorepo con backend NestJS, Socket.io y Drizzle ORM sobre PostgreSQL, y frontend Next.js 15 + React 19 en `client/`. Se usa **pnpm**.

Las reglas de producto están en [docs/requirements.md](docs/requirements.md). Este README explica cómo instalar y ejecutar la versión actual.

## Comportamiento actual

- Crear una reunión requiere una cuenta registrada y una sesión válida. Su creador queda como administrador de esa sala.
- Una persona con el enlace `/room/<código>` puede entrar **sin cuenta**, después de elegir y confirmar su nombre (entre 1 y 60 caracteres, sin contar espacios exteriores). También se puede introducir el código desde el inicio.
- El nombre visible no concede permisos. El servidor emite un pase de participante para esa sala, válido durante 24 horas. Sirve para chat y llamadas; no sirve para crear salas, consultar cuentas ni administrar roles. Cada participante recibe un identificador distinto aunque repita el nombre de otra persona.
- Los usuarios registrados conservan los roles por sala: administrador, colaborador y participante. Los invitados no reciben permisos de administración.
- Hay chat de texto persistente, presencia en tiempo real, interfaz ES/EN y tema claro/oscuro.
- El botón **Llamar** conecta el audio con Amazon Chime SDK. Se obtiene la reunión de la sala y un asistente asociado al pase de participante. La cámara, la grilla de video y compartir pantalla siguen pendientes.
- El ingreso actual es directo con enlace y nombre. La sala de espera, el bloqueo de ingresos y el cupo de 100 personas son funcionalidades pendientes; no se presentan como controles implementados.

## Requisitos

- Node.js 20 o superior (ver las restricciones de las dependencias instaladas).
- pnpm **11.18.0**, fijado en `package.json`.
- Docker Engine y Docker Compose, o PostgreSQL 16 accesible.
- Para probar audio: una cuenta AWS con acceso a Amazon Chime SDK Meetings y credenciales disponibles para el backend.

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
AWS_REGION=us-east-1
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

La etapa actual usa **AWS y Amazon Chime SDK** aprovechando el plan gratuito previsto por el equipo durante hasta seis meses. AWS indica que el Free account plan termina al cumplirse seis meses o al agotarse los créditos, lo que ocurra primero. La disponibilidad de Chime y la cobertura de su uso deben confirmarse en la cuenta del proyecto: el plazo no garantiza llamadas ilimitadas ni que todos los servicios estén incluidos. Referencia: [planes de AWS](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

Las credenciales se resuelven mediante la cadena estándar del SDK de AWS, por ejemplo un perfil local (`AWS_PROFILE`) o un rol IAM en el despliegue. Nunca se envían al navegador. El backend necesita permisos `chime:CreateMeeting`, `chime:GetMeeting` y `chime:CreateAttendee`. `AWS_REGION=us-east-1` configura el plano de control; el código usa `sa-east-1` para los medios.

Para una prueba real, dos navegadores abren el mismo enlace, confirman sus nombres y pulsan **Llamar**. Ambos deben recibir audio en la misma reunión. Hace falta permiso de micrófono y un contexto seguro (HTTPS o localhost). La suite automatizada simula AWS y no demuestra por sí sola que una llamada real funcione.

El proyecto no crea recursos AWS al instalar dependencias o ejecutar migraciones. Las llamadas a Chime se realizan al pulsar Llamar. Al vencer el período o los créditos se debe decidir cómo continuar antes de mantener el despliegue activo.

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
| POST   | `/calls/:roomCode`                                               | Pase de participante de esa sala; devuelve `{ meeting, attendee }` |

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

Los siguientes avances son la previsualización y selección de dispositivos, el video real, la moderación de acceso y el control de cupo. El objetivo del producto sigue siendo reuniones de hasta 100 personas; esa capacidad, el cierre de salas, el vencimiento del chat, los adjuntos, los stickers, la grabación local, los subtítulos y los fondos requieren las implementaciones y validaciones descritas en los requisitos.
