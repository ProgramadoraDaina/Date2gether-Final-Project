# Propuesta: breakout-rooms (mini salas estilo Zoom dentro de una llamada)

## Intención

Hoy un admin que da un examen o una actividad en pequeños grupos tiene exactamente una opción: una llamada, una sala de medios, todos escuchan a todos. No hay forma de dividir un grupo en subgrupos aislados y volver a juntarlos. El código hardcodea una suposición 1:1 de sala-de-la-app-a-sala-de-LiveKit en `join()`, `assertHostConnected()`, y `CallSessionCloseService`; esa suposición, no LiveKit, es el obstáculo. Este cambio agrega mini salas orquestadas por el servidor con aislamiento real de medios y membresía forzada por el servidor, que es el único modelo compatible con proctoring (un filtro del lado cliente se evade trivialmente).

## Alcance

### Dentro de alcance

- Ciclo de vida solo-admin: crear / listar / cerrar mini salas para una llamada activa; mover un participante hacia adentro; devolver participantes a la sala principal.
- Tope por env `MAX_BREAKOUT_ROOMS` (default `3`, acotado `0-3`, `0` = feature apagada), validado con el mismo patrón fail-fast que `MAX_ROOM_PARTICIPANTS`.
- **Política de salida** por mini sala, definida por el admin al crearla y mutable mientras está abierta: `locked` (default; solo el admin devuelve gente) o `free_return` (el participante puede volver a la principal por su cuenta).
- **Timer opcional de cierre automático** por mini sala: cuando está definido y transcurre, todos los ocupantes son forzados a volver a la sala principal. El cierre manual del admin (una sala o todas) es inmediato, sin cuenta regresiva — mismo precedente que el cierre forzado ya existente.
- **Control de acceso a nivel grupo**: `assertHostConnected()` y el camino de cierre forzado se redefinen para preguntar "¿hay un admin conectado en CUALQUIER sala de este grupo de llamada?" (principal + mini salas activas).
- Cerrar la llamada principal también cierra todas sus mini salas y devuelve/desconecta a sus ocupantes.
- Cliente: flujo de reconexión con token nuevo sobre un único `<LiveKitRoom>` para los traslados, panel de mini salas para el admin, UX clara para ser trasladado/devuelto/cortado.

### Fuera de alcance

- Monitoreo simultáneo multi-sala del host (decisión cerrada: el host mantiene UNA conexión de LiveKit a la vez, igual que cualquier participante).
- Mini salas como entidades de la tabla `rooms`: sin `code` propio, sin `roomMembers`, sin contenedor de chat/notas, no resolubles por `RoomResolverService`, sin página de historial propia luego de la llamada.
- Infraestructura nueva o de pago (se mantiene el mismo LiveKit autohospedado único en la t3.medium actual).
- Cambiar `MAX_ROOM_PARTICIPANTS` o el comportamiento de 6 personas para llamadas que nunca crean una mini sala.
- Delegar moderación de mini sala a `colaborador`; promover/transferir `administrador` durante la llamada.
- Alcances de chat por mini sala, una UI de línea de tiempo fusionada de grupo, y grabación.

## Decisiones de producto cerradas

| # | Decisión |
|---|---|
| 1 | Máximo 3 mini salas simultáneas, configurable por env, nunca hardcodeado. El total de participantes concurrentes entre la principal y las mini salas debe mantenerse dentro del techo ya validado de ~6-8 de la instancia actual. |
| 2 | La política de salida es un **toggle del admin por mini sala** (`locked` default / `free_return`), un campo explícito, no una regla global implícita. |
| 3 | El control de acceso se evalúa a nivel **grupo**, nunca por sala individual. El cierre forzado dispara solo cuando no queda ningún admin en NINGUNA sala del grupo. |
| 4 | El monitoreo del host es de una sala a la vez. |
| 5 | El cierre es **ambos**: manual (inmediato) **y** timer automático opcional por mini sala. |

## Decisiones de la propuesta sobre preguntas abiertas

> Estas tres NO fueron confirmadas por el usuario. Cada una es una decisión deliberada, señalada para poder revisarse antes de que `sdd-design` las cierre.

