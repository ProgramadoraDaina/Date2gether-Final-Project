# Diseño: Línea de tiempo de participación en llamadas

## Enfoque técnico

Dos piezas acopladas sobre una única fuente de verdad asíncrona (los webhooks de LiveKit) y una única fuente de verdad síncrona (el estado en vivo de LiveKit):

1. **Ingesta**: `CallsWebhookController` verifica HMAC, persiste cada evento en un log append-only deduplicado por el `id` del evento, y recién después ejecuta efectos secundarios. El insert deduplicado es el **único punto de idempotencia** del que cuelga todo lo demás.
2. **Gate de anfitrión**: `CallsService.join()` consulta el estado en vivo de LiveKit para decidir si hay un `administrador` conectado; el handler de `participant_left` hace el camino inverso y fuerza el cierre cuando se va el último.
3. **Materialización**: `room_finished` dispara una agregación única del log crudo hacia un resumen por participante, que es lo que lee la página nueva.

El cierre forzado es lo que garantiza que `room_finished` llegue, y `room_finished` es lo que garantiza que la línea de tiempo exista. No son dos features: es un ciclo.

---

## Decisiones de arquitectura

### D1 — "Quién está conectado ahora mismo" = consulta en vivo a LiveKit

| Opción | Tradeoff | Decisión |
|---|---|---|
| `RoomServiceClient.listParticipants(roomCode)` | Una llamada de red extra en una ruta síncrona; es la autoridad real sobre presencia de medios | **Elegida** |
| Estado derivado del log de eventos (`call_events`) | Cero latencia de red, pero **eventualmente consistente**: entre que un admin se conecta y llega su `participant_joined` hay una ventana de cientos de ms a segundos en la que el log diría "no hay admin" y rechazaríamos una unión legítima | Rechazada |

**Justificación**: la presencia de medios es un hecho que vive en LiveKit; nuestro log es una proyección rezagada de ese hecho. Usar la proyección para una decisión de admisión en tiempo real introduce falsos negativos justo en el caso más común (el admin acaba de entrar y los demás entran detrás). Además `join()` ya instancia un `RoomServiceClient` y ya depende de que LiveKit responda (`createRoom()`): el costo marginal es una sola llamada más sobre una dependencia que ya es bloqueante.

**Resolución de rol a partir de identities**: `listParticipants()` devuelve `ParticipantInfo[]` con `identity`. Se cruzan esos identities contra `call_participant_identities` filtrando por `roomId`, y se considera admin a quien tenga `roleAtIssue = 'administrador'`. Una sola consulta con `inArray`.

Se usa el **snapshot de rol al emitir el token** (`roleAtIssue`), no una re-consulta a `roomMembers`, porque promover/transferir rol durante la llamada está explícitamente fuera de alcance. Esto además hace el camino del webhook independiente de `roomMembers`.

### D2 — Si LiveKit no responde: se rechaza (fail-closed), con 503 y no con 403

| Opción | Tradeoff | Decisión |
|---|---|---|
| Fail-closed con `ServiceUnavailableException` | El usuario no entra, pero recibe un error honesto y reintentable | **Elegida** |
| Fail-open (permitir la unión) | Anula la regla de negocio exactamente cuando el sistema está degradado, y puede abrir una llamada sin anfitrión que después nadie puede cerrar | Rechazada |
| Fail-closed con `ForbiddenException` | Le miente al usuario: le dice "no hay anfitrión" cuando el problema es nuestro | Rechazada |

**Justificación**: el código de estado importa tanto como la decisión. 503 le dice al cliente "reintentá"; 403 le dice "esperá a que entre un anfitrión". Confundirlos produce el peor síntoma posible de esta feature: usuarios esperando a un anfitrión que ya está conectado.

**Nota de alcance**: este camino nuevo de falla es estrecho. `createRoom()` ya corre antes y ya lanza 503 si LiveKit está caído (comportamiento actual, sin cambios). El único caso nuevo es que `listParticipants` falle de forma transitoria después de un `createRoom` exitoso.

**El admin nunca pasa por acá**: la resolución de rol del solicitante es una consulta local a `roomMembers`. Si es `administrador`, se cortocircuita **antes** de llamar a `listParticipants`. Así un admin siempre puede iniciar una llamada vacía incluso con LiveKit inestable, que es la excepción que la propuesta exige.

### D3 — Ventana de gracia de 15 segundos, implementada como re-chequeo diferido

**Valor: 15 s.** No es un `sleep` antes de `deleteRoom`: es una re-verificación agendada.

