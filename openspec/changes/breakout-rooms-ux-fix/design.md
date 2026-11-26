# Diseño: breakout-rooms-ux-fix (auto-unirse a mini salas + panel unificado)

## Enfoque técnico

Cuatro piezas independientes, ninguna nueva en concepto: (1) el motivo de remoción se modela como **señal previa por el socket de sala**, extendiendo el canal que `moveIn` ya usa (`breakout:assigned`, `breakout-rooms.service.ts:276-283`); (2) `joinPolicy` es una columna aditiva más en `call_breakout_rooms` y un cambio de **autorización** en `moveIn`, sin tocar la mecánica de reemisión de token; (3) `list` gana una proyección discriminada por rol, decidida en el servicio; (4) el frontend colapsa los dos *gates* ortogonales en un **único punto de montaje** con un selector puro de 4 estados.

R1 se resuelve primero porque condiciona todo lo demás.

---

## R1 — Admin sola que se traslada: verificación y mitigación

### Traza verificada (no inferida)

| T | Qué pasa | Evidencia |
|---|---|---|
| T0 | `moveIn` inserta la identity nueva (`roomId` del padre, `roleAtIssue='administrador'` heredado) y la fila de `call_breakout_occupants` (`assigned_at = now()`) **antes** de `removeParticipant` | `breakout-rooms.service.ts:255-269` vs `283` |
| T0+~0,2s | `participant_left`(principal, identity vieja) → `roleAtIssue='administrador'` → `onAdminLeft(mainSid, parentCode, roomId)` | `calls-webhook.service.ts:235-245` |
| | `resolveGroupAnchor`: `parentCode` sin `::` → se devuelve tal cual, **0 consultas** | `call-group-resolver.service.ts:39-40` |
| | `hasConnectedAdmin`: `names = [principal, breakout]` → camino multi-sala → `listParticipants` de ambas devuelve **vacío** (la mini sala existe por `createRoom` en `create()`, pero nadie entró todavía) → `identities.length === 0` → **`false`** | `call-session-close.service.ts:132-134`, `165-184`; `breakout-rooms.service.ts:151-156` |
| | Se agenda el cierre a **T+15s**, indexado por `mainSid` | `call-session-close.service.ts:86-90` |
| T0+1-3s | El cliente recibe `breakout:assigned`, pide el token y hace `switchRoom` | `MeetingRoom.tsx:400-417` |
| T+15s | `recheckAndClose` → `hasConnectedAdmin` → `listParticipants(breakout)` devuelve la identity nueva → la consulta con filtro de `roomId` la encuentra con `roleAtIssue='administrador'` → **`true`** → no cierra | `call-session-close.service.ts:111-114`, `136-149` |
| T0+30s | `room_finished`(principal) por `departureTimeout: 30` → `cancelPending(mainSid)` (no-op, el timer ya corrió) + materialización | `calls.service.ts:104-109`, `calls-webhook.service.ts:262-270` |

**Conclusión (a):** ambos caminos de R1 están cubiertos hoy. El segundo camino que la propuesta temía es **inocuo o protector**: `room_finished` de la principal llega a T+30s (después del re-chequeo) y `cancelPending` solo *cancela* cierres, nunca los provoca. Además `onRoomFinished` **no** ejecuta la cascada `closeGroupBreakouts` — la tabla de Flujo 3 del diseño original la listaba como disparador, pero el único llamador real es `claimAndClose` (`call-session-close.service.ts:204`). Esa divergencia es justamente lo que mantiene viva la mini sala cuando la principal queda vacía.

**Conclusión (b):** igual hace falta mitigación. El margen es puramente temporal (15s de gracia contra 1-3s de reconexión) y el modo de falla es catastrófico y silencioso: si la reconexión excede 15s, `claimAndClose` cierra las mini salas y borra la principal. Una red móvil lenta o un *cold start* del endpoint de token lo alcanzan.

### Decisión R1 — Marcador durable de "asignación en vuelo", leído solo por el evaluador de cierre

