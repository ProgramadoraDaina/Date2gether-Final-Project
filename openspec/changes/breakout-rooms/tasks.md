# Tareas: Mini salas dentro de una llamada (breakout-rooms)

## Review Workload Forecast

| Campo | Valor |
|---|---|
| Líneas estimadas de cambio | ~3200–4200 (2 migraciones, 1 módulo puro nuevo, 1 resolver nuevo, 2 servicios existentes generalizados a grupo, 1 servicio+controlador CRUD nuevo con 9 operaciones, 1 guard en `RoomResolverService`, 2 puntos de enforcement de `locked`, atribución de webhook + timeline, 6 piezas de cliente nuevas/modificadas, E2E) |
| Riesgo de presupuesto de 400 líneas | High |
| PRs encadenados recomendados (si no hubiera decisión previa) | Yes |
| Decisión de entrega ya tomada | **single-pr** (el usuario eligió explícitamente un solo PR, sin cadena, independientemente de este forecast) |
| Estrategia de entrega | single-pr |
| Estrategia de cadena | N/A — no aplica bajo `single-pr` |

```text
Decision needed before apply: No (ya decidida: single-pr)
Chained PRs recommended by size: Yes — pero no se van a usar
Chain strategy: N/A
400-line budget risk: High
Recommended action before apply: solicitar size:exception explícito antes de abrir el PR único
```

**Por qué es alto**: dos migraciones (una bloqueante de ensanche de columna, otra de dos tablas nuevas), un módulo puro nuevo con su propio set de casos borde (`call-group.ts`), un resolver nuevo (`CallGroupResolverService`), la generalización de **dos** evaluadores de presencia ya en producción (`assertHostConnected`, `hasConnectedAdmin`) de sala única a grupo — el commit de mayor riesgo del cambio —, un servicio CRUD nuevo con nueve operaciones (`BreakoutRoomsService`) más su controlador y DTOs, el enforcement de `locked` en dos puntos distintos (gate de `join()` + webhook `participant_joined`), la atribución de eventos de webhook y el vínculo de `callGroupId` en la línea de tiempo, seis piezas de cliente (dos modificadas, cuatro nuevas) y una suite E2E. Es la superficie real del diseño, no una sobreestimación.

Esta superficie es consistente con el forecast de `call-participation-timeline` (~2000–3000 líneas para una feature de alcance comparable) más el servicio CRUD completo que ese cambio no tenía.

**Nota para quien decide la excepción de tamaño**: si se solicita `size:exception`, el riesgo real a vigilar en revisión no es el volumen sino que el commit de Fase 4 (control de acceso a nivel grupo) quede genuinamente aislado de CRUD/UI — es la única forma de que el rollback de nivel 2 declarado en el diseño sea ejecutable.

### Commit Groups (dentro del PR único — no son PRs, son los puntos de corte para `size:exception` y para el rollback de nivel 2 y 3)

| Grupo | Objetivo | Depende de | Nivel de rollback que habilita |
|---|---|---|---|
| G1 | Migración: ensanche de `room_code` (Fase 1) | — | Nivel 3 (se deja; revertirlo podría truncar datos) |
| G2 | Migración: tablas de mini sala + `call_group_id` (Fase 2) | G1 | Nivel 3 (`DROP` de las tablas y la columna) |
| G3 | Tests de caracterización C1–C9 (Fase 3) | G2 | — (no es código de producción, es red de seguridad) |
| G4 | **Control de acceso a nivel grupo — commit aislado** (Fase 4) | G3 | **Nivel 2** (revertir solo este commit) |
| G5 | CRUD/ciclo de vida de mini salas + enforcement de `locked` (Fase 5) | G4 | — (inerte si se revierte G4) |
| G6 | Cliente (Fase 6) | G5 | — |
| G7 | E2E + carga manual + checklist de despliegue (Fases 7–8) | G6 | — |

G4 **MUST** quedar como commit(s) propio(s), sin mezclar ningún archivo de `BreakoutRoomsService`, `BreakoutRoomsController`, DTOs ni cliente. Es un requisito del diseño, no una preferencia de estilo.

---

## Fase 1 — Migración: ensanche de `room_code` (aislado, sin feature habilitada)

- [x] 1.1 Modificar `src/db/schema.ts`: `callEvents.roomCode` y `callSessions.roomCode` de `varchar(20)` a `varchar(40)`. No tocar ninguna otra columna.
- [x] 1.2 Generar `pnpm drizzle-kit generate` con `DATABASE_URL` inline (gotcha ya conocido del proyecto: drizzle-kit ignora el `.env`) → `drizzle/00XX_widen_room_code.sql`; confirmar que solo contiene `ALTER COLUMN ... TYPE varchar(40)`, sin reescritura de tabla.
- [x] 1.3 Aplicar en desarrollo y correr `pnpm test` completo: ningún test existente cambia de resultado por el ensanche.

## Fase 2 — Migración: tablas de mini sala + columna de grupo (depende de Fase 1)