Al recibir `participant_left` de un identity con `roleAtIssue = 'administrador'`, si `listParticipants` no muestra ningún otro admin conectado, se agenda un re-chequeo a T+15 s. Al dispararse, se vuelve a consultar `listParticipants`: si hay un admin conectado (el mismo o **otro**), se cancela; si no, se fuerza el cierre.

**Por qué re-chequeo y no espera ciega**: un admin que se reconecta vuelve con un `identity` **nuevo y distinto** (`RoomAccessService.create()` genera `sub = randomUUID()` en cada acceso). No se puede "esperar a que vuelva el mismo": la única pregunta contestable es "¿hay algún admin conectado ahora?".

**Por qué 15 s**:

| Cota | Valor | Razón |
|---|---|---|
| Piso | ~8 s | Un refresh de página real implica `requestRoomAccess` → `POST /calls/:code` → conexión WebRTC: 3-8 s en una conexión normal |
| Techo | < 30 s (`departureTimeout`) | Si el admin era el último humano, LiveKit reaparea la sala sola a los 30 s; decidir antes de ese plazo evita competir con el teardown propio de LiveKit (si igual compite, D4 lo tolera) |
| Elegido | **15 s** | Cubre el piso con margen sin dejar a los demás participantes 30 s en una llamada ya muerta |

`emptyTimeout: 300` no entra en juego: aplica a salas creadas y nunca ocupadas, no a una sala que se vacía.

Durante la ventana **no se avisa nada** a los participantes restantes (aviso previo y cuenta regresiva están fuera de alcance) y la llamada sigue funcionando normalmente.

**Implementación**: `Map<roomSid, NodeJS.Timeout>` en memoria del proceso (la API es una instancia única, self-hosted — `docs/decisiones-tecnicas.md` §12). El timer se cancela al llegar `room_finished` de ese sid.

**Riesgo residual aceptado**: si la API se reinicia durante la ventana, el timer se pierde. Mitigación auto-sanadora: el invariante de presencia de admin se re-evalúa en **cada** `participant_joined` y `participant_left` de la sesión, no solo en el del admin. Cualquier evento posterior re-arma el chequeo. Si no llega ningún evento más, la sala queda viva sin admin hasta que se vacíe — se documenta como limitación conocida, no se agrega un scheduler (fuera de alcance).

### D4 — Idempotencia del cierre forzado: tres capas

```
capa 1  single-flight en proceso    → evita agendar dos timers para el mismo sid
capa 2  compare-and-set en Postgres → sólo un handler gana el derecho a cerrar
capa 3  invocación tolerante        → cerrar una sala inexistente no es un error
```

1. **Single-flight**: `if (pendingCloses.has(sid)) return;` antes de agendar. Dos `participant_left` de dos admins distintos llegando casi simultáneos producen **un** timer, no dos.

2. **Compare-and-set persistido** (la capa que realmente garantiza la exclusión, incluso entre procesos o reinicios):

   ```sql
   UPDATE call_sessions
      SET forced_close_at = now(), close_reason = 'last_admin_left'
    WHERE livekit_room_sid = $1 AND forced_close_at IS NULL
   RETURNING id;
   ```

   Si devuelve 0 filas, otro handler ya reclamó el cierre → se retorna sin llamar a `deleteRoom`. Un `UPDATE ... WHERE ... IS NULL` es atómico en Postgres, así que no hace falta lock explícito ni transacción serializable.

3. **Invocación tolerante**: `deleteRoom(roomCode)` va envuelto en `try/catch`. Si la sala ya no existe (LiveKit la reapareó por `departureTimeout`, o un cierre anterior ya corrió), LiveKit responde con error. Ese error se registra con nivel `log` y mensaje propio — `'La sala de medios ya estaba cerrada'` — **nunca con nivel `error` y nunca incluyendo la respuesta externa** (convención vigente en `calls.service.ts`: las respuestas de LiveKit pueden traer credenciales o URLs internas). No se re-lanza.

**Justificación de las tres capas juntas**: la capa 1 es gratis y filtra el 99% de las carreras reales; la capa 2 es la que hace la garantía verdadera y sobrevive a reinicios; la capa 3 reconoce que el cierre es una acción de *convergencia best-effort* — el registro autoritativo del fin de sesión es `room_finished`, que LiveKit emite igual. Fallar el cierre no corrompe nada; registrarlo como error sí contaminaría los logs de producción con ruido esperable.

**Regla transversal**: el webhook responde **200 siempre** que la firma sea válida y el evento se haya persistido, incluso si el cierre o la materialización fallan. Lo contrario haría que LiveKit reintente y re-ejecute efectos secundarios.

### D5 — Comunicación al cliente: `DisconnectReason.ROOM_DELETED`, sin canal nuevo