| Opción | Tradeoff | Decisión |
|---|---|---|
| Asumir que 15s alcanzan | Cero código; el modo de falla es destruir la llamada sin rastro | Rechazada |
| Ensanchar `GRACE_WINDOW_MS` | Retrasa **todo** cierre forzado, incluido el legítimo de `call-host-gate` ya en producción | Rechazada |
| Supresión en memoria (`closeService.suppress(parentSid)`) llamada desde `moveIn` | Introduce ciclo de dependencias (`CallSessionCloseService` ya importa `BreakoutRoomsService`) y no sobrevive un reinicio | Rechazada |
| **`hasConnectedAdmin` consulta la asignación abierta de un admin con `assigned_at` reciente** | Una consulta indexada, solo en la rama que iba a devolver `false` | **Elegida** |

El marcador **ya existe y ya es durable**: `moveIn` escribe la fila de ocupante antes de `removeParticipant`, con `assigned_at` (`drizzle/0023_breakout_rooms.sql:8`) y el índice parcial `(breakout_room_id) where returned_at is null` (línea 30). Cero columnas, cero tablas, cero escrituras nuevas.

```ts
// call-session-close.service.ts
const ASSIGNMENT_IN_FLIGHT_MS = 30_000;

/** Un admin con asignación abierta y fresca a una mini sala del grupo está
 *  EN TRÁNSITO: todavía no aparece en listParticipants de ninguna sala. */
private async hasAdminAssignmentInFlight(roomId: string | null): Promise<boolean>;
```

- Se evalúa **solo** cuando `groupRoomNames.length > 1` y la evaluación de presencia iba a devolver `false`: cero costo para toda llamada sin mini salas (invariante de D2/D9 intacta) y cero costo en el camino feliz.
- Condiciones: `call_breakout_rooms.room_id = roomId AND closed_at IS NULL` ⋈ `call_breakout_occupants.returned_at IS NULL AND assigned_at > now() - 30s` ⋈ `call_participant_identities.role_at_issue = 'administrador'` (por `livekit_identity`). Un traslado de **no-admin** nunca sostiene el grupo: el `roleAtIssue` se hereda del origen (`breakout-rooms.service.ts:261`).
- Vive **solo** en `CallSessionCloseService.hasConnectedAdmin`, **no** en `CallsService.assertHostConnected`. Son preguntas distintas: "¿destruyo este grupo?" admite sesgo *fail-safe* (el `catch → true` de la línea 150 ya lo tiene); "¿admito a alguien ahora?" no — admitir por un admin en tránsito dejaría entrar a un no-admin a una llamada sin nadie supervisando, debilitando el host-gate en producción.
- No produce inmortalidad: si la reconexión nunca ocurre, a T+30s el marcador vence y, además, LiveKit reapea ambas salas por `emptyTimeout`/`departureTimeout` emitiendo `room_finished`, el registro autoritativo de fin de sesión (D4 original).

### Tests de caracterización obligatorios (antes de tocar el evaluador)

| # | Archivo | Qué fija |
|---|---|---|
| R1-C1 | `call-session-close.service.spec.ts` | Con la mini sala creada y vacía y la principal vacía, `onAdminLeft` **agenda** el timer (comportamiento de hoy, antes de la mitigación) |
| R1-C2 | ídem | A T+15s con la identity nueva presente en la mini sala, `recheckAndClose` **no** llama a `deleteRoom` |
| R1-C3 | ídem | Con ambas salas vacías y asignación de admin de 5s de antigüedad, **no** se agenda cierre; con 60s de antigüedad, sí |
| R1-C4 | ídem | Asignación abierta y fresca de un **no-admin** → el cierre se agenda igual |
| R1-C5 | `calls-webhook.service.spec.ts` | `room_finished` de la **principal** no llama a `closeGroupBreakouts` (fija la divergencia que protege este caso) |
| R1-C6 | `calls.service.spec.ts` | `assertHostConnected` **no** consulta `call_breakout_occupants` (la mitigación no se filtró al host-gate) |

---