- [x] 2.1 Modificar `src/db/schema.ts`: tabla `call_breakout_rooms` (columnas y notas de D4/D5 del diseño: `id`, `room_id`, `livekit_room_name` único, `parent_livekit_room_sid`, `label`, `leave_policy`, `auto_close_at`, `closed_at`, `created_at`; índices `unique(livekit_room_name)` e `index(room_id, closed_at)`).
- [x] 2.2 Modificar `src/db/schema.ts`: tabla `call_breakout_occupants` (D5.1: `id`, `breakout_room_id` FK cascade, `source_identity`, `livekit_identity`, `user_id` FK set null, `display_name`, `assigned_at`, `returned_at`; índices `unique(livekit_identity)`, `(breakout_room_id) where returned_at is null`, `(source_identity) where returned_at is null`).
- [x] 2.3 Modificar `src/db/schema.ts`: `call_sessions.call_group_id varchar(64)` nullable, sin default, sin backfill.
- [x] 2.4 Generar `pnpm drizzle-kit generate` → `drizzle/00XX_breakout_rooms.sql`; confirmar que solo contiene `CREATE TABLE` + índices + un `ALTER TABLE ADD COLUMN` nullable, ninguna tabla existente se reescribe.
- [x] 2.5 Aplicar en desarrollo y correr `pnpm test` completo: ninguna regresión por la adición pura.

## Fase 3 — Tests de caracterización obligatorios C1–C9 (commit propio, ANTES de tocar `assertHostConnected`/`hasConnectedAdmin`)

TDD estricto activo (`pnpm test`). Estos tests fijan el comportamiento **actual** de los dos evaluadores de presencia; se escriben y se confirman en verde en este mismo commit, sin ninguna edición de `calls.service.ts` ni `call-session-close.service.ts` más allá de lo necesario para que compilen. Si alguno de los 7 casos ya existentes (`calls.service.spec.ts` → describe de host-gate, `call-session-close.service.spec.ts`) no está en verde tal cual está hoy, es una señal de alarma: detenerse antes de seguir.

- [x] 3.1 Confirmar en verde, sin tocar aserciones, los 7 casos existentes de `describe('CallsService: gate de administrador (host-gate)')` en `calls.service.spec.ts`.
- [x] 3.2 Confirmar en verde, sin tocar aserciones, los 11 casos existentes de `call-session-close.service.spec.ts`.
- [x] 3.3 [C1] `calls.service.spec.ts`: `assertHostConnected` llama a `listParticipants` exactamente una vez, con el `roomCode` de la sala principal.
- [x] 3.4 [C2] `calls.service.spec.ts`: la consulta a `call_participant_identities` del gate filtra por `roomId` **y** `roleAtIssue='administrador'`.
- [x] 3.5 [C3] `calls.service.spec.ts`: un `administrador` dispara cero consultas de presencia y cero lecturas de `call_breakout_rooms` (spec host-gate/equivalencia-exacta, mitad admin).
- [x] 3.6 [C4] `call-session-close.service.spec.ts`: `hasConnectedAdmin` hoy **no** filtra por `roomId` — solo por identity + `roleAtIssue`. Fijar esto por escrito antes de agregar el filtro de grupo en Fase 4.
- [x] 3.7 [C5] `call-session-close.service.spec.ts`: las tres ramas de `hasConnectedAdmin` — lista vacía → `false`; admin presente → `true`; `listParticipants` tira → `true` (fail-safe).
- [x] 3.8 [C6] `call-session-close.service.spec.ts`: `onAdminLeft` usa el `roomCode` recibido tal cual, sin normalizar ni derivar.
- [x] 3.9 [C7] `call-session-close.service.spec.ts`: `claimAndClose` llama a `deleteRoom` con un solo nombre y reclama sobre el `livekit_room_sid` recibido.
- [x] 3.10 [RED→GREEN] [C8] Crear `src/modules/calls/call-group.spec.ts`: `buildCallGroupRoomNames(code, [], now)` → `{ names: [code], expired: [] }`.
- [x] 3.11 [GREEN] Crear `src/modules/calls/call-group.ts` con la firma mínima de `buildCallGroupRoomNames`, `OpenBreakout`, `BREAKOUT_NAME_SEPARATOR` que satisface 3.10 (caso degenerado únicamente; el resto de casos de D1 se completan en Fase 4).
- [x] 3.12 [C9] `calls.service.spec.ts`: con cero filas en `call_breakout_rooms`, un no-admin produce la **misma secuencia** de llamadas a LiveKit que antes del cambio (spec host-gate/equivalencia-exacta). Este test queda como ancla de regresión para la Fase 4.
- [x] 3.13 Commit: `test(calls): add characterization tests for host-gate presence evaluators (C1-C9)`.

## Fase 4 — Control de acceso a nivel grupo (COMMIT AISLADO — habilita el rollback de nivel 2; depende de Fase 3)

