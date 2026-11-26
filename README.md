# Date2gether

Date2gether reúne en una sola videollamada lo que hoy obliga a combinar varias aplicaciones. Está pensada para amigos que viven lejos y parejas a distancia que se juntan seguido por videollamada (hasta seis personas por llamada).

**El problema.** Una reunión entre amigos suele repartirse entre varias herramientas: Meet no tiene música ni dinámicas de grupo, y Discord tiene bots de música, emojis con sonido y chat, pero no tiene gráfico de participación ni encuestas o juegos durante la llamada. Usar varias aplicaciones a la vez tiene un costo: si una pide actualizarse o alguien olvidó su contraseña, esa persona pierde minutos de la charla, y el grupo pierde interés.

**La propuesta.** Una sola aplicación web, sin instalar nada, que reúne videollamada, chat, música de YouTube sincronizada para todos, emojis con sonidos personalizados, encuestas y ruleta durante la llamada, gráfico de participación, subtítulos en vivo, avatares personalizables e interfaz en español e inglés. Quien crea la sala necesita una cuenta; el resto entra con un enlace y un nombre, sin registrarse.

Monorepo con backend NestJS, Socket.io y Drizzle ORM sobre PostgreSQL, y frontend Next.js 15 + React 19 en `client/`. Se usa **pnpm**. Las reglas de producto están en [docs/requirements.md](docs/requirements.md).

## Demo

| Recurso | Enlace |
| --- | --- |
| Frontend | https://app.date2gether.duckdns.org/ |
| API | https://app.date2gether.duckdns.org/api (health check: https://app.date2gether.duckdns.org/api/health) |
| Video de la demo | `TODO: completar URL del video` |

> **Aviso para la defensa:** la demo corre en una instancia EC2 que **se apaga sola dos horas después de cada arranque** (temporizador de systemd, ver [deploy/ec2/README.md](deploy/ec2/README.md)). Puede estar detenida o tardar varios minutos en responder tras iniciarla. Hay que **iniciarla desde la consola de AWS (EC2 > Instances) antes de la presentación**, esperar a que los contenedores arranquen y comprobar que `GET <API>/health` responde `{"status":"ok"}`. Los certificados HTTPS y la IP se conservan al detener y volver a iniciar.

## Usuarios de prueba

| Rol | Email | Contraseña |
| --- | --- | --- |
| `admin` (rol global) | `admin.demo@example.com` | `AdminDemo2026` |
| `user` (rol global) | `usuario.demo@example.com` | `UsuarioDemo2026` |

