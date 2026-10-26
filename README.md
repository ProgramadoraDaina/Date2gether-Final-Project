# Date2gether

Aplicación de reuniones desde el navegador. Monorepo con backend NestJS, Socket.io y Drizzle ORM sobre PostgreSQL, y frontend Next.js 15 + React 19 en `client/`. Se usa **pnpm**.

Las reglas de producto están en [docs/requirements.md](docs/requirements.md). Este README explica cómo instalar y ejecutar la versión actual.

## Comportamiento actual

- Crear una reunión requiere una cuenta registrada y una sesión válida. Su creador queda como administrador de esa sala.
- Una persona con el enlace `/room/<código>` puede entrar **sin cuenta**, después de elegir y confirmar su nombre (entre 1 y 60 caracteres, sin contar espacios exteriores). También se puede introducir el código desde el inicio.
- El nombre visible no concede permisos. El servidor emite un pase de participante para esa sala, válido durante 24 horas. Sirve para chat y llamadas; no sirve para crear salas, consultar cuentas ni administrar roles. Cada participante recibe un identificador distinto aunque repita el nombre de otra persona.
- Los usuarios registrados conservan los roles por sala: administrador, colaborador y participante. Los invitados no reciben permisos de administración.
- Hay chat de texto persistente, presencia en tiempo real, interfaz ES/EN y tema claro/oscuro.
- El botón **Llamar** conecta el audio con Amazon Chime SDK cuando el servicio está habilitado para el proyecto AWS. Se obtiene la reunión de la sala y un asistente asociado al pase de participante. La cámara, la grilla de video y compartir pantalla siguen pendientes.
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
AWS_REGION=us-east-2
AWS_PROFILE=date2gether
AWS_CHIME_ENABLED=false
AWS_CHIME_REGION=us-east-1
AWS_CHIME_MEDIA_REGION=us-east-2
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

La integración de audio utiliza **Amazon Chime SDK Meetings**. El Agent Toolkit permite al asistente consultar AWS; la aplicación usa el SDK de JavaScript directamente desde NestJS. Instalar el Toolkit o iniciar sesión no habilita servicios ni concede permisos adicionales.

### Disponibilidad del plan

En el **nuevo AWS experience**, Amazon Chime SDK figura entre los [servicios no admitidos](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#unsupported-services), incluso en su plan pago simplificado. Para usarlo se requiere pasar al plan pago y [activar funciones avanzadas](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html). No basta con tener créditos ni con esperar el período de seis meses. La consulta de solo lectura realizada durante esta configuración confirmó un plan `FREE` activo; no se habilitó Chime.

Las funciones avanzadas son una decisión aparte: la activación es irreversible y elimina los límites de gasto de AWS Settings. Los créditos obtenidos se conservan según sus condiciones, pero no garantizan llamadas gratis durante seis meses. Antes de activar, revisar en **AWS Settings > Billing** el saldo, el vencimiento y los servicios cubiertos; luego controlar los costos mediante AWS Billing y presupuestos. Los presupuestos notifican y no reemplazan un corte automático. La configuración del repositorio mantiene `AWS_CHIME_ENABLED=false` hasta aprobar esa decisión. En ese estado, Llamar responde con HTTP 503 y un mensaje legible, sin realizar solicitudes a Chime. Cuenta, invitados y chat siguen funcionando.

### Credenciales y regiones

Para desarrollo local se utiliza el perfil `date2gether`, creado mediante:

```bash
aws login --profile date2gether --region us-east-2
```

El SDK instalado soporta perfiles `login_session` y renueva las credenciales temporales de esa sesión. Si vence la sesión, volver a iniciar sesión con ese comando. No copiar tokens ni claves a `.env`, al frontend o al repositorio. En un despliegue AWS se omite `AWS_PROFILE` y se utiliza un rol del servicio. El backend necesita permisos `chime:CreateMeeting`, `chime:GetMeeting` y `chime:CreateAttendee`.

| Variable | Valor de ejemplo | Uso |
| --- | --- | --- |
| `AWS_REGION` | `us-east-2` | Región seleccionada del proyecto; confirmar en AWS Settings > View all projects > Overview > Additional Info > Region. |
| `AWS_PROFILE` | `date2gether` | Perfil local de la sesión de AWS CLI. Omitir al usar un rol en AWS. |
| `AWS_CHIME_ENABLED` | `false` | Activación explícita del audio, después de confirmar acceso y costos. |
| `AWS_CHIME_REGION` | `us-east-1` | Endpoint del plano de control de Meetings; no existe en Ohio. No se realizan solicitudes allí mientras las llamadas estén deshabilitadas. |
| `AWS_CHIME_MEDIA_REGION` | `us-east-2` | Región donde se procesa el audio. Si se omite, usa `AWS_REGION`. |

La [tabla de endpoints](https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html#chime-sdk-region) y la [API CreateMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html) distinguen la región de control de la región de medios. Para habilitar esta combinación se necesita acceso autorizado al endpoint de Virginia; no se intenta sortear la restricción regional del nuevo AWS experience.

### Prueba real de audio

Solo después de confirmar que Chime está habilitado, sus permisos y la cobertura del consumo, configurar `AWS_CHIME_ENABLED=true` y reiniciar el backend. No hay cambio de plan automático. Aplicar primero `pnpm db:migrate` para disponer de `rooms.chime_meeting_id`.

Dos personas desde navegadores o dispositivos distintos abren el mismo enlace, confirman sus nombres y pulsan **Llamar**. Pueden ser invitados sin cuenta. Hace falta permiso de micrófono y un contexto seguro (HTTPS o localhost). Si usan el mismo equipo, utilizar auriculares para evitar acople.

La interfaz permanece en Conectando hasta que Chime confirma la conexión. Durante ese paso se puede cancelar; ya conectados, se puede silenciar, activar el micrófono o colgar. Al salir, cancelar o fallar la conexión se liberan los dispositivos. Los participantes de una misma sala reciben la misma reunión, también si llaman simultáneamente. Las credenciales temporales de participante (`JoinToken`) solo se entregan a quien presenta el pase de esa sala; las credenciales AWS permanecen en el servidor.

La suite automatizada simula AWS y verifica configuración deshabilitada, errores seguros, concurrencia y el ciclo de audio del cliente. No acredita una llamada real ni capacidad para 100 personas. No se ejecutan servidores ni se crean recursos AWS al correr esas pruebas. Las reuniones siguen dependiendo del cierre por inactividad de Chime; el cierre explícito en AWS queda pendiente.

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