| Opción | Tradeoff | Decisión |
|---|---|---|
| `DisconnectReason.ROOM_DELETED` en `onDisconnected` | Cero infraestructura nueva; es el protocolo diciendo exactamente lo que pasó | **Elegida** |
| Mensaje por data channel antes del `deleteRoom` | Carrera inherente: el mensaje puede no llegar antes de que se cierre el socket; requiere un publicador del lado servidor | Rechazada |
| Notificación por Socket.io (gateway de chat) | Mezcla el ciclo de vida de la llamada con el del chat, justo cuando el diseño insiste en que son independientes | Rechazada |

**Verificado en `@livekit/protocol`**: `DisconnectReason.ROOM_DELETED = 5` con el comentario *"RoomService.DeleteRoom was called"*. `ROOM_CLOSED = 10` cubre el caso en que LiveKit cierra la sala por su cuenta. `MeetingRoom.tsx` ya recibe ese `reason` en `onDisconnected`, pero hoy lo colapsa en el mensaje genérico `'No se pudo conectar a la llamada. La sala puede estar llena o sin conexión.'` — exactamente el síntoma que la propuesta marcó como riesgo ("cierre forzado percibido como caída del sistema").

**Diseño del ruteo de estados** en `MeetingRoom.tsx`:

```
onDisconnected(reason)
  ├─ undefined | CLIENT_INITIATED        → call.leaveCall()   + router.push('/')   [ya existe]
  ├─ ROOM_DELETED | ROOM_CLOSED          → call.endedByHost()                      [nuevo]
  └─ cualquier otro                      → call.failed(...)                        [ya existe]
```

`useCallSession` gana un estado terminal propio en lugar de reusar `failed()`: `status: 'ended'` + `endReason: 'host-left' | null` + la acción `endedByHost()`. La UI resultante muestra *"La llamada terminó porque el anfitrión se desconectó."*, un link **"Ver línea de tiempo"** y **"Volver a la sala"** — este último refuerza en la interfaz el límite de alcance: la sala y su chat siguen vivos.

**Rechazo en el gate (403)**: la excepción lleva un `code: 'NO_HOST_CONNECTED'` estable además del mensaje en español. El cliente mapea el código a su cadena traducida ("Esperá a que se conecte un anfitrión para unirte a la llamada.") con un botón "Reintentar", y cae al `message` crudo si el código no viene. Se mapea por código y no por texto para no acoplar el cliente a la redacción del servidor.

### D6 — `rawBody: true` global, más `useBodyParser` para el content-type de LiveKit

| Opción | Tradeoff | Decisión |
|---|---|---|
| `NestFactory.create(AppModule, { rawBody: true })` global | Un `Buffer` duplicado por request (acotado por el límite de tamaño de body ya vigente) | **Elegida** |
| Middleware de raw-body acotado por ruta | Exige `bodyParser: false` o ordenar middleware antes del parser de Nest: estrictamente más invasivo y con más superficie para romper rutas JSON existentes | Rechazada |

**Justificación**: `rawBody: true` es **aditivo**, no sustitutivo. Nest sigue parseando JSON como siempre y solo *además* retiene el buffer crudo vía el hook `verify` del body-parser. Ninguna ruta existente cambia de comportamiento. El rollback es una línea.