## Decisión 2 — Señal de motivo de remoción

| Opción | Tradeoff | Decisión |
|---|---|---|
| Parámetro `reason` de `removeParticipant` | El SDK expone `removeParticipant(room, identity)` y `DisconnectReason.PARTICIPANT_REMOVED` no lleva payload | Rechazada (imposible) |
| Inferir desde `call.status === 'switching'` | Es exactamente lo que vuelve indistinguible un traslado de una expulsión por política | Rechazada (decisión 5 de la propuesta) |
| **Evento previo `breakout:removal` con código, emitido por los tres llamadores** | Un evento nuevo y un `on`/`off` más | **Elegida** |

Mismo canal y mismo orden que `breakout:assigned` (señal antes de `removeParticipant`, D12). `breakout:assigned` **no cambia**: sigue llevando el `breakoutId` que el cliente necesita para el token.

```ts
// call-group.ts (puro, ya importado por breakout-rooms.service y calls-webhook.service)
export type BreakoutRemovalReason =
  | 'BREAKOUT_MOVE_IN'        // moveIn — traslado en curso, esperado
  | 'BREAKOUT_FORCED_RETURN'  // selfReturn, camino admin — vuelta forzada, esperada
  | 'BREAKOUT_RETURN_LOCKED'; // webhook, expulsión por política (reusa BREAKOUT_RETURN_LOCKED_CODE)
```

Payload: `{ reason }` y **nada más** — ningún texto. El cliente mapea código → copia traducida, precedente `NO_HOST_CONNECTED` en `lib/calls.ts`.

| Llamador | Emite antes de `removeParticipant` | Destinatario del evento |
|---|---|---|
| `moveIn` (`:283`) | `BREAKOUT_MOVE_IN` | `target.livekitIdentity` |
| `selfReturn` admin (`:365`) | `BREAKOUT_FORCED_RETURN` | **`occupant.sourceIdentity`**, no el identity de mini sala |
| `onParticipantJoined` (`calls-webhook.service.ts:214`) | `BREAKOUT_RETURN_LOCKED` | `identity` (es el de la principal = `sub`) |

**Bug descubierto al diseñar esto**: `ChatGateway.emitToParticipant` resuelve el socket por `user.participantId === participantId`, y `participantId` es `participant.sub` (`chat.gateway.ts:744-755`). En `selfReturn` el admin pasa el identity **nuevo** (uuid de mini sala), que no corresponde a ningún `participantId` de presencia: el evento no llegaría a nadie. Por eso `findOpenOccupantByLivekitIdentity` debe proyectar también `sourceIdentity` y la señal debe direccionarse con ese valor. Es el mismo motivo por el que hoy el forzado de vuelta no puede avisarle nada al cliente.

Nuevo método en `RoomEventsService`: `emitBreakoutRemoval({ roomCode, targetIdentity, reason })` + `onBreakoutRemoval`, idénticos en forma a `emitBreakoutAssigned` (`room-events.service.ts:58-64`). `ChatGateway` lo reenvía con `emitToParticipant(..., 'breakout:removal', { reason })`.

### Lectura en el cliente

`useRoomSocket` gana `consumeRemovalNotice(): { reason, at } | null`, **respaldado por un `useRef`, no por estado**, con lectura destructiva y ventana de frescura de 10s.

**Justificación**: `onDisconnected` dispara a milisegundos del evento de socket; un `setState` puede no haber *flusheado* y leer estado stale clasificaría una expulsión legítima como fallo genérico — fail-open en el caso sensible. El `ref` se lee sincrónicamente. La ventana de 10s evita que un aviso viejo tape un fallo de red posterior. Es el mismo criterio del `assignmentRef` que ese hook ya usa (`useRoomSocket.ts:31-35`).

En `MeetingRoom.tsx:638-657`, rama nueva **después** de `if (call.status === 'switching') return;` (línea 643) y **antes** del `else` final:

| `reason` de LiveKit | Aviso consumido | Acción |
|---|---|---|
| `PARTICIPANT_REMOVED` | `BREAKOUT_MOVE_IN` | `return` — no-op; el `issueBreakoutToken().then(switchRoom)` en vuelo ya resuelve el traslado |
| `PARTICIPANT_REMOVED` | `BREAKOUT_FORCED_RETURN` | `call.endedForBreakout()` → `status='ended'`, `endReason='breakout-closed'` |
| `PARTICIPANT_REMOVED` | `BREAKOUT_RETURN_LOCKED` | `call.removedByPolicy(code)` → `status='ended'`, `endReason='breakout-locked'`, mensaje de política visible |
| `PARTICIPANT_REMOVED` | ninguno / vencido | `call.failed(...)` — **comportamiento de hoy intacto** |

`useCallSession` gana dos productores y un literal: `endedForBreakout()` le da por fin un productor a `EndReason = 'breakout-closed'`, hoy declarado sin ninguno (`useCallSession.ts:15-19`); `removedByPolicy()` y `'breakout-locked'` son nuevos. **No se reusa `failed()`**: ignora deliberadamente su argumento y fija una copia de red (`useCallSession.ts:83-88`), y además `'error'` es la categoría equivocada — una expulsión por política es un fin de sesión por regla, no un fallo.

---

## Decisión 3 — `joinPolicy`: esquema, migración y autorización

| Pieza | Cambio |
|---|---|
| `src/db/schema.ts` | `joinPolicy: varchar('join_policy', { length: 16 }).notNull().default('admin_only')` en `callBreakoutRooms`, inmediatamente después de `leavePolicy` (`:543`). `varchar` y no `pgEnum`, mismo precedente ya documentado ahí |
| `drizzle/0024_breakout_join_policy.sql` | `ALTER TABLE "call_breakout_rooms" ADD COLUMN "join_policy" varchar(16) DEFAULT 'admin_only' NOT NULL;` — aditivo, cambio de catálogo sin reescritura. Generar con `pnpm drizzle-kit generate` pasando `DATABASE_URL` **inline** (gotcha conocido del proyecto) |
| `breakout-rooms.service.ts` | `export type JoinPolicy = 'admin_only' \| 'open'` + `DEFAULT_JOIN_POLICY`; `create` y `updatePolicy` lo aceptan (admin-only, sin cambios de rol); `toView` lo proyecta |
| `dto/create-breakout-room.dto.ts`, `dto/update-breakout-room.dto.ts` | `joinPolicy?: JoinPolicy` con el mismo validador que `leavePolicy` |

### Autorización de `moveIn`

Las líneas 226-234 se reordenan: **primero** la fila de la mini sala (ahí vive `joinPolicy`), **después** la decisión.

```
breakout = getOpenRowOrThrow(breakoutId, roomId)
role     = resolveRole(roomId, actor.userId)
actorGroupIdentity = asignación abierta de actor.sub en este room_id ?? actor.sub
autorizado = role === 'administrador'                                  // cualquier destino, incluido uno mismo
          || (breakout.joinPolicy === 'open' && target === actorGroupIdentity)
si no autorizado → 403
```

Dos consecuencias que `'open'` fuerza y que hoy no existen (decisión 2 de producto: "cualquier mini sala, sin requisitos de origen" ⇒ salto entre mini salas):

1. **`sourceIdentity` debe ser siempre el sujeto estable del pase**, no el identity de origen. Hoy `moveIn` escribe `sourceIdentity: target.livekitIdentity` (`:265`), correcto por accidente solo cuando el origen es la principal (donde identity = `sub`). En un salto mini sala → mini sala el origen es un uuid, y la expulsión `locked` del webhook —que consulta `sourceIdentity = identity` de la principal (`calls-webhook.service.ts:204`)— dejaría de encontrarlo: agujero de política. Regla: si el target corresponde a una asignación abierta, se **hereda** su `sourceIdentity`; si no, se usa `target.livekitIdentity`.
2. **La asignación anterior se cierra (`returned_at = now()`) antes de insertar la nueva**, en el mismo camino. Dos asignaciones abiertas para un mismo `sourceIdentity` rompen el índice parcial `(source_identity) where returned_at is null` como clave de decisión y volverían ambiguos tanto `locked` como `hasAdminAssignmentInFlight`.

