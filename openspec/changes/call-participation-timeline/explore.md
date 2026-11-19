# Exploración: call-participation-timeline

## 1. Mecánica de webhooks de LiveKit (`livekit-server-sdk@2.19.2`)

- `WebhookReceiver` (`livekit-server-sdk/dist/WebhookReceiver.d.ts`) expone un único método: `receive(body: string, authHeader?: string, skipAuth?: boolean, clockTolerance?)`. Necesita el **cuerpo crudo como string**, no un objeto parseado — la firma es un HMAC sobre los bytes exactos que envía LiveKit, verificado contra el header `Authorize` usando `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`.
- Forma del payload (`@livekit/protocol` → `WebhookEvent`):
  - `event: WebhookEventNames` — incluye `'room_started' | 'room_finished' | 'participant_joined' | 'participant_left' | 'participant_connection_aborted' | 'track_published' | 'track_unpublished' | ...`
  - `room?: Room` — `Room.sid` (único por **instancia** de sala, no por roomCode), `Room.name` (== nuestro `roomCode`), `creationTime`.
  - `participant?: ParticipantInfo` — presente en eventos `participant_*` y `track_*`: `identity`, `sid`, `name`, `joinedAt`/`joinedAtMs`, `disconnectReason`.
  - `track?: TrackInfo` — presente en eventos `track_*`: `sid`, `type` (`AUDIO`/`VIDEO`), `source: TrackSource` enum = `UNKNOWN | CAMERA | MICROPHONE | SCREEN_SHARE | SCREEN_SHARE_AUDIO`.
  - `id` (UUID único del evento) y `createdAt` (epoch en segundos) — útiles para idempotencia/deduplicación.
- **Señal de "habló" (micrófono abierto)**: `track_published` con `track.source === TrackSource.MICROPHONE` → micrófono abierto; `track_unpublished` con la misma fuente → micrófono cerrado. El payload no trae nivel de audio (confirma que el enfoque de proxy es lo único disponible vía webhooks, de cualquier forma).
- **Señal de pantalla compartida**: `track_published`/`track_unpublished` con `track.source === TrackSource.SCREEN_SHARE`.
- **Límite de la sesión de llamada**: `room.sid` cambia **cada vez que LiveKit crea una nueva instancia de sala** para un mismo `roomCode`. Como `CallsService.join()` llama a `client.createRoom()` de forma idempotente con `emptyTimeout: 300` y `departureTimeout: 30`, una sala se vacía, LiveKit la destruye después del timeout, y una unión posterior recrea la sala con un **`sid` nuevo**. Por eso el par `room_started`→`room_finished` para un `room.sid` dado es la unidad correcta de "sesión de llamada" — no `rooms.isActive` (una bandera de producto de "sala abierta/cerrada" que no tiene relación con el ciclo de vida de medios de LiveKit) ni solo `roomCode` (ambiguo entre recreaciones).

### Seguridad/transporte para la ruta del webhook (NestJS)
- `app.use(helmet(...))` y `app.enableCors(...)` son globales; no existe override global del body-parser en `src/main.ts` — el adaptador Express de Nest usa el parser JSON por defecto en todas las rutas.
- Para obtener los bytes crudos que necesita `WebhookReceiver.receive()`, el patrón estándar y aditivo en NestJS es `NestFactory.create(AppModule, { rawBody: true })`, que hace que Nest conserve el buffer crudo como `req.rawBody` junto al body parseado normal. Esto no afecta a las rutas JSON existentes.
- La ruta del webhook no debe tener guard de JWT (LiveKit no es un usuario logueado) — la autenticación es la firma del header `Authorize`. Esto es una forma genuinamente nueva en este código: todas las rutas protegidas actuales usan `JwtAuthGuard`/`RoomAccessGuard`; nada hace hoy verificación por HMAC de header. La ruta del webhook debería tener su **propio controller** (ej. `CallsWebhookController`), no compartir uno con `CallsController`/`CallHistoryController`, para que no se filtre ningún guard a nivel de clase.
- `AppModule` registra `HttpOnlyThrottlerGuard` globalmente (60 req/min por IP vía `APP_GUARD`). LiveKit (self-hosted en el mismo EC2 según `docs/decisiones-tecnicas.md` §12) va a pegarle desde una sola IP. El cierre de una sala con 6 participantes puede generar una ráfaga de hasta ~19 eventos en poco tiempo — dentro del presupuesto actual, pero vale la pena marcarlo como riesgo de escalado; `@SkipThrottle()` es la salida si hace falta.
- Hay que configurar LiveKit con una URL de webhook apuntando al nuevo endpoint (`livekit.yaml` `webhook.urls`, reusando la API key/secret existente) — esto es configuración de infra/deploy, a tratar en la fase de diseño.

## 2. Módulo de calls existente