**Gotcha no obvio que este diseño resuelve**: LiveKit postea con `Content-Type: application/webhook+json`. El parser JSON de Express por defecto solo atiende `application/json`, así que `req.rawBody` llegaría **vacío** y la verificación HMAC fallaría siempre. Solución verificada en `@nestjs/platform-express@12` (`useBodyParser` documenta *"Will respect the application's rawBody option"*):

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
app.useBodyParser('json', { type: ['application/json', 'application/webhook+json'] });
```

Esto es lo primero que debe cubrir un test en la fase de apply: un POST con `application/webhook+json` que llegue con `rawBody` no vacío.

### D7 — Diseño físico del log crudo (retención indefinida ya cerrada como decisión de producto)

| Aspecto | Diseño | Razón |
|---|---|---|
| PK | `id uuid` = el `id` del evento de LiveKit | Clave natural: la deduplicación sale gratis con `ON CONFLICT (id) DO NOTHING`, sin índice único adicional |
| Índice 1 | `(livekit_room_sid, occurred_at)` | Es el acceso de la materialización y de la auditoría por sesión |
| Índice 2 | `(livekit_identity)` | Depuración por participante |
| Sin índice | `event_type` | Cardinalidad baja; dentro de una sesión ya acotada por el índice 1 no aporta |
| Mutabilidad | Sin `UPDATE`, sin `DELETE`, sin FK | El log debe sobrevivir al borrado de salas y usuarios para cumplir la retención indefinida; la resolución a `rooms`/`users` es un join lógico al leer |
| Particionamiento | **No, por ahora** | ~19 eventos por sesión de 6 personas; a 100 sesiones/día son ~700k filas/año — trivial para Postgres con los índices de arriba. Declarar una tabla particionada obligaría a SQL crudo fuera del schema builder de Drizzle sin beneficio |
| Disparador para revisarlo | >50M filas, o si el scan de materialización supera ~100 ms | La salida es particionado `RANGE` mensual por `occurred_at`, compatible con el diseño append-only de filas inmutables que ya se eligió |

`payload jsonb` guarda el evento verificado completo. Eso es lo que hace posible re-materializar una sesión cuyo `room_finished` llegó tarde o nunca.

### D8 — Desvío declarado: 4 tablas nuevas, no 3

La propuesta dice "3 tablas nuevas" en *Áreas afectadas*, texto escrito **antes** de que se amplificara con la regla de anfitrión. Resolver la pregunta abierta 3 (idempotencia del cierre) exige un destino persistido para el compare-and-set, y eso es una **cabecera de sesión**: `call_sessions`.

| Alternativa | Por qué se rechazó |
|---|---|
| Colgar `forced_close_at` del log de eventos | El log debe quedar append-only e inmutable; un `UPDATE` ahí rompe la propiedad que sostiene toda la idempotencia |
| Colgarlo del resumen por participante | Cardinalidad equivocada: el cierre es por sesión, no por participante |
| Lock de asesoría (`pg_advisory_xact_lock(hashtext(sid))`) | No persiste la decisión entre reinicios de proceso, y deja el header de sesión derivándose del log en cada lectura: exactamente lo que el diseño materializado busca evitar |

La cabecera de sesión también resuelve otras dos necesidades reales: el id público y estable de la URL de la línea de tiempo, y `materialized_at` como guard de idempotencia ante reentregas de `room_finished`. Es una tabla barata que mantiene el log crudo intacto.

---

## Modelo de datos

Las cuatro tablas son **aditivas**. `callHistory`, `rooms`, `roomMembers` y `roomRoleEnum` no se tocan: ni columnas, ni semántica, ni el insert condicionado a `participant.userId` de `join()`. Se reusan los enums existentes `roomRoleEnum` y `nameColorEnum`; no se crea ningún enum nuevo.

### 1. `call_participant_identities` — correlación identity ↔ usuario/invitado

Escrita en `CallsService.join()`, el único lugar que tiene juntos `participant.sub`, `participant.userId`, `participant.name` y `room.id`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk defaultRandom` | |
| `livekit_identity` | `varchar(64) not null` | `participant.sub` — **unique** |
| `room_id` | `uuid not null → rooms(id) on delete cascade` | |
| `user_id` | `uuid → users(id) on delete set null` | `null` para invitados |
| `display_name` | `varchar(60) not null` | `participant.name`; único dato legible de un invitado |
| `role_at_issue` | `roomRoleEnum` | Snapshot del rol al emitir el token; `null` para invitados |
| `issued_at` | `timestamp not null defaultNow` | |

Índices: `unique(livekit_identity)`, `(room_id, user_id)`.

**Subtlety verificada**: el JWT de acceso a sala vive 24 h y `participant.sub` es fijo dentro de él, así que `POST /calls/:roomCode` puede reenviarse con el **mismo** identity (reintento del usuario, re-montaje del componente). El insert es por eso un upsert:

```ts
.onConflictDoUpdate({ target: callParticipantIdentities.livekitIdentity,
                      set: { roleAtIssue, issuedAt: new Date() } })
```

El upsert corre **antes** de emitir el token, para que la correlación exista con certeza cuando llegue cualquier webhook de ese identity.

### 2. `call_events` — log append-only

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | El `id` del evento de LiveKit (no generado por nosotros) |
| `livekit_room_sid` | `varchar(64) not null` | Unidad de sesión |
| `room_code` | `varchar(20) not null` | `room.name`; sin FK a propósito (ver D7) |
| `event_type` | `varchar(40) not null` | |
| `livekit_identity` | `varchar(64)` | `null` en `room_started` / `room_finished` |
| `track_source` | `varchar(24)` | `null` salvo eventos `track_*` |
| `occurred_at` | `timestamp not null` | `event.createdAt` (epoch en segundos → `Date`) |
| `payload` | `jsonb not null` | Evento verificado completo |
| `received_at` | `timestamp not null defaultNow` | Separado de `occurred_at`: los webhooks llegan desordenados |

Índices: `(livekit_room_sid, occurred_at)`, `(livekit_identity)`.