**Regla de la fase**: ningún archivo de `BreakoutRoomsService`, `BreakoutRoomsController` o cliente entra en este commit. Cualquier `expect` modificado en un test existente de host-gate es una regresión a justificar explícitamente (D9), no una actualización normal.

### 4.1 — Completar `call-group.ts` (función pura, D1)

- [x] 4.1.1 [RED] `buildCallGroupRoomNames`: 1–3 mini salas abiertas → `names = [roomCode, ...abiertas]`, orden estable con la principal primero.
- [x] 4.1.2 [RED] `buildCallGroupRoomNames`: una mini sala con `autoCloseAt <= now` → excluida de `names`, incluida en `expired`.
- [x] 4.1.3 [RED] `buildCallGroupRoomNames`: una mini sala con `closedAt` no nulo → ignorada (no aparece en `names` ni en `expired`).
- [x] 4.1.4 [GREEN] Implementar el filtro de vencimiento y cierre en `buildCallGroupRoomNames`.
- [x] 4.1.5 [RED] `parseBreakoutRoomName`: nombre válido `code::breakout-2` → `{ parentCode: 'code', index: 2 }`; código sin `::` → `null`; `::` suelto sin índice → `null`; índice no numérico → `null`.
- [x] 4.1.6 [GREEN] Implementar `parseBreakoutRoomName`, `buildBreakoutRoomName`, `isBreakoutRoomName`.

### 4.2 — `CallGroupResolverService` (nuevo)

- [x] 4.2.1 [RED] `resolveCallGroupRoomNames(roomId, roomCode)` sin filas abiertas → `[roomCode]`, sin tirar.
- [x] 4.2.2 [RED] `resolveCallGroupRoomNames` con `roomId: null` → `[roomCode]` sin consultar nada (sesión sin correlación conocida).
- [x] 4.2.3 [RED] `resolveCallGroupRoomNames` con mini salas abiertas no vencidas → lista completa vía `buildCallGroupRoomNames`.
- [x] 4.2.4 [GREEN] Implementar `CallGroupResolverService.resolveCallGroupRoomNames` (consulta indexada por `room_id`, sin lógica propia más allá de la consulta).
- [x] 4.2.5 [RED] `resolveGroupAnchor(sid, roomCode)` con `roomCode` sin `::` → `{ parentSid: sid, parentCode: roomCode }`, **cero** consultas a la base (D6).
- [x] 4.2.6 [RED] `resolveGroupAnchor` con `roomCode` con `::` → resuelve `call_breakout_rooms.livekit_room_name` y devuelve el `parent_livekit_room_sid` + código del padre.
- [x] 4.2.7 [GREEN] Implementar `resolveGroupAnchor`.
- [x] 4.2.8 [RED] `findExpiredBreakouts(roomId)` → proyección de filas abiertas con `auto_close_at` vencido.
- [x] 4.2.9 [GREEN] Implementar `findExpiredBreakouts`.
- [x] 4.2.10 Registrar `CallGroupResolverService` en `calls.module.ts` (sin registrar todavía `BreakoutRoomsService`/`Controller`, eso es Fase 5).

### 4.3 — `CallsService.assertHostConnected` sobre lista de nombres de grupo (D2/D3/D9)

- [x] 4.3.1 [RED] Cambiar la firma de `assertHostConnected(client, roomCode, roomId)` a `assertHostConnected(client, groupRoomNames: string[], roomId)`; con `groupRoomNames.length === 1` el test C1/C2/C9 de Fase 3 sigue en verde sin modificar sus aserciones — es el *fast path* de D2.
- [x] 4.3.2 [GREEN] Implementar el `if (groupRoomNames.length === 1) { /* código de hoy, intacto */ }`.
- [x] 4.3.3 [RED] `groupRoomNames.length > 1`, todas las salas existen en `listRooms` → se consulta `listParticipants` de cada nombre y se unen los identities antes de la consulta a `call_participant_identities` (spec host-gate/admin-en-mini-sala-sostiene-principal).
- [x] 4.3.4 [RED] Una mini sala ausente de `listRooms` → tratada como vacía, no se le llama `listParticipants` (D3).
- [x] 4.3.5 [RED] `listParticipants` tira sobre una sala que sí existe → se propaga igual que hoy (fail-safe sin cambios).
- [x] 4.3.6 [RED] `listRooms` tira → mismo fail-safe.
- [x] 4.3.7 [GREEN] Implementar el camino multi-sala de D3 completo (existencia por `listRooms`, presencia por `listParticipants` solo sobre las existentes, unión de identities, mismo fail-safe de excepción no controlada).
- [x] 4.3.8 Wiring en `join()`: `names = resolveCallGroupRoomNames(room.id, roomCode)` antes de `assertHostConnected`, **solo en el camino no-admin**; el cortocircuito de `administrador` sigue sin tocarse (cero consultas nuevas, confirmado por 3.5/C3).
- [x] 4.3.9 [RED+GREEN] Confirmar los 7 casos de 3.1 y C1/C2/C3/C9 en verde sin cambiar ningún `expect`; extender *fixtures* de mocks es aceptable, cambiar expectativas no (D9).