- `calls.service.ts::join()` es el único lugar que hoy tiene, al mismo tiempo: `participant.sub` (identity de LiveKit), `participant.userId` (opcional), `participant.name`, y `room.id`. Inserta una fila de `callHistory` **solo si `participant.userId` está presente**, salteando invitados en silencio, y solo en `POST /calls/:roomCode`.
- Schema de `callHistory`: `id, roomId, userId (NOT NULL), startedAt`. Sin hora de salida, sin duración, sin columna de identity, `userId` obligatorio — no puede representar invitados, sin vínculo FK-able a un participante/instancia de sala de LiveKit. Es un registro de "esta cuenta llamó alguna vez a esta sala", no un registro de participación por sesión.
- `CallsModule` solo conecta `CallsController` + `CallHistoryController` + `CallsService`, importando `JwtAuthModule` y `RoomsModule`. Agregar un controller/service de webhook ahí es una extensión natural y de baja friction.
- Múltiples uniones/reconexiones de un mismo participante en una sesión: LiveKit envía un par distinto de `participant_joined`/`participant_left` por cada conexión física. Una reconexión por red inestable puede generar varios pares de join/leave para lo que un humano llamaría "la presencia de una persona". El modelo de datos necesita o bien (a) guardar cada par join/leave como filas separadas y agregar duración total + primer-join/último-leave al momento de leer, o bien (b) acumular en una fila resumen por participante-por-sesión.

## 3. Mapeo de identidad — hallazgo importante y no obvio

- `RoomAccessService.create()` setea `participant.sub = randomUUID()` **nuevo en cada llamada a este método**, no el `userId` real de la cuenta. `CallsService.join()` después usa `identity: participant.sub` al emitir el `AccessToken` de LiveKit. Entonces **el `identity` de LiveKit es un UUID aleatorio por sesión de acceso a sala — nunca es igual a nuestro `users.id`, y ni siquiera es estable entre uniones repetidas de la misma cuenta.**
- Confirmado en el cliente (`client/src/app/room/[code]/page.tsx`): `requestRoomAccess` se llama una vez, desde el submit manual del formulario de "unirse"; el `access` resultante (incluyendo `participant.sub`) se guarda solo en estado de React (no persiste en `localStorage`). **Consecuencia: cada acción de "unirse a la sala" desde una pestaña del navegador genera un identity de LiveKit nuevo y aleatorio.** Un refresh de página o una segunda unión de la misma cuenta produce un `identity` distinto al de su sesión anterior en la misma sala.
- Los eventos de webhook **no se pueden vincular a `users.id` solo por identity** — hoy no existe un mapeo estable. La correlación tiene que pasar en el momento en que se genera el identity: `CallsService.join()` es el único lugar que tiene juntos `participant.sub` + `participant.userId` + `participant.name` + `room.id`. **Este cambio tiene que persistir esa correlación** (identity → userId-o-nombre-de-invitado, roomId, al momento de emitir el token) para que el consumidor del webhook pueda resolver el `identity` a una fila legible por humanos después. Hoy el insert de `callHistory` está condicionado a que `participant.userId` esté presente — para que la línea de tiempo incluya invitados, esa condición tendría que relajarse para la nueva tabla de correlación específicamente, dejando intactas las semánticas actuales de `callHistory`. **La inclusión de invitados es una decisión de producto para `sdd-propose`**, no se decide acá — el pedido original dice "quiénes participaron" sin aclarar si los invitados entran o no.

## 4. Superficie del dashboard (cliente)

- No existe hoy ninguna página por sesión o por llamada; `client/src/app/history/page.tsx` es la única superficie relacionada con historial — una lista plana de filas de `callHistory` pasadas (`roomName`, `roomCode`, `startedAt`), protegida por `isLoggedIn()`, sin detalle por sesión y sin datos a nivel participante.
- `MeetingRoom.tsx` es la UI en vivo durante la llamada — no es candidata porque la decisión fue explícitamente post-llamada. El lugar natural es una carpeta hermana dentro de `client/src/features/calls/` (ej. `ParticipationTimeline`), renderizada desde una ruta nueva, a la que se llega o bien desde la lista de "historial" existente o con un link que aparece al cortar la llamada.
- No existe ningún componente de avatar hoy en `client/src` — es una pieza de UI nueva, chica y autocontenida (nombre → iniciales → color determinístico, posiblemente reusando la paleta `NAME_COLOR_IDS` ya definida en `src/db/schema.ts`).

## 5. Límite de sala/sesión

Respondido arriba en el punto 1: el límite correcto es el par `room_started` → `room_finished` indexado por `room.sid` (el id de instancia de sala propio de LiveKit), independiente de `rooms.isActive` (nuestra bandera de sala/conversación abierta-cerrada) e independiente de `roomCode` (reutilizable a lo largo de muchas instancias de sala de LiveKit). `room_finished` es el disparador autoritativo de "esta sesión terminó, cerrar la línea de tiempo ahora".

## 6. Comparación de modelos de datos

**Opción A — Log de eventos append-only + derivar al leer.** Una sola tabla (`callParticipantEvents`) con una fila por cada webhook relevante (joined/left/mic_on/mic_off/screen_share_on/screen_share_off), deduplicada por el `id` propio del evento de LiveKit. La línea de tiempo se calcula agregando por `(livekitRoomSid, livekitIdentity)` al leer.
- Ventajas: trivialmente idempotente, el handler del webhook es lo más simple posible, auditoría completa, fácil de extender.
- Desventajas: cada lectura hace una agregación no trivial; manejar "el micrófono nunca se cerró explícitamente porque el navegador se colgó" necesita un fallback a la hora de `room_finished`/`participant_left`; no hay una sola fila para construir una vista estilo `callHistory`.