### 3. `call_sessions` — cabecera de sesión y estado de cierre

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk defaultRandom` | Id público de la URL de la línea de tiempo |
| `livekit_room_sid` | `varchar(64) not null unique` | Clave natural |
| `room_id` | `uuid → rooms(id) on delete set null` | |
| `room_code` | `varchar(20) not null` | |
| `started_at` | `timestamp not null` | |
| `ended_at` | `timestamp` | De `room_finished` |
| `close_reason` | `varchar(32)` | `'last_admin_left' \| 'livekit'` |
| `forced_close_at` | `timestamp` | Objetivo del compare-and-set de D4 |
| `materialized_at` | `timestamp` | Guard de idempotencia de la materialización |

Índices: `unique(livekit_room_sid)`, `(room_id, started_at desc)`.

Se crea en `room_started` con `ON CONFLICT (livekit_room_sid) DO NOTHING`. Como los webhooks pueden llegar desordenados, los handlers de `participant_*` usan el **mismo upsert** (creación perezosa con `started_at` = hora del evento) antes de operar.

### 4. `call_session_participants` — resumen materializado

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk defaultRandom` | |
| `session_id` | `uuid not null → call_sessions(id) on delete cascade` | |
| `participant_key` | `varchar(80) not null` | `user_id`, o `'guest:' + lower(display_name)` |
| `user_id` | `uuid → users(id) on delete set null` | |
| `display_name` | `varchar(60) not null` | |
| `is_guest` | `boolean not null default false` | |
| `first_joined_at` | `timestamp not null` | |
| `last_left_at` | `timestamp` | |
| `total_seconds` | `integer not null default 0` | |
| `spoke` | `boolean not null default false` | Micrófono publicado alguna vez |
| `screen_shared` | `boolean not null default false` | |
| `rejoin_count` | `smallint not null default 0` | |
| `name_color` | `nameColorEnum` | Reusa la paleta existente |

Índices: `unique(session_id, participant_key)`, `(session_id)`.

`participant_key` es la pieza que resuelve el riesgo *"identity inestable entre reconexiones"* declarado en la propuesta: varias identities aleatorias de la misma persona colapsan en una sola fila, con un constraint único limpio en lugar de un índice parcial.

---

## Flujo 1 — `join()` con gate de anfitrión

```
Cliente            CallsService.join()                    Postgres            LiveKit
  │                       │                                   │                  │
  ├─ POST /calls/:code ──►│                                   │                  │
  │                       ├─ roomCode / isActive / config ────┤  [ya existe]     │
  │                       ├─ rol del solicitante ────────────►│                  │
  │                       │   roomMembers(room.id, userId)    │                  │
  │                       │◄── role | undefined (invitado) ───┤                  │
  │                       ├─ createRoom() (idempotente) ─────────────────────────►│
  │                       │                        fallo ──► 503 [ya existe]     │
  │                       │                                   │                  │
  │          ┌────────────┴─ role === 'administrador' ? ───────────────┐          │
  │          │ SÍ: cortocircuito, nunca consulta presencia            │          │
  │          │ NO:                                                     │          │
  │          │   ├─ listParticipants(roomCode) ───────────────────────────────────►│
  │          │   │      error ──► 503 'No se pudo verificar...'        │          │
  │          │   ├─ identities conectados ──► call_participant_identities          │
  │          │   │      ¿alguno con role_at_issue = 'administrador'?   │          │
  │          │   └─ ninguno ──► 403 code: NO_HOST_CONNECTED            │          │
  │          └────────────┬───────────────────────────────────────────┘          │
  │                       ├─ upsert correlación identity ────►│                  │
  │                       ├─ AccessToken + callHistory ───────┤  [ya existe]     │
  │◄── url, token ────────┤                                   │                  │
```

El orden importa: `createRoom()` va **antes** de `listParticipants()` para que la sala exista con certeza y una lista vacía signifique sin ambigüedad "nadie conectado" en lugar de "la sala no existe".

**Costo aceptado**: un no-admin rechazado puede haber creado una sala de LiveKit vacía que vive hasta `emptyTimeout` (300 s) y genera un par `room_started`/`room_finished` sin participantes. Mitigación: la materialización tolera sesiones de cero participantes (resumen vacío) y el listado de sesiones filtra las que no tienen filas de participante.

## Flujo 2 — Salida del último admin → cierre → materialización