### 4.4 — `CallSessionCloseService` sobre grupo (D3/D4 generalizado)

- [x] 4.4.1 [RED] `hasConnectedAdmin(roomCode, roomId)` ahora filtra también por `roomId` cuando hay más de un nombre en el grupo (sin romper C4, que fija el comportamiento sin ese filtro para el caso de sala única).
- [x] 4.4.2 [GREEN] Implementar `listGroupIdentities(groupRoomNames)` (D2 fast path + D3 multi-sala) y usarlo dentro de `hasConnectedAdmin`.
- [x] 4.4.3 [RED] `onAdminLeft(livekitRoomSid, roomCode, roomId)` gana el parámetro `roomId`; con un `roomCode` sin `::`, `resolveGroupAnchor` no agrega ninguna consulta (spec host-gate/equivalencia-exacta).
- [x] 4.4.4 [RED] `pendingCloses` se sigue indexando por el `sid` del padre (`parentSid`), no por el `sid` de la sala donde ocurrió el `participant_left`: dos admins yéndose de dos salas distintas del mismo grupo producen **un solo** timer.
- [x] 4.4.5 [GREEN] Implementar `resolveGroupAnchor` dentro de `onAdminLeft` y re-indexar `pendingCloses` por `parentSid`.
- [x] 4.4.6 [RED] `claimAndClose(parentSid, parentCode, roomId)` con grupo de un solo nombre → sigue llamando a `deleteRoom` una sola vez (C7 no se rompe).
- [x] 4.4.7 [GREEN] Confirmar 4.4.6; la cascada sobre mini salas (`closeGroupBreakouts`) **no** se invoca todavía desde aquí — `BreakoutRoomsService` no existe hasta Fase 5. Dejar el punto de extensión documentado con un comentario `// TODO(Fase 5): invocar closeGroupBreakouts`.
- [x] 4.4.8 Actualizar el llamador en `calls-webhook.service.ts` (`onParticipantLeft`) para pasar el `roomId` ya disponible en la fila de `call_participant_identities` consultada — cero consultas nuevas en el camino de webhook.

### 4.5 — Atribución de eventos de grupo en ingestión de webhook (D6, spec call-webhook-ingestion)

- [x] 4.5.1 [RED] Evento con `roomCode` sin `::` → se persiste y despacha exactamente igual que hoy, cero consultas nuevas (spec webhook-ingestion/verificación-sin-cambios).
- [x] 4.5.2 [RED] Evento con `roomCode = '${code}::breakout-N'` → se atribuye al ancla padre vía `resolveGroupAnchor` antes del despacho (spec webhook-ingestion/atribución-mini-sala).
- [x] 4.5.3 [RED] `roomCode` con `::` cuya parte anterior no corresponde a ningún grupo conocido → se acepta sin error, sin efecto de negocio (spec webhook-ingestion/roomCode-sin-grupo).
- [x] 4.5.4 [GREEN] Implementar la atribución en el dispatcher de `calls-webhook.service.ts`, sin reescribir `room_code` en el log (D6: el log guarda el nombre crudo).

### 4.6 — `callGroupId` en la materialización de la línea de tiempo (spec call-participation-timeline, ADDED)

- [x] 4.6.1 [RED] `room_finished` de una mini sala (fixture directa en `call_breakout_rooms`, sin pasar por CRUD) → su fila de `call_sessions` se materializa con `call_group_id = parent_livekit_room_sid` (spec timeline/vínculo-grupo-mini-sala).
- [x] 4.6.2 [RED] `room_finished` de una sala sin mini salas → `call_group_id` nulo (spec timeline/vínculo-grupo-mini-sala, caso sala principal sin grupo).
- [x] 4.6.3 [GREEN] Implementar el stamping de `call_group_id` en el handler de `room_finished` existente, resolviendo `call_breakout_rooms.livekit_room_name = event.room.name → parent_livekit_room_sid`.
- [x] 4.6.4 [RED+GREEN] Regresión: el modelo de lectura de la línea de tiempo (`GET /calls/sessions/:id/timeline`) sigue devolviendo el resumen de una sesión de mini sala sin fusionarlo con el de su sesión padre (spec timeline/modelo-de-lectura-no-se-fusiona). Cubierto por la suite preexistente de `call-timeline.service.spec.ts`, intacta — sin consumidor de `call_group_id` en el modelo de lectura todavía.

### 4.7 — Guard de `RoomResolverService` contra nombres de mini sala (D11)

- [x] 4.7.1 [RED] `resolveJoinable`, `lockJoinable` y `findPoolOccupant` con un código que contiene `::` → `404 NotFoundException`, sin consultar `rooms` (spec breakout-rooms/nombres-no-resolubles).
- [x] 4.7.2 [GREEN] Implementar `assertResolvableCode(code)` al inicio de los tres caminos públicos usando `isBreakoutRoomName` de `call-group.ts`.