**C1 — Persistencia: filas operativas, no entidades `rooms`.** Una tabla nueva `call_breakout_rooms` acotada al padre (`roomId`, `livekitRoomName`, `label`, `leavePolicy`, `autoCloseAt`, `closedAt`). *Por qué:* el control de acceso a nivel grupo (decisión 3) debe responder "¿qué salas de LiveKit pertenecen a este grupo?" desde un estado durable — mantenerlo en memoria heredaría la limitación de proceso único ya documentada de `pendingCloses`, para una decisión de **seguridad**, lo cual es inaceptable. Las filas son operativas y mueren con la llamada: sin código, sin miembros, sin historial independiente. *Revisar si* el diseño encuentra una forma de derivar la membresía del grupo de forma autoritativa solo desde `call_events`.

**C2 — El chat, las notas y la línea de tiempo quedan compartidos de la sala principal, sin cambios.** Las mini salas no tienen alcance de chat efímero propio en este recorte. *Por qué:* el chat/notas son por sala (`roomMembers`, `chat.gateway.ts`), no por llamada; crear alcances por mini sala implica abrir el módulo de chat para un requisito que el caso de uso de proctoring no plantea (el requisito es aislamiento de medios). *Limitación a declarar en voz alta:* el chat compartido es un canal de texto cruzado entre grupos durante un examen. Los admins mantienen las herramientas de moderación/bloqueo de medios ya existentes. *Revisar si* la integridad del examen exige aislamiento de texto — ahí sería un cambio propio.

**C3 — El tiempo de mini sala es una fila distinta de `call_sessions`, vinculada por grupo.** Una sala de LiveKit = un `livekitRoomSid` = una sesión ya está forzado por el pipeline de webhooks; peleárselo implicaría reescribir la ingestión. Entonces: agregar un `callGroupId` nullable a `call_sessions` que vincula las sesiones de mini sala con la principal, y escribir `call_participant_identities` para los tokens de mini sala con el **mismo `roomId`** que la sala principal para que la resolución de rol y la correlación de identidad sigan funcionando sin tocarse. `aggregate-session.ts` queda sin cambios. Mostrar una línea de tiempo fusionada principal+mini salas queda fuera de alcance; el vínculo se guarda para que un cambio posterior pueda construirla. *Revisar si* se necesita un modelo de lectura fusionado en este recorte.

## Enfoque

Enfoque 1 de la exploración (múltiples salas de LiveKit orquestadas por el servidor). El Enfoque 2 (filtrado del lado cliente) sigue rechazado: sin límite forzado por el servidor, inutilizable para proctoring.

1. Las salas de LiveKit de mini sala se crean con `RoomServiceClient.createRoom()` — la misma llamada idempotente que ya usa `join()` — nombradas `${roomCode}::breakout-N`. Agregar una guarda explícita para que los nombres con `::` nunca puedan resolverse como un código de sala por `RoomResolverService`/`getByCodeOrThrow`.
2. **Resolución de grupo como función pura y aditiva.** Una única `resolveCallGroupRoomNames(roomId, roomCode)` devuelve `[roomCode, ...activeBreakoutNames]`. Sin filas de mini sala activas devuelve `[roomCode]`, así que el control de acceso a nivel grupo **degenera exactamente al control de acceso de una sola sala de hoy**. Esta es la propiedad de seguridad principal de todo el cambio, y la historia de rollback (abajo) se apoya en ella.
3. `assertHostConnected()` y `CallSessionCloseService.hasConnectedAdmin()` iteran los nombres del grupo vía `listParticipants` en lugar de un solo nombre. El estado en vivo de LiveKit sigue siendo la autoridad, la semántica fail-closed/fail-safe no cambia (`503` en el camino de join, "no forzar cierre si no se puede verificar" en el camino de webhook).
4. Los traslados = reemisión de token: el servidor valida admin + capacidad del destino, escribe la fila de identidad, emite un `AccessToken` nuevo acotado al nombre de la mini sala; el cliente desconecta y reconecta el único `<LiveKitRoom>`. Una mini sala `locked` nunca emite un token de la sala principal a pedido propio de sus ocupantes.
5. El cierre (manual o por timer) = `deleteRoom(breakoutName)` + marcar `closedAt`, reutilizando las mismas capas de cierre tolerante/idempotente ya existentes. El cierre de la sala principal despliega primero sobre todo el grupo.
6. **TDD estricto** (`strict_tdd: true`, `pnpm test`): los tests preceden al código. Los tests de caracterización que fijan el comportamiento actual del control de acceso de una sola sala se escriben **primero** y deben mantenerse en verde durante todo el proceso.