```
LiveKit          CallsWebhookController      CloseService        Postgres         LiveKit
   │                     │                        │                 │               │
   ├─ POST participant_left (Authorize: HMAC) ────┤                 │               │
   │                     ├─ WebhookReceiver.receive(rawBody, hdr)   │               │
   │                     │     firma inválida ──► 401               │               │
   │                     ├─ upsert call_sessions (perezoso) ───────►│               │
   │                     ├─ insert call_events ON CONFLICT(id) ────►│               │
   │                     │     0 filas (duplicado) ──► 200, sin efectos secundarios │
   │                     ├─ identity es admin? ────────────────────►│               │
   │                     ├────────────────────────►│                 │               │
   │                     │                        ├─ listParticipants ─────────────►│
   │                     │                        ├─ ¿queda otro admin? SÍ ─► fin   │
   │                     │                        ├─ NO ─► agendar T+15 s (single-flight)
   │◄── 200 ─────────────┤                        │                 │               │
   ·                                              ·                 ·               ·
   ·                                    T+15 s    ├─ listParticipants ─────────────►│
   ·                                              ├─ admin presente ─► cancelar     │
   ·                                              ├─ UPDATE ... forced_close_at     │
   ·                                              │   IS NULL RETURNING id ────────►│
   ·                                              │   0 filas ─► ya reclamado, fin  │
   ·                                              ├─ deleteRoom(roomCode) ─────────►│
   ·                                              │   error ─► log nivel `log`, no rethrow
   │                                              │                 │               │
   ├─ POST room_finished ─────────────────────────┤                 │               │
   │                     ├─ insert call_events ───────────────────►│               │
   │                     ├─ cancelar timer pendiente del sid        │               │
   │                     ├─ UPDATE call_sessions SET ended_at, materialized_at=now()│
   │                     │     WHERE sid=$1 AND materialized_at IS NULL RETURNING id│
   │                     │     0 filas ──► ya materializada, 200    │               │
   │                     ├─ agregar call_events del sid ───────────►│               │
   │                     ├─ insert call_session_participants (misma transacción)    │
   │◄── 200 ─────────────┤                                          │               │
```

**Agregación** (`aggregateSession(events, identities, fallbackEndAt)`, función pura y testeable por separado): eventos del sid ordenados por `occurred_at`; se resuelve cada identity a `participant_key`/`display_name` vía la tabla de correlación; se pliega por `participant_key`:

- Se emparejan `participant_joined` ↔ `participant_left`. Un join sin leave se cierra con `fallbackEndAt` (la hora de `room_finished`) — esto cubre el riesgo "navegador colgado, sin `track_unpublished`".
- `total_seconds` = suma de los intervalos emparejados; `first_joined_at` = el primero; `last_left_at` = el último.
- `rejoin_count` = cantidad de pares − 1 (nunca negativo).
- `spoke` = existe algún `track_published` con `source = MICROPHONE`.
- `screen_shared` = existe algún `track_published` con `source = SCREEN_SHARE`.

Que la agregación sea una función pura es lo que habilita la **re-materialización** si `room_finished` nunca llega: basta limpiar `materialized_at` y volver a correrla sobre el log crudo. No se agrega un job programado en este cambio (fuera de alcance); queda documentado como seguimiento.

---

## `CallsWebhookController`

| Aspecto | Diseño |
|---|---|
| Ruta | `POST /calls/livekit/webhook`, en `@Controller('calls/livekit')` |
| Guards | **Ninguno**, ni de clase ni de método. Clase separada de `CallsController` (que tiene `@UseGuards(RoomAccessGuard)` a nivel de clase) — una clase distinta no hereda ese guard |
| Throttling | `@SkipThrottle()`. `HttpOnlyThrottlerGuard` es global (60 req/min/IP) y LiveKit pega desde una sola IP; cerrar una sala de 6 personas puede generar ~19 eventos seguidos |
| Autenticación | HMAC: `WebhookReceiver.receive(req.rawBody.toString('utf8'), req.headers.authorize)`. Excepción → `UnauthorizedException` (401), log sin cuerpo ni header |
| Body | `@Req()` **únicamente**, sin DTO en `@Body()`. El `ValidationPipe` global usa `forbidNonWhitelisted: true` y rechazaría el payload de LiveKit; leer de `@Req()` lo evita por completo |
| `rawBody` ausente/vacío | `BadRequestException` (400) |
| Código de éxito | `@HttpCode(200)` siempre que la firma sea válida y el evento quede persistido, incluso si un efecto secundario falla |
| Eventos manejados | `room_started`, `room_finished`, `participant_joined`, `participant_left`, `track_published`, `track_unpublished`. Cualquier otro tipo (p. ej. `participant_connection_aborted`) se **persiste igual** y no dispara efectos — el log es completo por diseño de auditoría |

Providers nuevos en `CallsModule` (import de `ConfigModule`, `JwtAuthModule`, `RoomsModule` sin cambios):