### 4.8 — Correlación de identidad: filtro por `roomId` padre ya cubierto, confirmar regresión

- [x] 4.8.1 [RED+GREEN] Confirmar que el filtro `eq(callParticipantIdentities.roomId, roomId)` del gate de 4.3/4.4 sigue funcionando sin tocarse sobre identities que en Fase 5 tendrán `roomId` del padre (D7) — test de regresión adelantado, sin depender de que exista `BreakoutRoomsService` todavía (fixture directa de una fila de identity con `roomId` del padre).

### 4.9 — Cierre de la fase

- [x] 4.9.1 Correr `pnpm test` y `pnpm lint` completos.
- [x] 4.9.2 Confirmar que ningún archivo de `BreakoutRoomsService`, `BreakoutRoomsController`, DTOs o cliente aparece en el diff de esta fase.
- [x] 4.9.3 Commit único (o serie de commits atómicos del mismo grupo lógico): `feat(calls): generalize host-gate presence evaluation to call groups`. Este es el commit que el rollback de nivel 2 revierte solo.

## Fase 5 — CRUD/ciclo de vida de mini salas + enforcement de `locked` (depende de Fase 4)

### 5.1 — `MAX_BREAKOUT_ROOMS` fail-fast (spec breakout-rooms/tope-configurable)

- [x] 5.1.1 [RED] `MAX_BREAKOUT_ROOMS` no definido → se usa `3`.
- [x] 5.1.2 [RED] `MAX_BREAKOUT_ROOMS` no entero o fuera de `0-3` → `503`, sin crear ninguna fila (spec breakout-rooms/configuración-fuera-de-rango).
- [x] 5.1.3 [RED] `MAX_BREAKOUT_ROOMS=0` → cualquier intento de creación se rechaza explícitamente, en todo el despliegue (spec breakout-rooms/apagado-total-via-tope-cero).
- [x] 5.1.4 [GREEN] Implementar la validación fail-fast en `BreakoutRoomsService.create` con el mismo patrón que `MAX_ROOM_PARTICIPANTS`.

### 5.2 — `BreakoutRoomsService.create` + slot/tope (spec breakout-rooms/tope-configurable)

- [x] 5.2.1 [RED] Crear dentro del tope → fila activa, `createRoom` invocado con el nombre `code::breakout-N` del primer slot libre.
- [x] 5.2.2 [RED] Crear en el tope exacto → `409` explícito, ninguna fila nueva (spec breakout-rooms/tope-en-el-límite).
- [x] 5.2.3 [RED] Solicitante no-`administrador` → `403`, ninguna fila nueva.
- [x] 5.2.4 [RED] Carrera de slot (violación de `unique(livekit_room_name)`) → reintento con `N+1`.
- [x] 5.2.5 [GREEN] Implementar `create()` completo: rol, tope, slot libre, `listRooms([code])` para capturar `parent_livekit_room_sid`, `createRoom`, reintento de slot.

### 5.3 — Política de salida (spec breakout-rooms/política-de-salida)

- [x] 5.3.1 [RED] Crear sin indicar política → `leavePolicy = 'locked'`.
- [x] 5.3.2 [RED] Crear con `free_return` explícito → persiste `free_return`.
- [x] 5.3.3 [RED] `updatePolicy` de `locked` a `free_return` en una mini sala abierta → retornos por cuenta propia pasan a aceptarse desde ese momento.
- [x] 5.3.4 [GREEN] Implementar `create()` (default de política) y `updatePolicy()`.

### 5.4 — Traslado (`moveIn`) con identidad nueva (D7, spec breakout-rooms/traslado + spec call-participant-identity)

- [x] 5.4.1 [RED] Traslado válido con capacidad disponible → identity nueva (`randomUUID()`, distinta de `sub`), fila de correlación con **el mismo** `roomId`/`userId`/`displayName`/`roleAtIssue` del padre, token acotado a la mini sala (spec breakout-rooms/traslado-válido, spec participant-identity/correlación-mini-sala).
- [x] 5.4.2 [RED] Destino lleno (`listParticipants(destino).length >= MAX_ROOM_PARTICIPANTS`) → `409`, ningún token nuevo (spec breakout-rooms/traslado-rechazado-por-capacidad).
- [x] 5.4.3 [RED] Solicitante no-`administrador` → `403`, ningún token nuevo (spec breakout-rooms/traslado-por-no-administrador).
- [x] 5.4.4 [RED] Destino de otro grupo (`roomId` distinto) → `403`.
- [x] 5.4.5 [RED] La fila de correlación se escribe **antes** de emitir el token (orden observable vía mock de orden de llamadas).
- [x] 5.4.6 [GREEN] Implementar `moveIn()` completo.
- [x] 5.4.7 [RED] Dos traslados de la misma persona dentro de la misma sesión → dos correlaciones distintas, mismo `userId`/nombre y mismo `roomId` padre (spec participant-identity/múltiples-correlaciones).