## Eventos de webhook de LiveKit y verificación de firma

**Sin endpoint nuevo, sin tipos de evento nuevos, sin configuración nueva de LiveKit.** LiveKit emite webhooks por servidor, no por sala, así que los eventos de mini sala ya llegan al endpoint existente `POST /calls/livekit/webhook`, verificado por el mismo chequeo HMAC-sobre-`rawBody` de `WebhookReceiver` (incluyendo el arreglo del header `Authorization`) y la misma excepción `@SkipThrottle`. Eventos consumidos, todos ya manejados: `room_started`, `room_finished`, `participant_joined`, `participant_left` (el disparador de admin-se-fue a nivel grupo), `track_published`, `track_unpublished`. El único cambio del lado de ingestión es de atribución: un `roomCode` que contiene `::` debe resolverse a su grupo padre en lugar de tratarse como una sala desconocida. Se espera hasta 4x de ráfaga de eventos (principal + 3 mini salas) sobre el pipeline de proceso único.

## Capacidades

### Capacidades nuevas

- `call-breakout-rooms`: ciclo de vida de mini sala (crear bajo tope, política de salida, traslados de participantes, cierre manual + por tiempo, cascada desde el cierre de la sala principal) y el modelo de grupo de llamada.

### Capacidades modificadas

- `call-host-gate`: la evaluación de presencia de admin y el cierre forzado pasan de ser por sala de LiveKit a ser por grupo de llamada; debe mantenerse equivalente byte a byte para llamadas sin mini salas activas.
- `call-participant-identity`: ahora también se emiten identidades para los tokens de mini sala, con el `roomId` padre y el `roleAtIssue`.
- `call-participation-timeline`: `call_sessions` gana el vínculo de grupo nullable; el comportamiento del modelo de lectura no cambia en este recorte.
- `call-webhook-ingestion`: el conjunto de eventos y la verificación no cambian; solo cambia la atribución de grupo de los `roomCode` de mini sala.

## Áreas afectadas

| Área | Impacto | Descripción |
|---|---|---|
| `src/db/schema.ts` + migración | Modificado | Tabla nueva `call_breakout_rooms`; `callGroupId` nullable en `call_sessions`. Solo aditivo. |
| `src/modules/calls/calls.service.ts` | Modificado | `assertHostConnected()` sobre nombres de grupo; emisión de token de mini sala; validación de `MAX_BREAKOUT_ROOMS` |
| `src/modules/calls/call-session-close.service.ts` | Modificado | `hasConnectedAdmin()` sobre nombres de grupo; cierre en cascada de grupo |
| `src/modules/calls/breakout-rooms.service.ts` + controlador | Nuevo | Ciclo de vida, capacidad, política de salida, timer automático |
| `src/modules/calls/calls-webhook.service.ts` | Modificado | Atribución de grupo para nombres de sala con `::` |
| `src/modules/rooms/room-resolver.service.ts` | Modificado | Rechazar nombres con `::` como códigos de sala resolubles |
| `client/src/features/calls/MeetingRoom.tsx`, `useCallSession.ts` | Modificado | Reconexión al trasladar, mensajería de trasladado/devuelto/cortado |
| `client/src/features/calls/` (panel de mini sala) | Nuevo | UI de crear/cerrar/trasladar para el admin con controles de política y timer |
| `.env` / configs de deploy | Modificado | `MAX_BREAKOUT_ROOMS` |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| El control de acceso a nivel grupo regresiona el control de acceso de una sola sala ya en producción, para llamadas sin mini salas | Media | El resolver de grupo degenera a `[roomCode]`; tests de caracterización primero; el cambio del control de acceso va en su propio commit revertible |
| Techo de CPU/ancho de banda de la t3.medium bajo 4 salas SFU concurrentes | Alta | Tope de 3 salas; **probar carga antes de que un examen real dependa de esto** — es una recomendación, no una garantía verificada |
| Participante varado a mitad de traslado (token emitido, falla la reconexión) | Media | El token de la sala principal sigue válido hasta su TTL en `free_return`; acción de recuperación explícita del admin "devolver a todos" |
| Timer automático se pierde si el proceso se reinicia (misma limitación de instancia única que `pendingCloses`) | Media | Persistir `autoCloseAt`; reevaluar perezosamente en la siguiente interacción del grupo; documentar la limitación |
| Nombre de mini sala con `::` filtrándose a la resolución de código de sala | Baja | Rechazo explícito del resolver + test |
| Ráfaga de webhooks (4x) contra el pipeline de proceso único | Baja | `@SkipThrottle` ya está en su lugar; la deduplicación append-only ya es idempotente |
| La política `locked` se percibe como estar atrapado | Media | Texto explícito del cliente: "el host te va a devolver" |