- `CallsWebhookService` — verificación, persistencia, despacho.
- `CallSessionCloseService` — presencia de admin, ventana de gracia, cierre idempotente. Separado porque `CallsService.join()` también necesita la resolución de presencia de admin y no debe depender del servicio de webhooks.
- `CallTimelineService` — agregación y lectura.

## Lectura y autorización

| Endpoint | Guard | Respuesta |
|---|---|---|
| `GET /calls/sessions` | `JwtAuthGuard` | Sesiones en las que participó el solicitante: `{ id, roomCode, roomName, startedAt, endedAt, participantCount }` |
| `GET /calls/sessions/:sessionId/timeline` | `JwtAuthGuard` | Cabecera de sesión + todas las filas de `call_session_participants` |

Autorización de la línea de tiempo: el `userId` del solicitante debe aparecer en `call_session_participants` de esa sesión. Si no, **404 y no 403**, para no filtrar la existencia de sesiones ajenas.

`GET /calls/history` queda **intacto** (criterio de éxito: la semántica de `callHistory` no cambia). Se agrega `GET /calls/sessions` en lugar de enriquecer el historial: las filas de `callHistory` no tienen `room.sid` y sus timestamps no se corresponden 1 a 1 con sesiones de LiveKit, así que atarles un link de sesión sería adivinar.

Los invitados **aparecen** en la línea de tiempo pero no pueden **leerla**: no tienen cuenta ni JWT, y el punto de entrada es Historial, que ya exige `isLoggedIn()`. Es coherente con lo que cerró la propuesta.

## Cliente

| Pieza | Ruta | Descripción |
|---|---|---|
| Página | `client/src/app/history/[sessionId]/page.tsx` | Ruta propia y compartible, anidada bajo Historial. Reusa `AppShell`, `isLoggedIn()` y `useTranslation` |
| Enlace | `client/src/app/history/page.tsx` | Sección nueva "Sesiones de llamada" desde `GET /calls/sessions`; cada fila con link "Ver línea de tiempo" a `/history/{sessionId}`. La lista actual de `callHistory` queda tal cual |
| Timeline | `client/src/features/calls/ParticipationTimeline.tsx` | Lista por participante: avatar, nombre, entrada, salida, duración, chips de "habló" y "compartió pantalla" |
| Avatar | `client/src/features/calls/InitialsAvatar.tsx` | Nombre → hasta 2 iniciales (primeras letras de las dos primeras palabras, en mayúscula, seguro para Unicode vía `Array.from`); color = índice determinístico sobre `NAME_COLOR_IDS` a partir de un hash de 32 bits del nombre, o el `nameColor` del servidor si existe. Función pura, spec colocado |
| Estado terminal | `client/src/features/calls/useCallSession.ts` + `MeetingRoom.tsx` | `status: 'ended'`, `endReason: 'host-left'`, acción `endedByHost()` (ver D5) |

## Cambios de archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `src/main.ts` | Modificar | `NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })` + `useBodyParser('json', { type: [...] })` |
| `src/db/schema.ts` | Modificar | 4 tablas nuevas + relaciones + tipos inferidos; nada existente se toca |
| `drizzle/0012_call_participation_timeline.sql` | Crear | Migración generada con `pnpm drizzle-kit generate` |
| `src/modules/calls/calls-webhook.controller.ts` | Crear | Endpoint sin guards, verificación HMAC |
| `src/modules/calls/calls-webhook.service.ts` | Crear | Persistencia deduplicada + despacho por tipo de evento |
| `src/modules/calls/call-session-close.service.ts` | Crear | Presencia de admin, ventana de gracia, cierre idempotente |
| `src/modules/calls/call-timeline.service.ts` | Crear | Agregación pura + lectura autorizada |
| `src/modules/calls/call-timeline.controller.ts` | Crear | `GET /calls/sessions`, `GET /calls/sessions/:id/timeline` |
| `src/modules/calls/calls.service.ts` | Modificar | Gate de admin + upsert de correlación en `join()` |
| `src/modules/calls/calls.module.ts` | Modificar | Registrar controllers y providers nuevos |
| `client/src/app/history/[sessionId]/page.tsx` | Crear | Página de línea de tiempo |
| `client/src/features/calls/ParticipationTimeline.tsx` | Crear | Lista de participación |
| `client/src/features/calls/InitialsAvatar.tsx` | Crear | Avatar de iniciales |
| `client/src/features/calls/useCallSession.ts` | Modificar | Estado terminal `ended` + `endedByHost()` |
| `client/src/features/calls/MeetingRoom.tsx` | Modificar | Ruteo de `ROOM_DELETED`/`ROOM_CLOSED` + panel terminal |
| `client/src/app/history/page.tsx` | Modificar | Sección de sesiones con el link |
| `client/src/lib/api.ts`, `client/src/lib/calls.ts` | Modificar | Clientes nuevos + manejo del código `NO_HOST_CONNECTED` |
| `livekit.yaml` (deploy) | Modificar | `webhook.urls` apuntando al endpoint, con la API key existente |