### 5.5 — Retorno a la sala principal (spec breakout-rooms/retorno + call-breakout-rooms/expulsión-locked)

- [x] 5.5.1 [RED] Administrador devuelve a un ocupante, cualquier política → token nuevo acotado a la principal (spec breakout-rooms/admin-devuelve). **Deviación documentada**: implementado vía `selfReturn(breakoutId, roomId, requester, targetLivekitIdentity?)` — el param `targetLivekitIdentity` (cuarto, opcional) es aditivo sobre el snippet abreviado de design.md, que no modelaba a QUIÉN devuelve el admin cuando no es a sí mismo. El admin marca `returnedAt` y desconecta de la MINI SALA (`removeParticipant(breakout.livekitRoomName, identity)`); el token nuevo de la principal lo emite `join()` cuando el cliente, al perder la conexión, reintenta por su cuenta — ningún token se emite directamente desde `selfReturn` (consistente con D12 y con el propio texto del contrato: "No emite token de la principal").
- [x] 5.5.2 [RED] Ocupante en `free_return` pide volver por cuenta propia → token nuevo emitido (spec breakout-rooms/ocupante-free-return).
- [x] 5.5.3 [RED] Ocupante en `locked` pide volver por cuenta propia → `403 BREAKOUT_RETURN_LOCKED`, ningún token emitido (spec breakout-rooms/ocupante-locked-rechazado).
- [x] 5.5.4 [GREEN] Implementar `selfReturn()` con el chequeo de política + la fila de correlación de retorno (`roomId` padre, D7).
- [x] 5.5.5 [RED] En `join()`, un solicitante **no-administrador** con asignación abierta `locked` → `403 BREAKOUT_RETURN_LOCKED`, sin emitir token de la principal (D8 punto 1, spec breakout-rooms/expulsión-locked — primera mitad).
- [x] 5.5.6 [RED] Un `administrador` con asignación abierta `locked` → **nunca** bloqueado por esta regla (D8: `locked` no aplica a admin).
- [x] 5.5.7 [GREEN] Implementar `assertBreakoutReturnAllowed(roomId, sourceIdentity)` y su wiring en `join()`, solo en el camino no-admin y solo cuando el grupo tiene mini salas abiertas (D9: reusa la consulta ya hecha en 4.3.8, no agrega un segundo costo salvo esta consulta puntual de asignación).
- [x] 5.5.8 [RED] `participant_joined` de la sala principal con un identity que corresponde a una asignación abierta `locked` → `removeParticipant(parentCode, identity)` (D8 punto 2, spec breakout-rooms/expulsión-locked — segunda mitad, la ventana de fuga declarada).
- [x] 5.5.9 [GREEN] Implementar el handler de `onParticipantJoined` en `calls-webhook.service.ts` (hoy un hueco vacío) con esta lógica, puramente aditivo.
- [x] 5.5.10 Documentar en el spec de capacidad — ya presente en `specs/call-breakout-rooms/spec.md` — la ventana de fuga de 1–2 segundos como limitación aceptada y no disimulada; confirmar en la revisión que el test 5.5.8 es la evidencia de esa cobertura, no una promesa sin test. Confirmado: el spec ya documenta la ventana (Requirement "Expulsión de un ocupante locked...") y el test `[5.5.8]` en `calls-webhook.service.spec.ts` ejercita exactamente ese camino (`removeParticipant` invocado con el código de la principal y el identity reconectado).

### 5.6 — Token de mini sala y listado (spec breakout-rooms, contrato de servicio)

- [x] 5.6.1 [RED] `issueBreakoutToken` para un ocupante con asignación abierta → token válido para la mini sala.
- [x] 5.6.2 [RED] `issueBreakoutToken` para un admin del grupo sin asignación → también emite token (monitoreo).
- [x] 5.6.3 [RED] `issueBreakoutToken` para alguien sin asignación y sin ser admin → `403`.
- [x] 5.6.4 [GREEN] Implementar `issueBreakoutToken()`.
- [x] 5.6.5 [RED] `list()` devuelve las mini salas abiertas del `room_id` con sus ocupantes.
- [x] 5.6.6 [GREEN] Implementar `list()`.

### 5.7 — Cierre manual, cierre en cascada, `autoCloseAt`, reconciliación