Los roles globales son `user` (por defecto) y `admin`; son distintos de los roles por sala (administrador, colaborador y participante). Si hace falta crear un administrador en un entorno nuevo, ver [Administradores globales](#administradores-globales).

## Funcionalidades

- Crear una reunión requiere una cuenta registrada y una sesión válida. Su creador queda como administrador de esa sala y como su propietario.
- Una persona con el enlace `/room/<código>` puede entrar **sin cuenta**, después de elegir y confirmar su nombre (entre 1 y 60 caracteres, sin contar espacios exteriores). También se puede introducir el código desde el inicio.
- El nombre visible no concede permisos. El servidor emite un pase de participante para esa sala, válido durante 24 horas. Sirve para chat y llamadas; no sirve para crear salas, consultar cuentas ni administrar roles. Cada participante recibe un identificador distinto aunque repita el nombre de otra persona.
- Los usuarios registrados conservan los roles por sala: administrador, colaborador y participante. Los invitados no reciben permisos de administración. El administrador puede delegar ese rol en otras personas y cambiar el rol por sala de los demás miembros, con dos protecciones: no se puede quitar los permisos al propietario (creador) y la sala siempre conserva al menos un administrador. Además, cada cuenta tiene un rol global (`user` o `admin`) que habilita un panel de moderación en `/admin`.
- Hay chat de texto persistente, presencia en tiempo real, interfaz ES/EN y tema claro/oscuro.
- Antes de entrar hay un lobby para confirmar el nombre, seleccionar cámara y micrófono y probarlos con video local y un medidor de voz. Ambos empiezan apagados y solo se solicitan permisos al activarlos. Una vez concedido el ingreso, se conectan chat y llamada con LiveKit usando la elección confirmada; hay grilla de participantes y controles para cambiar los dispositivos durante la llamada. Las llamadas admiten seis personas por defecto. También se puede compartir pantalla durante la llamada.
- Subtítulos en vivo con la Web Speech API del navegador (solo Chrome y Edge). Cada persona transcribe únicamente su propio micrófono, y se transcribe siempre que el micrófono esté encendido y el navegador lo soporte; el botón **CC** solo muestra u oculta los subtítulos. El texto viaja a los demás por el data channel de LiveKit (topic `transcript`). Las frases finales se guardan en `transcript_lines`, asociadas al sid de la llamada de LiveKit. **Ver transcripción**, en el panel lateral, muestra el acta de esa llamada, y al colgar se abre sola. El botón de ajustes, a la izquierda de colgar, permite elegir el tamaño de los subtítulos y lo recuerda para las próximas llamadas. En Chrome, el audio de los subtítulos pasa por los servidores de Google. La transcripción guardada alimenta el resumen con IA descrito a continuación (ver [docs/uso-de-ia.md](docs/uso-de-ia.md)).
- Resumen con IA de cada llamada: quien participó puede pulsar **Resumir con IA** en la transcripción de una sesión. El backend envía la transcripción a la API de Gemini (`gemini-3.5-flash-lite`) y guarda un único resumen por sesión en `call_summaries`, en español o inglés. Requiere `GEMINI_API_KEY`; sin ella el resto de la aplicación funciona y el resumen responde 503. El texto de la transcripción sale de AWS hacia Google.
- El ingreso es directo por defecto. El administrador puede activar la sala de espera, admitir o rechazar solicitudes y bloquear nuevos ingresos desde **Administrar ingresos** (ver [Moderar el ingreso](#moderar-el-ingreso)). Quien espera no recibe chat ni pases de llamada; el cupo de admisión al chat sigue pendiente.
- Salas permanentes con agenda semanal, bloc de notas compartido, playlist de música ambiental sincronizada (YouTube), GIFs, emojis y sonidos propios de cada sala, historial de llamadas y línea de tiempo de participación por llamada.
- Mini salas: durante la llamada, el administrador crea hasta tres salas paralelas, traslada a las personas, define si se puede entrar libremente o salir sin permiso, programa un cierre automático y llama a todos de vuelta con una cuenta regresiva. Al pasar de sala se conservan el micrófono y la cámara como estaban.
- Pantalla de la llamada configurable: cada persona divide la vista en zonas (cuántas, dónde y con qué proporción) y elige qué participantes van en cada una. El propio video aparece primero.
- Mano levantada con cola por orden de llegada, que cualquier administrador puede bajar; aviso al hablar con el micrófono apagado; desenfoque de fondo; imagen en imagen y atajos de teclado.
- Biblioteca de links persistente en las salas permanentes, que administradores y colaboradores pueden editar. Una sala temporal se puede convertir en permanente.
- "Mis salas" (`/rooms`) lista las salas en las que la cuenta es administradora, incluidas las heredadas por delegación. Cada cuenta puede ocultar una sala de esa lista sin borrarla ni perder su rol; la preferencia es por cuenta.
- Retención y archivo: el historial de llamadas de cada cuenta y el chat de las salas permanentes se muestran paginados durante 90 días; lo anterior pasa a una vista de **archivo**. El chat se consulta por día. Cada cuenta puede vaciar su archivo de llamadas y el administrador de una sala permanente puede vaciar el archivo de esa sala (la purga corre en segundo plano).
- Borrado de salas por su administrador y moderación global (borrar cualquier sala, cambiar el rol global de otras cuentas) por parte de un `admin`.

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, Zustand, CSS Modules, `livekit-client` y `@livekit/components-react` |
| Backend | NestJS 12 sobre Node.js 22, Socket.io para chat y presencia, `livekit-server-sdk` |
| DB | PostgreSQL 16 con Drizzle ORM y migraciones SQL versionadas (`drizzle/`) |
| Auth | JWT de acceso (15 min) y refresh token (7 días, con hash bcrypt en base); contraseñas con bcrypt; pase de sala de 24 h para invitados; roles global y por sala |
| Audio y video | LiveKit autohospedado (reemplazó a Amazon Chime SDK) |
| Deploy | AWS EC2 con Docker Compose, Caddy como proxy inverso HTTPS y plantilla CloudFormation (`deploy/ec2/`) |

Para el detalle de por qué se eligió cada herramienta, las alternativas y lo que se resigna, ver [docs/justificacion.md](docs/justificacion.md).

## Arquitectura

El navegador sirve la interfaz Next.js y habla con la API NestJS por REST y por Socket.io (`/rooms`); el audio y el video van directo del navegador a LiveKit con tokens que firma el backend; PostgreSQL guarda cuentas, salas, mensajes e historial. En EC2 un único Caddy publica HTTPS y enruta `/api/*` al backend. La autorización se resuelve con `JwtAuthGuard`, `RolesGuard` (rol global), `RoomRolesGuard` (rol por sala) y `RoomAccessGuard` (pase de sala).

El diagrama, el recorrido de una petición hasta la base de datos, el modelo de datos (diagrama ER), la **tabla completa de endpoints y eventos de Socket.io** y la organización de carpetas están en [docs/arquitectura.md](docs/arquitectura.md).

## Cómo correrlo en local

### Requisitos

- Node.js 20 o superior (ver las restricciones de las dependencias instaladas).
- pnpm **11.18.0**, fijado en `package.json`.
- Docker Engine y Docker Compose, o PostgreSQL 16 accesible.
- Para probar audio y video: LiveKit local con Docker o el despliegue EC2 documentado. No hace falta acceso a Chime SDK.

### Instalar y preparar la base

Desde la raíz:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
cp client/.env.example client/.env
```

Completar `.env`:

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
GEMINI_API_KEY=<clave-de-aistudio.google.com>   # opcional: sin ella el resumen con IA responde 503
```

Generar cada secreto por separado con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Los `.env` y las credenciales no se versionan.

```bash
docker compose up -d
pnpm db:migrate
```

Se aplican las migraciones versionadas. `0002_panoramic_nebula` incorpora roles y `0003_chime_meeting` agrega `rooms.chime_meeting_id`. `pnpm db:generate` se usa al cambiar el esquema, no para iniciar un clon existente.

Si una base de la versión anterior del PR ya aplicó `0002_fast_nebula`, registró antes la migración de Chime que la de roles. No se debe reutilizar esa secuencia como si fuera la nueva: usar una base local nueva o planificar su reconciliación conservando los datos. Las bases que siguen las migraciones de `develop` pueden aplicar `0003` normalmente.

### Administradores globales

Cada cuenta tiene un rol global (`user` por defecto o `admin`), distinto del rol por sala. Los endpoints `/admin/*` exigen `admin`, por lo que la primera cuenta administradora se crea desde la terminal, con la cuenta ya registrada y `DATABASE_URL` definida en `.env`:

```bash
pnpm admin:promote ana@example.com
```

El script marca esa cuenta como `admin` (el email debe existir). Desde ahí, el panel `/admin` del frontend permite cambiar roles de otras cuentas. El rol se lee de la base en cada request, así que un cambio aplica de inmediato.

### Levantar backend y frontend

En dos terminales, ambas desde la raíz:

```bash
# Terminal 1: API, http://localhost:3001
pnpm start:dev
```

```bash
# Terminal 2: frontend, http://localhost:3002
pnpm dev:client
```

`GET http://localhost:3001/health` comprueba el proceso de la API. No existe un script raíz `pnpm dev` que inicie ambos. Si un puerto está ocupado, revisar si el servidor ya está corriendo.

### Comprobaciones

```bash
pnpm build
pnpm build:client
pnpm check:client
pnpm test --runInBand
pnpm test:client --runInBand
```

La [guía E2E](e2e/README.md) explica cómo probar los recorridos con una base separada. El [README del cliente](client/README.md) detalla el flujo del navegador y las [decisiones técnicas](docs/decisiones-tecnicas.md) registran la integración de cada rama.

## Equipo

Las tareas se repartieron en un tablero de Trello y cada integrante creó la rama de la tarea que tenía asignada. Las áreas de esta tabla salen de los commits de cada persona en `develop` (con las identidades duplicadas unificadas y sin contar commits de merge, según `git shortlog -sn --no-merges`) y de los pull requests que abrió.

| Nombre (usuario GitHub) | Commits | Áreas principales |
| --- | --- | --- |
| Daina Gimena Paucar (`ProgramadoraDaina`) | 242 | Base del proyecto: NestJS, esquema y migraciones con Drizzle, API de salas y chat en tiempo real. Autenticación completa (registro, inicio de sesión, refresh token con rotación, Helmet y validación) y rutas protegidas en el frontend. Pruebas E2E con Playwright e integración continua. Primera versión de llamadas con Chime, historial de llamadas y color de nombre. Música ambiental sincronizada, compartir pantalla, webhooks de LiveKit y línea de tiempo de participación con cierre forzado de la llamada. Salas permanentes con agenda, ruleta, encuestas, controles de administrador (silenciar o apagar cámaras de todos), foco por nombre mencionado, renombrar y borrar salas, convertir salas temporales en permanentes y roles globales. Seguridad de la entrega (filtro global de excepciones, CORS y límite de peticiones por IP real detrás de Caddy). Resumen de llamadas con IA (Gemini). Artefactos `openspec/` y decisiones técnicas. |
| Jonatan Luque (`jluque-venturing`) | 150 | Roles por sala y gestión de miembros. Mini salas (creación, traslados, políticas de entrada y salida, cuenta regresiva y transiciones). Pantalla de la llamada dividida en zonas configurables. Mano levantada, aviso de micrófono apagado y desenfoque de fondo. Biblioteca de links de sala. Rediseño visual de llamadas, historial y ajustes. Sincronización precisa de la música de YouTube. Interfaz en español e inglés, y tema claro y oscuro. Emojis, GIFs y reacciones animadas. Emojis de sala con imagen y sonido, sonidos de Freesound, botonera de sonidos y stickers. Subtítulos en vivo y transcripción guardada y exportable. Búsqueda de canciones en YouTube y playlists persistentes. Página "Mis salas". Avatares personalizables (incluidas máscaras y capas). Logo, íconos y vistas previas al compartir. |
| Alex Sanchez (`Alex-Elian-Sanchez`) | 45 | Migración de Chime a LiveKit: sesiones de sala, controles de audio y video, invitados con nombre y preparación del despliegue en EC2. Notas de sala personales y compartidas, y menciones con @. Sala previa con selección de dispositivos. Sala de espera con autorización de ingreso y su rediseño. Delegación del rol de administrador y protección del creador. Retención y archivo del historial de llamadas y del chat, y ocultar salas de "Mis salas". Mejora del botón de cerrar sesión. |

## Uso de IA

El desarrollo se apoyó en Claude Code y OpenAI Codex, combinando SDD (`openspec/`) y TDD. El producto tiene una función de IA: el resumen de cada llamada, que el backend genera con la API de Gemini a partir de la transcripción guardada (la clave solo existe en el entorno del backend). Los subtítulos usan la Web Speech API del navegador. Detalle, casos reales y límites en [docs/uso-de-ia.md](docs/uso-de-ia.md).

---

# Detalles de operación

## Moderar el ingreso

El administrador entra con su cuenta y abre **Administrar ingresos** desde la sala. Puede activar o desactivar la espera y bloquear nuevos ingresos. La espera empieza desactivada; el anfitrión no necesita admitirse a sí mismo. Los nombres visibles nunca conceden permisos de administrador.

Con la espera activa, cada ingreso crea una solicitud propia, incluso si varias personas usan el mismo nombre. El administrador ve su nombre, si tiene cuenta y cuándo lo solicitó, y puede admitirla o rechazarla. La pantalla se actualiza automáticamente; el invitado consulta el resultado cada cinco segundos y puede cancelar. Un rechazo requiere una nueva acción de la persona para volver a solicitar acceso.

La credencial de espera se limita a consultar o cancelar esa solicitud; no sirve para chat, llamadas ni acciones de cuenta. Se conserva en sessionStorage para recuperar la espera al recargar, y vence a las 24 horas. La configuración y las decisiones se guardan en PostgreSQL y sobreviven a un reinicio. La admisión usa el ID de la solicitud como identidad estable; volver a consultar el resultado no crea otra participación.

Desactivar la espera admite las solicitudes pendientes cuando los ingresos están desbloqueados; no cambia rechazos o cancelaciones anteriores. Bloquear impide nuevas solicitudes y admisiones, sin retirar a quienes ya fueron admitidos. Si se desactiva la espera mientras está bloqueada, las solicitudes continúan pendientes hasta desbloquear. La capacidad de seis conexiones de LiveKit continúa separada del cupo de admisión al chat, que está pendiente.

Aplicar la migración versionada con `pnpm db:migrate` antes de desplegar este cambio. Las rutas de admisión están en [docs/arquitectura.md](docs/arquitectura.md#4-api-rest-y-socketio).

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

Los códigos nuevos de las salas usan aleatoriedad criptográfica. Cualquier persona que posea el enlace puede solicitar acceso. Con la espera desactivada ingresa directamente; con la espera activa debe ser admitida antes de leer el chat. Tratar el enlace como privado. El proyecto todavía no implementa expulsión ni revocación completa de invitaciones. Las sesiones de cuenta se guardan en `localStorage`, por lo que una inyección de scripts en el navegador podría exponerlas; se debe revisar esa decisión antes de usar la aplicación con datos reales (alternativa y tradeoff en [docs/justificacion.md](docs/justificacion.md)).

La auditoría de dependencias realizada el 27 de octubre de 2026 terminó sin vulnerabilidades conocidas en `pnpm audit` después de actualizar Next.js, body-parser, multer y herramientas de desarrollo. El resultado depende de la base de avisos en ese momento y no reemplaza una auditoría o prueba de penetración. También se revisaron los archivos versionables y las referencias Git locales buscando patrones habituales de claves, sin hallar coincidencias; esa búsqueda no garantiza detectar todos los formatos de secretos.

Los cambios de LiveKit y seguridad deben revisarse en el PR antes de desplegarlos. La plantilla prepara medidas para EC2, pero una validación local no comprueba el despliegue real, sus reglas efectivas de red ni permisos en AWS. Verificar el commit y la configuración al crear la instancia y revisar el consumo en AWS Settings > Billing.

## Pendientes

La entrega académica usa seis participantes por llamada. Siguen pendientes expulsión, cupo del chat, cierre de salas de la aplicación, vencimiento del chat, adjuntos, stickers, grabación local y fondos, según los requisitos.

## Documentación

- [docs/arquitectura.md](docs/arquitectura.md): diagramas, flujo de una petición, modelo de datos y endpoints.
- [docs/justificacion.md](docs/justificacion.md): por qué cada tecnología, alternativas y tradeoffs.
- [docs/uso-de-ia.md](docs/uso-de-ia.md): uso de IA en el desarrollo y en el producto.
- [docs/decisiones-tecnicas.md](docs/decisiones-tecnicas.md): registro cronológico de decisiones.
- [docs/requirements.md](docs/requirements.md): definición del producto.
- [deploy/ec2/README.md](deploy/ec2/README.md): despliegue en AWS EC2.