## Estrategia de pruebas

TDD estricto está activo (`strict_tdd: true`): spec colocado por archivo fuente, antes del código.

| Capa | Qué probar | Cómo |
|---|---|---|
| Unit (servidor) | `aggregateSession()`: pares join/leave, leave faltante con fallback, `rejoin_count`, `spoke`, `screen_shared`, sesión vacía | Función pura con arrays de eventos armados a mano — sin DB, sin LiveKit |
| Unit (servidor) | Gate de `join()`: admin cortocircuita; no-admin con admin conectado pasa; no-admin sin admin → 403 `NO_HOST_CONNECTED`; `listParticipants` falla → 503; invitado nunca es admin | `RoomServiceClient` y `db` mockeados |
| Unit (servidor) | Idempotencia del cierre: dos `participant_left` casi simultáneos → un solo `deleteRoom`; compare-and-set devuelve 0 filas → sin `deleteRoom`; `deleteRoom` falla → sin throw y sin log de nivel `error` | Timers falsos de Jest para la ventana de 15 s |
| Unit (servidor) | Webhook: firma inválida → 401; `rawBody` faltante → 400; evento duplicado → 200 sin efectos secundarios; efecto secundario que falla → 200 igual | `WebhookReceiver` mockeado |
| Integración | `POST` con `application/webhook+json` llega con `rawBody` no vacío (valida D6); las rutas JSON existentes siguen funcionando con `rawBody: true` | Instancia de app Nest en test |
| Unit (cliente) | `InitialsAvatar`: iniciales de 1 / 2 / 3+ palabras, nombres Unicode, estabilidad del color | RTL + función pura |
| Unit (cliente) | `useCallSession`: `endedByHost()` produce `status: 'ended'` + `endReason: 'host-left'`; `MeetingRoom` rutea `ROOM_DELETED` a `endedByHost` y un reason de red a `failed` | RTL |
| E2E | Historial → línea de tiempo muestra participantes con duración; rechazo "no hay anfitrión conectado" con mensaje explícito | Playwright |

## Migración y despliegue

1. `pnpm drizzle-kit generate` → `drizzle/0012_call_participation_timeline.sql`. **Puramente aditiva**: `CREATE TABLE` × 4 + índices. Sin `ALTER` sobre tablas existentes, sin enums nuevos, sin backfill (no hay datos históricos de LiveKit que recuperar: las sesiones pasadas nunca emitieron webhooks).
2. Desplegar la API con `rawBody: true` **antes** de configurar `webhook.urls`. Durante esa ventana LiveKit no envía nada y el comportamiento es idéntico al actual.
3. **Precondición de datos bloqueante**: verificar que cada sala con llamadas tenga al menos un `roomMembers.role = 'administrador'`. Sin esto, el gate bloquea a todos los no-admin de esa sala. Debe ejecutarse una consulta de auditoría y corregir antes de habilitar el gate.
4. Configurar `webhook.urls` en `livekit.yaml` y reiniciar LiveKit. La ingesta empieza; sin el gate activo todavía nada se cierra a la fuerza.
5. Habilitar el gate de admin último, por ser el único cambio que puede impedir una unión que hoy funciona.

**Rollback** (según la propuesta, con los dos niveles ya separados):

- *Solo el gate*, sin migración: quitar el chequeo de rol en `join()` y la rama de cierre forzado del handler. La ingesta y la línea de tiempo siguen funcionando.
- *Todo*: desconfigurar `webhook.urls` (detiene la ingesta sin desplegar), revertir el commit, aplicar el `down` (drop de las 4 tablas), quitar `rawBody: true`. `callHistory` y el flujo de llamada actual quedan intactos.

## Preguntas abiertas

- [ ] **Precondición operativa**: ¿hay hoy salas en producción sin ningún `administrador`? Es un dato que hay que mirar antes de activar el gate (paso 3 de despliegue), no una decisión de diseño.
- [ ] La ventana de gracia es un `setTimeout` en proceso: si la API se reinicia justo dentro de esos 15 s y no llega ningún evento más de esa sesión, la sala queda viva sin admin. Mitigado por el re-chequeo en cada evento de participante; un job de reconciliación queda como seguimiento fuera de alcance.
- [ ] Sin job de re-materialización programado: si `room_finished` nunca llega, la línea de tiempo queda sin materializar hasta una re-ejecución manual. El log crudo preserva todo lo necesario para hacerlo.