**Riesgo adyacente a mitigar en el mismo lugar**: `moveIn` valida capacidad con `listParticipants(breakout.livekitRoomName)` sin `try` (`:236`). Una mini sala abierta en la base cuya sala de LiveKit ya reapeó por `emptyTimeout: 300` (crear y no usar por 5 minutos — escenario normal para auto-ingreso) hace **tirar** esa llamada y `moveIn` responde 500. Se aplica el patrón D3 ya vigente: `listRooms([name])` primero; ausente ⇒ se trata como vacía (`createRoom` idempotente antes de emitir el token).

---

## Decisión 4 — Proyección de `list` por rol

El chequeo va en el **servicio**, no en el controlador: `resolveRole` ya vive ahí, el controlador no toca la base, y la proyección *es* la frontera de seguridad — dejarla en el controlador significa que el servicio sigue devolviendo rosters a cualquier llamador, a un refactor de distancia de filtrarlos.

```ts
export interface BreakoutRoomAdminView {          // administrador
  id: string; livekitRoomName: string; label: string;
  leavePolicy: LeavePolicy; joinPolicy: JoinPolicy; autoCloseAt: Date | null;
  occupants: { livekitIdentity: string; sourceIdentity: string;
               displayName: string; userId: string | null }[];
}
export interface BreakoutRoomPublicView {         // resto
  id: string; label: string;
  leavePolicy: LeavePolicy; joinPolicy: JoinPolicy; autoCloseAt: Date | null;
  occupantCount: number; selfAssigned: boolean;
}
async list(roomId, actor): Promise<BreakoutRoomAdminView[] | BreakoutRoomPublicView[]>;
```

- La vista pública **omite** `occupants[]` (criterio de éxito "un no-admin nunca recibe rosters por API") y `livekitRoomName` (espacio de nombres interno, mismo criterio que D11). Conserva `leavePolicy`: es la política que se le va a aplicar a ella: tiene que saber antes de entrar si podrá volver. `selfAssigned` se deriva de su propia asignación abierta por `sub`.
- `sourceIdentity` **se agrega** a la vista de admin, y no es un detalle: es la única clave que permite al panel calcular "quién quedó en la sala principal". `breakoutParticipants` (`page.tsx:298-301`) es la presencia de socket del `roomId`, que **incluye** a los ocupantes de mini salas (siguen en el mismo socket). Principal = `breakoutParticipants` − `⋃ occupants.sourceIdentity`, porque `participantId` de presencia = `participant.sub` = `sourceIdentity` (`page.tsx:293-297`). Sin este campo la resta solo podría hacerse por `userId`, imposible para invitados.

---

## Decisión 5 — Frontend: un punto de montaje y un selector puro de 4 estados

| Opción | Tradeoff | Decisión |
|---|---|---|
| Panel y Banner con gates mutuamente excluyentes | Dos sitios de montaje: la coexistencia sigue siendo expresable y vuelve con el próximo cambio | Rechazada |
| Un componente monolítico con condicionales internos | Los 4 estados solo se testean renderizando todo el árbol | Rechazada |
| **Selector puro `resolveBreakoutViewState()` + `BreakoutView` como único montaje, delegando en dos subvistas** | Un archivo más | **Elegida** |

```ts
export type BreakoutViewState = 'guest-idle' | 'guest-occupant' | 'host' | 'host-occupant';
export function resolveBreakoutViewState(input: {
  isAdmin: boolean; assignment: BreakoutAssignment | null;
}): BreakoutViewState;   // puro, sin React: la matriz de 4 estados se testea sin renderizar
```