**Opción B — Resumen desnormalizado por participante-sesión, actualizado a medida que llegan eventos.** Una tabla (`callSessionParticipants`) con `firstJoinedAt, lastLeftAt, totalDurationSeconds, spoke, screenShared, rejoinCount`, actualizada incrementalmente por cada webhook.
- Ventajas: lectura trivial (`SELECT ... WHERE roomId/livekitRoomSid`), sin lógica de agregación duplicada, calza natural con una UI de lista.
- Desventajas: el camino de escritura es con estado (buscar-o-insertar-o-actualizar), hay que manejar con cuidado entregas duplicadas o fuera de orden, sin rastro de auditoría por cada cambio de track.

**Recomendación**: un **híbrido con la Opción A como camino de escritura, y un resumen liviano materializado al finalizar (en `room_finished`)**:
- La entrega de webhooks es "al menos una vez" y puede llegar desordenada — un log append-only con constraint único sobre el `id` propio del evento de LiveKit es el único enfoque que hace que el handler del webhook sea trivialmente idempotente y a prueba de caídas, algo relevante dado el historial de este proyecto con conexiones LiveKit inestables para algunos usuarios.
- Consultar un log crudo de eventos en cada vista del dashboard es desperdicio una vez que una sesión está cerrada e inmutable — entonces, en `room_finished`, se corre una pasada de agregación y se materializa en una tabla/fila resumen.
- Esto evita el problema más difícil de la Opción B (upserts con estado compitiendo contra entregas desordenadas) sin caer en el problema más difícil de la Opción A (recalcular la agregación en cada vista); la agregación corre una sola vez, disparada por el único evento autoritativo de "esta sesión terminó".
- En concreto: mantener la tabla de eventos crudos como fuente de verdad (inserts baratos, deduplicados por el `id` de evento de LiveKit), y agregar una segunda tabla para el resumen final por participante, poblada a partir de la primera cuando llega `room_finished`.

Esto es insumo de exploración únicamente — los nombres de tabla/columnas/migración exactos son decisión de `sdd-propose`/`sdd-spec`/`sdd-design`.

## Preguntas abiertas para llevar a `sdd-propose`

1. ¿Los participantes invitados (sin `userId`) deben aparecer en la línea de tiempo? Hoy el insert de `callHistory` los excluye explícitamente; el nuevo insert de correlación en `CallsService.join()` necesitaría dejar de condicionarse a `participant.userId` si los invitados entran en el alcance.
2. ¿Dónde vive el punto de entrada para "ver línea de tiempo" para el usuario final — extender `history/page.tsx`, o mostrar un link justo al cortar en `MeetingRoom.tsx`? En ambos casos hace falta un identificador de sesión estable (`room.sid`) llevado hasta el cliente.
3. Confirmar si `NestFactory.create(AppModule, { rawBody: true })` es aceptable de forma global, o si hace falta un middleware de raw-body más acotado por ruta — marcar para revisión en diseño porque es un cambio en el bootstrap de `main.ts`, aunque de bajo riesgo.
4. Decidir la retención: ¿el log crudo de eventos se purga después de materializar el resumen, o se mantiene indefinidamente para auditoría/debugging?

## Archivos leídos durante esta exploración

- `openspec/config.yaml`, `openspec/changes/call-participation-timeline/state.yaml`
- `src/modules/calls/calls.service.ts`, `calls.module.ts`, `calls.controller.ts`, `call-history.controller.ts`
- `src/db/schema.ts`
- `src/modules/auth/room-access.service.ts`, `src/modules/auth/guards/room-access.guard.ts`
- `src/modules/rooms/rooms.service.ts`, `rooms.controller.ts`
- `src/app.module.ts`, `src/main.ts`, `src/common/http-only-throttler.guard.ts`
- `client/src/app/history/page.tsx`, `client/src/app/room/[code]/page.tsx`
- `client/src/features/calls/useCallSession.ts`, `MeetingRoom.tsx`
- `docs/decisiones-tecnicas.md` (§12, §16)
- `node_modules/.pnpm/livekit-server-sdk@2.19.2/.../WebhookReceiver.d.ts`
- `node_modules/.pnpm/@livekit+protocol@1.52.1/.../livekit_webhook_pb.d.ts`, `livekit_models_pb.d.ts`

## Riesgos

1. La inestabilidad del `identity` de LiveKit entre reconexiones exige una tabla de correlación nueva — no es una extensión directa de `callHistory`.
2. El alcance de inclusión de invitados es una decisión de producto abierta.
3. El cambio de bootstrap (`rawBody: true`) toca el bootstrap global de la app — bajo riesgo, vale revisión en diseño.
4. El throttler global (60 req/min/IP) podría afectar ráfagas de entrega de webhooks con salas más grandes; hoy está bien con el tope de 6 participantes.