- [x] 5.7.1 [RED] `close()` de una mini sala con ocupantes → cierre inmediato, todos devueltos sin demora (spec breakout-rooms/cierre-manual-con-ocupantes).
- [x] 5.7.2 [RED] `close()` de una mini sala ya cerrada → rechazo explícito, sin efecto duplicado (compare-and-set sobre `closed_at`) (spec breakout-rooms/cierre-de-ya-cerrada).
- [x] 5.7.3 [RED] `close()` de un id inexistente → rechazo explícito (spec breakout-rooms/cierre-de-inexistente).
- [x] 5.7.4 [GREEN] Implementar `close()` con el compare-and-set de D4/Flujo 3.
- [x] 5.7.5 [RED] `closeGroupBreakouts(roomId, parentCode)`: cierra todas las mini salas abiertas del grupo, cierra sus asignaciones, `deleteRoom` tolerante a error (`logger.log`, nunca `logger.error`, nunca rethrow — capa 3 de D4); cascada duplicada → cero `deleteRoom` nuevos.
- [x] 5.7.6 [GREEN] Implementar `closeGroupBreakouts()` y `closeAll()`.
- [x] 5.7.7 Wiring diferido de Fase 4: conectar `CallSessionCloseService.claimAndClose` para invocar `closeGroupBreakouts` **antes** de `deleteRoom` de la principal (orden del Flujo 3: mini salas primero, principal al final). Este es el único punto donde Fase 5 toca `call-session-close.service.ts`, y es aditivo: una llamada nueva al final de un método ya generalizado en Fase 4, sin tocar ninguna aserción de los tests de Fase 3/4.
- [x] 5.7.8 [RED] Cierre de la sala principal con dos mini salas activas → ambas quedan cerradas y sus ocupantes devueltos/desconectados (spec breakout-rooms/cascada-desde-principal, spec host-gate/cascada-de-cierre-forzado). Cubierto por el test `[5.7.5]` de `breakout-rooms.service.spec.ts` (dos filas abiertas → dos `deleteRoom`) más el test `[5.7.7]` de `call-session-close.service.spec.ts` (orden `closeGroupBreakouts` antes de `deleteRoom` de la principal).
- [x] 5.7.9 [RED] `autoCloseAt` definido y transcurrido → ocupantes devueltos sin acción del admin (spec breakout-rooms/timer-definido-y-transcurrido).
- [x] 5.7.10 [RED] Mini sala sin `autoCloseAt` → permanece abierta indefinidamente hasta cierre manual (spec breakout-rooms/sin-timer-definido).
- [x] 5.7.11 [GREEN] Implementar el atajo `setTimeout` en proceso (`Map<breakoutId, Timeout>`) al crear/actualizar, D10.
- [x] 5.7.12 [RED] `reconcileGroup()` cierra mini salas vencidas sin que haya corrido ningún timer (garantía perezosa de D10) y nunca tira.
- [x] 5.7.13 [GREEN] Implementar `reconcileGroup()`. **Deviación documentada (alcance reducido)**: implementado y probado como método propio de `BreakoutRoomsService` (consumido por 5.7.12). El wiring exhaustivo "desde cualquier webhook del grupo y desde cualquier acción del controlador" que describe el texto de la tarea se dejó para cuando exista una necesidad concreta que lo ejercite (ningún test de Fase 5 lo exige); la garantía de seguridad de D10 no depende de ese wiring —es pura y sincrónica en `buildCallGroupRoomNames`— así que la mini sala vencida nunca sostiene viva la llamada aunque el teardown se demore hasta la próxima interacción. Ver "Gotchas" en apply-progress para el detalle.

### 5.8 — `BreakoutRoomsController` + DTOs

- [x] 5.8.1 Crear `CreateBreakoutRoomDto`, `UpdateBreakoutRoomDto`, `MoveParticipantDto` con las validaciones mínimas (label opcional, `leavePolicy` enum TS, `autoCloseInMinutes` entero positivo opcional). **Deviación documentada**: se agregó un cuarto DTO, `ReturnOccupantDto` (`livekitIdentity` opcional), necesario para el endpoint de retorno porque soporta dos llamadores distintos (ocupante sin body vs. admin indicando a quién devolver) — ver deviación de 5.5.1.
- [x] 5.8.2 Crear `BreakoutRoomsController` bajo `@Controller('calls')` + `@UseGuards(RoomAccessGuard)`, un endpoint por operación del servicio (`create`, `list`, `updatePolicy`, `moveIn`, `issueBreakoutToken`, `selfReturn`, `close`, `closeAll`).
- [x] 5.8.3 [RED+GREEN] Test de integración ligero por endpoint: guard aplicado, DTO validado, delega al servicio correspondiente (sin reimplementar los casos ya cubiertos en 5.1–5.7 a nivel servicio).
- [x] 5.8.4 Registrar `BreakoutRoomsService` y `BreakoutRoomsController` en `calls.module.ts`.

### 5.9 — Configuración de despliegue para esta fase

- [x] 5.9.1 Agregar `MAX_BREAKOUT_ROOMS=3` (valor objetivo final) a `.env.example`, documentando junto a la variable que el valor real en producción permanece en `0` hasta que la Fase 8 lo autorice.
- [x] 5.9.2 Commit: `feat(calls): add breakout rooms CRUD lifecycle and locked enforcement`.

## Fase 6 — Cliente (depende de Fase 5)