| Estado | Condición | Qué renderiza |
|---|---|---|
| `guest-idle` | no-admin, sin asignación | Nada, salvo que exista alguna sala abierta con `joinPolicy='open'`: selector mínimo (etiqueta + `occupantCount`, **sin roster**) y botón de ingreso que llama a `moveIn` sobre sí misma |
| `guest-occupant` | no-admin, con asignación | Solo estado propio: "estás en {label}" + "Volver" si `free_return`, o el aviso de `locked` (el `BreakoutBanner` de hoy, `BreakoutBanner.tsx:19-42`) |
| `host` | admin, sin asignación | Consola completa: **sala principal con ocupantes** (presencia menos ocupantes, ver Decisión 4) + cada mini sala con su roster, crear bajo tope, los dos toggles de política rotulados distinto, timer, trasladar, cerrar una/todas, devolver |
| `host-occupant` | admin, con asignación | La misma consola **más** una franja de estado propio renderizada **dentro** de ella — nunca como hermana. Es lo que vuelve estructuralmente inexpresable el bug de hoy |

- `BreakoutView` se monta **una sola vez**, en el lugar del disparador del dock (`MeetingRoom.tsx:562-584`), y es dueña de su propio disparador y de su *popover*. Se **elimina** el sitio de montaje del banner (`:478-484`): ya no hay dos *gates*.
- `isCurrentUserAdmin` deja de gatear el montaje y pasa a ser **entrada del selector**. `BreakoutPanel` se convierte en `BreakoutHostConsole` (subvista de `host`/`host-occupant`) y `BreakoutBanner` en `BreakoutSelfStatus`.
- El selector de traslado filtra la identidad propia con `currentParticipantId`, el patrón ya usado para `PollPanel` (`page.tsx:951`) — pero como el admin ahora **sí** puede auto-trasladarse, la fila propia no se elimina: se saca del listado genérico y se ofrece como acción explícita y separada ("moverme acá"), para que nunca haya una fila duplicada ni ambigua.
- `page.tsx` pasa `currentParticipantId={access.participant.sub}` hacia `MeetingRoom` → `BreakoutView`.

---

## Cambios de archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `src/db/schema.ts` | Modificar | `joinPolicy` en `callBreakoutRooms` |
| `drizzle/0024_breakout_join_policy.sql` | Crear | `ADD COLUMN join_policy` aditivo con default |
| `src/modules/calls/call-group.ts` | Modificar | `BreakoutRemovalReason` (puro, compartido por servicio y webhook) |
| `src/modules/calls/breakout-rooms.service.ts` | Modificar | `JoinPolicy`; autorización de `moveIn` + `sourceIdentity` heredado + cierre de la asignación previa + `listRooms` antes de capacidad; `list` discriminada; señales de remoción; `sourceIdentity` en `findOpenOccupantByLivekitIdentity` |
| `src/modules/calls/breakout-rooms.controller.ts` | Modificar | Tipo de retorno de `list` |
| `src/modules/calls/dto/{create,update}-breakout-room.dto.ts` | Modificar | `joinPolicy` validado |
| `src/modules/calls/call-session-close.service.ts` | Modificar | `hasAdminAssignmentInFlight` dentro de `hasConnectedAdmin` |
| `src/modules/calls/calls-webhook.service.ts` | Modificar | Señal `BREAKOUT_RETURN_LOCKED` antes de la expulsión (`:214`) |
| `src/modules/rooms/room-events.service.ts` | Modificar | `emitBreakoutRemoval` / `onBreakoutRemoval` |
| `src/modules/chat/chat.gateway.ts` | Modificar | Reenvío de `breakout:removal` por `emitToParticipant` |
| `client/src/features/chat/useRoomSocket.ts` | Modificar | `consumeRemovalNotice()` respaldado por ref |
| `client/src/features/calls/useCallSession.ts` | Modificar | `endedForBreakout()`, `removedByPolicy()`, `'breakout-locked'` |
| `client/src/features/calls/MeetingRoom.tsx` | Modificar | Rama `PARTICIPANT_REMOVED`; un solo montaje de mini salas |
| `client/src/features/calls/breakoutViewState.ts` | Crear | Selector puro de los 4 estados |
| `client/src/features/calls/BreakoutView.tsx` | Crear | Único punto de montaje |
| `client/src/features/calls/BreakoutPanel.tsx` → `BreakoutHostConsole.tsx` | Modificar | Principal + ocupantes, dos toggles, auto-traslado |
| `client/src/features/calls/BreakoutBanner.tsx` → `BreakoutSelfStatus.tsx` | Modificar | Subvista, ya no se monta sola |
| `client/src/lib/breakouts.ts` | Modificar | `joinPolicy`, vistas admin/pública, mapeo de códigos de remoción |
| `client/src/app/room/[code]/page.tsx` | Modificar | `currentParticipantId` hacia `MeetingRoom` |