## Plan de rollback

Tres niveles independientes, del más barato al más caro:

1. **Sin deploy:** fijar `MAX_BREAKOUT_ROOMS=0`. No se pueden crear filas de mini sala nuevas; `resolveCallGroupRoomNames()` devuelve `[roomCode]` para toda llamada, así que el control de acceso y el cierre forzado se comportan exactamente igual que hoy. Este es el killswitch diseñado para la parte crítica de seguridad del cambio.
2. **Revert parcial:** el commit del control de acceso a nivel grupo se mantiene separado de los commits de CRUD/UI de mini sala, así que revertir solo el commit del control de acceso restaura el `assertHostConnected()` / `hasConnectedAdmin()` literal por sala, dejando las tablas de mini sala (ahora inertes) en su lugar.
3. **Revert completo:** revertir el cambio y correr el `down` de la migración. Ambos agregados de esquema son aditivos y nullable — borrar `call_breakout_rooms` y `call_sessions.callGroupId` solo pierde los metadatos de mini sala; `call_events`, `call_sessions`, `call_session_participants`, y `call_history` conservan cada fila preexistente y su semántica actual.

En los tres casos, el camino de la llamada principal, el chat, las notas, y las listas de miembros quedan intactos.

## Dependencias

- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_API_URL` — ya configuradas; sin credenciales nuevas.
- Endpoint de webhook ya verificado y bootstrap con `rawBody: true` — ya en producción.
- `room.auto_create: false` se mantiene; todas las salas se crean del lado servidor.
- Al menos un `administrador` en `roomMembers` para la sala padre (ya requerido por `call-host-gate`).
- Prueba de carga en la instancia EC2 antes de confiar en el tope de 3 salas para un examen real.

## Criterios de éxito

- [ ] Una llamada sin mini salas se comporta idéntico a hoy: mismo control de acceso, mismo cierre forzado, misma gracia de 15s, specs y tests existentes en verde y sin modificar.
- [ ] Un admin puede abrir hasta `MAX_BREAKOUT_ROOMS` mini salas y es rechazado en la siguiente con un mensaje explícito.
- [ ] El aislamiento de medios es real: un ocupante de mini sala no recibe ningún track de audio/video de ninguna otra sala del grupo (forzado por el servidor, no filtrado por el cliente).
- [ ] En una mini sala `locked`, el intento de volver por cuenta propia de un participante es rechazado del lado servidor y no se emite token de la sala principal; en `free_return` sí se emite.
- [ ] Un solo admin en una mini sala mantiene vivo todo el grupo: los participantes que quedan en la sala principal NO sufren cierre forzado.
- [ ] Con cero admins conectados en cualquier parte del grupo, el cierre forzado dispara una vez y desarma la sala principal y cada mini sala activa.
- [ ] El cierre manual del admin devuelve a los ocupantes de inmediato; un timer automático definido los devuelve al transcurrir, sin acción del admin.
- [ ] Un nombre de mini sala nunca es resoluble como código de sala y nunca crea una fila de `rooms`.
- [ ] Cada mini sala produce su propia fila de `call_sessions` con el vínculo de grupo, y la página de línea de tiempo existente sigue mostrando los datos por sesión sin cambios.
- [ ] `MAX_BREAKOUT_ROOMS=0` deshabilita por completo la feature y restaura el comportamiento de control de acceso previo al cambio sin tocar código.