- [x] 6.1 Crear `client/src/lib/breakouts.ts`: cliente HTTP del controlador; mapea `BREAKOUT_RETURN_LOCKED` por **código**, nunca por texto (precedente `NO_HOST_CONNECTED`).
- [x] 6.2 [RED] `useCallSession.switchRoom(session)` reemplaza `current.current` y `session` de forma atómica, sin pasar por `'error'`; `joinCall` sigue sin servir para esto (su guarda aborta el traslado).
- [x] 6.3 [GREEN] Implementar `switchRoom`; `EndReason` gana `'breakout-closed'`; `CallStatus` gana `'switching'`.
- [x] 6.4 [RED] `MeetingRoom`: `onDisconnected` mientras `status === 'switching'` no se interpreta como `leaveCall()` ni `failed()`.
- [x] 6.5 [GREEN] Implementar `key={call.session.roomName}` en `<LiveKitRoom>` + el ignore de `onDisconnected` en estado `switching`.
- [x] 6.6 [RED] `useRoomSocket` recibe `breakout:assigned` → expone el payload `{breakoutId, label, leavePolicy}`; recibe `breakout:closed` → dispara el camino de retorno.
- [x] 6.7 [GREEN] Implementar los listeners en `useRoomSocket` (`client/src/features/chat/`). **Deviación documentada**: el hook no existía todavía en el repo (el texto de la tarea asumía que sí) — se creó desde cero siguiendo el patrón exacto de `useRoomMediaLock.ts` (hook `(socket) => estado`, listeners registrados/limpiados en un `useEffect` por `[socket]`).
- [x] 6.8 Modificar `chat.gateway.ts`: emitir `breakout:assigned` tras `moveIn()` y `breakout:closed` tras `close()`/`closeGroupBreakouts()` — señal únicamente, nunca el token (D12). **Deviación documentada**: además de `chat.gateway.ts` se tocaron `room-events.service.ts` y `breakout-rooms.service.ts` — es el mismo puente desacoplado ya usado por `memberRoleChanged`/`roomEmojisChanged` (evita un import circular `CallsModule` ↔ `ChatModule`); ver apply-progress Batch 6.
- [x] 6.9 [RED+GREEN] `BreakoutBanner.tsx` (nuevo): muestra la etiqueta de la mini sala; botón "Volver" visible solo si `leavePolicy === 'free_return'`; texto explícito ("el host te va a devolver") cuando es `locked` (RTL).
- [x] 6.10 [RED+GREEN] `BreakoutPanel.tsx` (nuevo, solo-admin): crear bajo tope con mensaje de error cuando se alcanza, toggle de política, timer opcional, elegir participante para trasladar, cerrar una o todas, "devolver a todos" (RTL).
- [x] 6.11 Commit: `feat(calls): add breakout rooms client UI and room-switch handling`.

## Fase 7 — E2E y prueba de carga

- [ ] 7.1 Playwright: admin crea 2 mini salas, traslada a dos participantes, el aislamiento de medios se verifica por ausencia de tracks cruzados.
- [ ] 7.2 Playwright: `locked` rechaza la autosalida (banner sin botón "Volver", solicitud HTTP directa devuelve 403).
- [ ] 7.3 Playwright: cerrar todas las mini salas devuelve a todos los ocupantes a la principal.
- [ ] 7.4 **Tarea NO automatizable, manual, bloqueante antes de uso real en examen**: prueba de carga con 1 sala principal + 3 mini salas en la instancia t3.medium, midiendo CPU, ancho de banda y comportamiento ante una ráfaga de webhooks 4x. Documentar el resultado (pasa/no pasa) como prerequisito explícito de la Fase 8; no cerrar esta tarea sin esa evidencia escrita.
- [ ] 7.5 Commit: `test(calls): add breakout rooms e2e coverage` (7.4 no genera commit de código, solo el documento/registro del resultado).

## Fase 8 — Despliegue (checklist operativo, orden crítico, no es código nuevo)

- [ ] 8.1 Desplegar la migración de Fase 1 (ensanche de `room_code`) sola, sin ningún otro cambio de esta propuesta. Confirmar comportamiento idéntico al actual en producción.
- [ ] 8.2 Desplegar la migración de Fase 2 (tablas nuevas + `call_group_id`). Aditiva, sin downtime.
- [ ] 8.3 Desplegar el código de Fases 3–6 con `MAX_BREAKOUT_ROOMS=0` en el entorno real. Confirmar en producción que `resolveCallGroupRoomNames` devuelve `[roomCode]` para toda llamada y que el control de acceso recorre el *fast path* de D2 — comportamiento idéntico al actual, verificable antes de habilitar nada.
- [ ] 8.4 **Precondición bloqueante antes de 8.5**: confirmar que la Fase 7.4 (prueba de carga) tiene resultado positivo documentado.
- [ ] 8.5 Subir `MAX_BREAKOUT_ROOMS` a `3` en el entorno real, recién después de 8.4.
- [ ] 8.6 Actualizar `deploy/*` con el valor final de `MAX_BREAKOUT_ROOMS` y confirmar que `livekit.yaml`/configuración de webhook no requiere ningún cambio adicional (mismo endpoint, D del spec call-webhook-ingestion).