---

## Estrategia de pruebas

TDD estricto activo (`pnpm test`): los tests preceden al código, empezando por R1-C1…R1-C6.

| Capa | Qué probar |
|---|---|
| Unit (puro) | `resolveBreakoutViewState`: los 4 estados, exhaustivo, sin render. `BreakoutRemovalReason` como unión cerrada |
| Unit (servidor) | `hasAdminAssignmentInFlight`: fresca/vencida, admin/no-admin, sin mini salas ⇒ consulta **no** ejecutada |
| Unit (servidor) | `moveIn`: admin a sí misma OK; no-admin con `admin_only` → 403; no-admin con `open` a sí misma OK; no-admin con `open` a un tercero → 403; salto entre mini salas hereda `sourceIdentity` y cierra la asignación previa; destino lleno → 409; sala ausente de LiveKit → no 500 |
| Unit (servidor) | `list`: admin recibe `occupants` con `sourceIdentity`; no-admin recibe `occupantCount` y **ningún** campo de roster ni `livekitRoomName` |
| Unit (servidor) | Señales: los tres llamadores emiten antes de `removeParticipant`; `selfReturn` direcciona por `sourceIdentity`; `updatePolicy` de `joinPolicy` no altera `leavePolicy` y viceversa |
| Unit (cliente) | `onDisconnected` × 4 (los tres códigos + sin aviso ⇒ `failed`); `consumeRemovalNotice` es destructivo y respeta la ventana de 10s; en ningún estado se renderizan dos vistas de mini sala |
| E2E | Admin sola crea mini sala, se traslada, **cero** error visible y la llamada sigue viva pasados 20s; ocupante `locked` reconectado ve el mensaje de política |

## Migración y rollback

Aditiva, sin *downtime*: una sola `ALTER TABLE ... ADD COLUMN ... DEFAULT ... NOT NULL` (catálogo, sin reescritura en PG ≥ 11). Rollback según el plan de la propuesta: nivel 1 dejar `joinPolicy='admin_only'` en toda mini sala (sin deploy); nivel 2 revertir solo el commit de UI; nivel 3 revertir + `down` (la columna es aditiva con default, no se pierde dato preexistente). El commit del backend y el del panel unificado van **separados**, requisito del nivel 2.

## Limitaciones declaradas y preguntas abiertas

- [ ] La mitigación de R1 extiende la protección a ~30s desde `assigned_at`. Una reconexión que tarde más no está cubierta; el techo real es la convergencia por `room_finished` de LiveKit, no un cierre forzado.
- [ ] `room_finished` de la principal **no** ejecuta la cascada, en divergencia con la tabla de Flujo 3 del diseño original. Hoy eso protege a la admin sola en una mini sala. R1-C5 lo fija como contrato: si alguien "completa" esa cascada después, rompe este caso.
- [ ] `BREAKOUT_FORCED_RETURN` termina la sesión del cliente (`endReason='breakout-closed'`) y la persona vuelve a entrar con un clic desde la página de la sala. La reunión automática con la principal no existe hoy para ningún camino de retorno (`breakoutReturnSignal` se produce en `useRoomSocket` y **ningún** componente lo consume) y construirla queda fuera de alcance.
- [ ] La ventana de fuga de `locked` de 1-2s (D8 original) no cambia: ahora la expulsión además explica su motivo.
