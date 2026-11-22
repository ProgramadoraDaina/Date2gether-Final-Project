# Apply progress: breakout-rooms

## Batch 1 — Fase 1 (migración: ensanche de `room_code`)

Estado: **completa**. Tareas 1.1, 1.2, 1.3 marcadas `[x]` en `tasks.md`.

### Qué se hizo

- **1.1** — `src/db/schema.ts`: `callEvents.roomCode` y `callSessions.roomCode` pasaron de `varchar(20)` a `varchar(40)`. Ninguna otra columna ni tabla tocada.
- **1.2** — Migración generada con:
  ```
  DATABASE_URL="postgresql://date2gether:date2gether@localhost:5432/date2gether" pnpm drizzle-kit generate --name widen_room_code
  ```
  Archivo generado: **`drizzle/0022_widen_room_code.sql`**. Contenido confirmado — únicamente dos `ALTER COLUMN ... SET DATA TYPE varchar(40)`, sin reescritura de tabla:
  ```sql
  ALTER TABLE "call_events" ALTER COLUMN "room_code" SET DATA TYPE varchar(40);--> statement-breakpoint
  ALTER TABLE "call_sessions" ALTER COLUMN "room_code" SET DATA TYPE varchar(40);
  ```
- **1.3** — Migración aplicada contra la base de **desarrollo** (`docker-compose.yml`, contenedor `date2gether-postgres`, puerto 5432) vía `pnpm drizzle-kit migrate`. También aplicada contra la base **de test** (`docker-compose.test.yml`, puerto 5433) vía `pnpm test:e2e:setup`, porque `pnpm test` corre specs de integración (`*.integration.spec.ts`, `room-resolver.rolling-window.spec.ts`, `migration-0016-rollback.integration.spec.ts`) contra Postgres real en esa base — sin este paso, `pnpm test` falla por `ECONNREFUSED :5433`, no por la migración en sí (gotcha de entorno, no regresión).

  Resultado de `pnpm test` (vitest) tras aplicar ambas migraciones:
  ```
  Test Files  56 passed (56)
       Tests  392 passed (392)
  ```
  Ningún `expect` existente cambió. No hubo que tocar ningún test.

### Gotchas confirmados / nuevos para las próximas fases

- `drizzle-kit` ignora `DATABASE_URL` del `.env` — hay que pasarlo inline en el comando (ya documentado en el proyecto, reconfirmado acá).
- Docker Desktop no estaba corriendo al empezar este lote; hubo que iniciarlo (`C:\Users\Usuario\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`) antes de poder levantar contenedores.
- `pnpm test` depende de **dos** Postgres distintos corriendo en simultáneo: el de desarrollo (5432, `docker-compose.yml`) para scripts manuales de drizzle, y el disponible/descartable de test (5433, `docker-compose.test.yml`) para los specs de integración de vitest. Antes de cualquier lote que corra `pnpm test` con specs de integración, asegurarse de que **ambos** estén arriba y que el de test tenga las migraciones nuevas aplicadas vía `pnpm test:e2e:setup` (no solo `pnpm test:e2e:db:up`).

### Próximo lote: Fase 2

Fase 2 (tareas 2.1–2.5) depende de esta fase y queda pendiente: tablas `call_breakout_rooms` y `call_breakout_occupants` + columna `call_sessions.call_group_id`, nueva migración `drizzle/00XX_breakout_rooms.sql`, aplicar en desarrollo (y en la base de test, mismo patrón que arriba) y confirmar `pnpm test` sin regresiones.

No se tocó ningún archivo de Fase 2 en adelante.

## Batch 2 — Fase 2 (migración: tablas de mini sala + `call_group_id`)

Estado: **completa**. Tareas 2.1, 2.2, 2.3, 2.4, 2.5 marcadas `[x]` en `tasks.md`.

### Qué se hizo

- **2.1 / 2.2 / 2.3** — `src/db/schema.ts`: agregadas las tablas `callBreakoutRooms` (`call_breakout_rooms`) y `callBreakoutOccupants` (`call_breakout_occupants`) con exactamente las columnas e índices de D4/D5 del diseño (incluyendo los dos índices parciales `where returned_at is null` de D5.1), más sus `relations` y tipos `$inferSelect`/`$inferInsert` siguiendo el mismo patrón que el resto del archivo (ver bloque "Mini salas dentro de una llamada" agregado justo antes de `callParticipantIdentitiesRelations`). `call_sessions` ganó la columna `callGroupId: varchar('call_group_id', { length: 64 })` nullable, sin default, sin backfill. Ninguna otra tabla ni columna existente tocada.
- **2.4** — Migración generada con:
  ```
  DATABASE_URL="postgresql://date2gether:date2gether@localhost:5432/date2gether" pnpm drizzle-kit generate --name breakout_rooms
  ```
  Archivo generado: **`drizzle/0023_breakout_rooms.sql`**. Contenido confirmado — dos `CREATE TABLE` (`call_breakout_occupants`, `call_breakout_rooms`) con sus `UNIQUE`/FK constraints, un `ALTER TABLE "call_sessions" ADD COLUMN "call_group_id" varchar(64)` (nullable, sin default) y tres `CREATE INDEX` (dos parciales sobre `call_breakout_occupants`, uno compuesto sobre `call_breakout_rooms`). Ninguna tabla existente se reescribe ni pierde datos.
- **2.5** — Migración aplicada contra la base de **desarrollo** (puerto 5432) vía `pnpm drizzle-kit migrate`, y contra la base de **test** (puerto 5433) vía `pnpm test:e2e:setup` (Docker Desktop ya estaba corriendo al empezar este lote, los dos contenedores — `date2gether-postgres` y `date2gether-postgres-test` — ya estaban `Up`). `pnpm test` corrido completo después:
  ```
  Test Files  56 passed (56)
       Tests  392 passed (392)
  ```
  Ningún `expect` existente cambió — tablas nuevas sin ningún código de producción que las use todavía, exactamente como esperaba el forecast de la fase.

### Gotchas nuevos para las próximas fases

- Postgres truncó silenciosamente el nombre del FK constraint `call_breakout_occupants_breakout_room_id_call_breakout_rooms_id_fk` (69 caracteres, supera el límite de 63 de un identifier) a `call_breakout_occupants_breakout_room_id_call_breakout_rooms_id`, emitiendo un `NOTICE` (no un error) en ambas bases. No afecta la migración ni el funcionamiento — Drizzle no referencia constraints de FK por nombre en runtime — pero si una fase futura necesita referenciar este constraint por nombre exacto (p. ej. en un `DROP CONSTRAINT` manual), hay que usar el nombre truncado, no el que aparece en el SQL generado por drizzle-kit.
- Confirmado nuevamente el patrón de Fase 1: con ambos Postgres (5432 y 5433) ya levantados por un lote anterior, este lote no necesitó reiniciar Docker Desktop — alcanzó con `pnpm test:e2e:setup` para llevar las migraciones nuevas a la base de test.

### Próximo lote (histórico): Fase 3

Fase 3 (tareas 3.1–3.13, TDD estricto) depende de esta fase y queda pendiente: tests de caracterización C1–C9 sobre `assertHostConnected`/`hasConnectedAdmin` antes de tocarlos, más el arranque de `call-group.ts` (caso degenerado de `buildCallGroupRoomNames`). No se tocó ningún archivo de Fase 3 en adelante — `call_breakout_rooms`/`call_breakout_occupants` no tienen todavía ningún consumidor en código de producción.

## Batch 3 — Fase 3 (tests de caracterización C1–C9, retroactivo)

Estado: **completa**. Tareas 3.1–3.13 marcadas `[x]` en `tasks.md`. Esta entrada se agrega retroactivamente: el trabajo ya estaba hecho y verificado en una sesión anterior a este lote de apply-progress, que solo documentaba hasta Fase 2. Confirmado en esta sesión corriendo `pnpm test src/modules/calls/call-group.spec.ts src/modules/calls/calls.service.spec.ts src/modules/calls/call-session-close.service.spec.ts` → 58/58 en verde antes de empezar la Fase 4.

### Qué se hizo

- **3.1/3.2** — Confirmados en verde, sin tocar ninguna aserción, los 7 casos existentes de `describe('CallsService: gate de administrador (host-gate)')` y los 11 casos existentes de `call-session-close.service.spec.ts`.
- **3.3–3.9** — Agregados los casos de caracterización C1–C7 (`calls.service.spec.ts` y `call-session-close.service.spec.ts`): cardinalidad de `listParticipants`/`deleteRoom`, filtro exacto de la consulta a `call_participant_identities`, cortocircuito de administrador, comportamiento actual de `hasConnectedAdmin` sin filtro de `roomId`, las tres ramas de `hasConnectedAdmin`, y el uso literal de `roomCode`/`livekit_room_sid` en `onAdminLeft`/`claimAndClose`.
- **3.10/3.11** — Creado `src/modules/calls/call-group.spec.ts` (caso degenerado C8) y `src/modules/calls/call-group.ts` con la firma mínima de `buildCallGroupRoomNames`, `OpenBreakout`, `BREAKOUT_NAME_SEPARATOR` que satisface solo ese caso (el resto de D1 quedó explícitamente diferido a Fase 4, con un `throw` para el camino no degenerado).
- **3.12** — Agregado C9 en `calls.service.spec.ts`: con cero filas en `call_breakout_rooms`, un no-admin produce la misma secuencia de llamadas a LiveKit que antes del cambio — ancla de regresión para la Fase 4.
- **3.13** — Commit de caracterización ya aplicado antes de este lote.

### Gotchas

- Ninguno nuevo más allá de los ya documentados en Batch 1/2 (Docker Desktop, `drizzle-kit` y `DATABASE_URL` inline, necesidad de los dos Postgres arriba para `pnpm test`).

### Próximo lote: Fase 4

Fase 4 (control de acceso a nivel grupo) depende de esta fase y queda pendiente al cierre de este batch histórico — ver Batch 4 más abajo, que ya la completa.

## Batch 4 — Fase 4 (control de acceso a nivel grupo, commit aislado)

Estado: **completa**. Tareas 4.1.1–4.9.3 marcadas `[x]` en `tasks.md`.

### Qué se hizo

- **4.1** — Completado `src/modules/calls/call-group.ts`: `buildCallGroupRoomNames` ahora implementa el filtro completo de D1 (mini salas abiertas incluidas en orden estable con la principal primero; `autoCloseAt <= now` excluida de `names` e incluida en `expired`; una mini sala ya cerrada nunca llega a esta función porque el llamador solo le pasa abiertas). Agregadas `buildBreakoutRoomName`, `parseBreakoutRoomName` (regex `^breakout-(\d+)$` sobre el sufijo) e `isBreakoutRoomName`. Tests nuevos en `call-group.spec.ts` (4.1.1–4.1.6), 11/11 en verde.
- **4.2** — Creado `src/modules/calls/call-group-resolver.service.ts` (`CallGroupResolverService`): `resolveCallGroupRoomNames(roomId, roomCode)` (roomId `null` degenera a `[roomCode]` sin consultar nada; con roomId consulta `call_breakout_rooms` por `room_id` + `closed_at IS NULL` y delega el armado de la lista a `buildCallGroupRoomNames`), `resolveGroupAnchor(sid, roomCode)` (código sin `::` → self, cero consultas; con `::` resuelve `livekit_room_name` → `parent_livekit_room_sid`; sin match conocido → degrada a self, igual que un código sin grupo — decisión explícita para que "sin efecto de negocio" sea el mismo camino en ambos casos), `findExpiredBreakouts(roomId)`. Registrado como provider en `calls.module.ts`. Spec nuevo `call-group-resolver.service.spec.ts`, 7/7 en verde.
- **4.3** — `CallsService.assertHostConnected` cambió de firma: de `(client, roomCode, roomId)` a `(client, groupRoomNames: string[], roomId)`. Con `groupRoomNames.length === 1` corre el *fast path* literal de D2 (factored a `listRoomParticipantIdentities`, código idéntico al de antes del cambio). Con más de un nombre, corre el camino nuevo D3 (`listGroupParticipantIdentities`: `listRooms` para existencia, `listParticipants` solo sobre las existentes, unión de identities). El cruce contra `call_participant_identities` (filtro por `roomId` + `roleAtIssue='administrador'`) se factoreó a `hasAdminAmongIdentities`, compartido por ambos caminos, sin cambiar el orden de las condiciones del `and(...)` que C2 fija. `join()` ahora resuelve `groupRoomNames = await this.groupResolver.resolveCallGroupRoomNames(room.id, roomCode)` **antes** de `assertHostConnected`, solo en el camino no-admin. Inyectado `CallGroupResolverService` como quinto parámetro del constructor de `CallsService`. En `calls.service.spec.ts` se agregó un `groupResolver` mockeado (default: `[room.code]`, degenerando exactamente al camino de hoy) a los 7 `beforeEach` existentes, sin tocar ningún `expect` preexistente; se agregaron 8 tests nuevos (4.3.3–4.3.9, 4.3.8 x2, 4.8) para el camino multi-sala y la confirmación de wiring. Los C1/C2/C3/C9 de Fase 3 quedaron en verde sin modificar ninguna aserción.
- **4.4** — `CallSessionCloseService` generalizado a grupo: `hasConnectedAdmin(roomCode, roomId = null)` ahora resuelve `groupRoomNames` vía `CallGroupResolverService.resolveCallGroupRoomNames` y delega la obtención de identities conectadas a `listGroupIdentities` (mismo D2/D3 que `CallsService`, pero usando `this.client` propio en vez de recibirlo por parámetro). El filtro por `roomId` en la consulta a `call_participant_identities` solo se agrega cuando `groupRoomNames.length > 1` — con un solo nombre el comportamiento es *bit a bit* el que C4 fija (sin ese filtro). `onAdminLeft(livekitRoomSid, roomCode, roomId = null)` ganó el parámetro `roomId` y ahora empieza resolviendo `anchor = await this.groupResolver.resolveGroupAnchor(livekitRoomSid, roomCode)`; `pendingCloses` se reindexa por `anchor.parentSid` (no por el sid de la sala donde ocurrió el `participant_left`), y `recheckAndClose`/`claimAndClose` se invocan con `anchor.parentCode`/`anchor.parentSid`. `claimAndClose` ganó el tercer parámetro `roomId` (no usado todavía — `// TODO(Fase 5): invocar closeGroupBreakouts` documentado explícitamente antes del `deleteRoom` de la principal). Inyectado `CallGroupResolverService` como tercer parámetro del constructor. En el spec se agregó un `groupResolver` mockeado con comportamiento degenerado por defecto (fast path + ancla = self) a los tests existentes, sin tocar ningún `expect` de C4–C7 ni de los 11 casos preexistentes; se agregaron 4 tests nuevos (4.4.1, 4.4.3, 4.4.4, 4.4.6).
- **4.4.8** — `CallsWebhookService.onParticipantLeft` ahora selecciona también `roomId` de la misma fila de `call_participant_identities` que ya consultaba (sin consulta nueva) y lo pasa como tercer argumento a `closeService.onAdminLeft`. Esto obligó a actualizar el `expect` de un test existente en `calls-webhook.service.spec.ts` (`toHaveBeenCalledWith('RM_session-A', 'abc-defg-hij')` → con el tercer argumento `roomId` agregado) — justificado explícitamente: el archivo no está en la lista protegida de la tarea (solo `calls.service.spec.ts`/`call-session-close.service.spec.ts` lo están) y el cambio de firma es exactamente lo que 4.4.8 pide.
- **4.5/4.6** — Implementados juntos en `CallsWebhookService.onRoomFinished`, dentro de la misma transacción: si `parseBreakoutRoomName(roomCode)` no es `null` (el `roomCode` del evento tiene forma de mini sala), se consulta `call_breakout_rooms.livekit_room_name = roomCode` dentro del `tx` para obtener `parent_livekit_room_sid`; si no hay `::` en el código, **cero** consultas nuevas (D6). Si no hay match (grupo desconocido), `callGroupId` degrada a `null` — mismo tratamiento que una sala sin mini salas, sin efecto de negocio distinto (spec webhook-ingestion/roomCode-sin-grupo). El resultado se pasa como `callGroupId` al `insert` de `call_sessions` que ya existía (sin escritura adicional). El log crudo (`toEventRow`, en `handle()`) sigue guardando el `roomCode` tal cual lo mandó LiveKit — D6: el log nunca se reescribe. Tests nuevos: 3 para atribución/fallback (4.5.1–4.5.3) + 2 para el campo `callGroupId` en la fila materializada (4.6.1/4.6.2), todos en el describe de materialización de `calls-webhook.service.spec.ts`, extendiendo `createMaterializationTxMock` con un `breakoutRows` opcional (default `[]`).
- **4.6.4** — Confirmado por regresión pasiva: `call-timeline.service.ts` (el modelo de lectura) no se tocó en esta fase y su spec preexistente sigue en verde sin cambios — el modelo de lectura sigue devolviendo el resumen por sesión individual, sin ningún consumidor de `callGroupId` todavía.
- **4.7** — `RoomResolverService` ganó `assertResolvableCode(code)` (privado), invocado al inicio de `resolveJoinable`, `lockJoinable` y `findPoolOccupant`: si `isBreakoutRoomName(code)` (importado de `call-group.ts`), lanza `NotFoundException` con el mismo mensaje que un código inexistente — 404, no 400 (D11: no revela el esquema interno de nombres). 3 tests nuevos en `room-resolver.service.spec.ts` confirman el 404 y que `db.select` nunca se invoca para un código con `::`.
- **4.8** — Agregado un test de regresión explícito en `calls.service.spec.ts` (describe de host-gate) que fija que el filtro `eq(callParticipantIdentities.roomId, roomId)` sigue intacto sobre una identity hipotética de mini sala (mismo `roomId` que la principal, por anticipación a D7/Fase 5) — sin necesidad de que `BreakoutRoomsService` exista todavía.
- **4.9.1** — `pnpm test`: 437/437 en verde (58 archivos). `pnpm build` (`nest build`): sin errores. `pnpm lint`: 17 errores + 1 warning preexistentes, en 6 archivos que esta fase no modifica en ningún punto relevante a esos errores (`db/migration-0016-rollback.integration.spec.ts`, `modules/auth/auth.service.spec.ts`, `modules/calls/calls-webhook.controller.ts`, `modules/rooms/room-admission.service.spec.ts`, `modules/rooms/rooms.service.spec.ts`, y líneas de `calls.service.spec.ts`/`calls-webhook.service.spec.ts`/`room-resolver.service.spec.ts` que ya existían antes de esta sesión) — confirmado comparando contra `main` que el patrón exacto (`jest.fn/vi.fn` callbacks sin tipar devolviendo `any`) ya existía en esas líneas antes de esta rama. Ningún error nuevo introducido por Fase 4. Ver "Gotchas" abajo sobre el efecto secundario de `--fix` en archivos no relacionados.
- **4.9.2** — Confirmado: `git diff --stat` del commit de esta fase solo toca `drizzle/meta/_journal.json`, `src/db/schema.ts` (ambos de Fase 1/2, ya en el árbol de trabajo antes de este batch), y los 9 archivos de producción/test de Fase 4 (`call-group.ts`, `call-group.spec.ts`, `call-group-resolver.service.ts`, `call-group-resolver.service.spec.ts`, `calls.module.ts`, `calls.service.ts`, `calls.service.spec.ts`, `call-session-close.service.ts`, `call-session-close.service.spec.ts`, `calls-webhook.service.ts`, `calls-webhook.service.spec.ts`, `room-resolver.service.ts`, `room-resolver.service.spec.ts`). Ningún archivo de `BreakoutRoomsService`, `BreakoutRoomsController`, DTOs de mini sala, ni cliente aparece — esos no existen todavía en el repo.
- **4.9.3** — Pendiente de que el usuario confirme el commit (el agente de apply no commitea sin instrucción explícita); el mensaje preparado es `feat(calls): generalize host-gate presence evaluation to call groups`.

### Gotchas nuevos para la próxima fase

- **`pnpm lint` (con `--fix`) reformatea archivos no relacionados por el desajuste CRLF/LF del repo en Windows**: al correr `pnpm lint` sobre el código previo a esta fase (por accidente, durante un `git stash`/`git stash pop` de recuperación), ESLint `--fix` tocó `chat.gateway.ts` y dos specs de integración de `rooms` con cambios de formato (wrap de líneas) que no tienen nada que ver con breakout-rooms. Se revirtieron explícitamente esos 3 archivos (`git checkout -- <archivo>`) antes de cerrar el batch para que el diff de Fase 4 quede exactamente acotado. **Para Fase 5**: correr `pnpm lint` SIEMPRE con `git status`/`git diff --stat` inmediatamente después, y revertir cualquier archivo fuera del alcance de la fase antes de commitear.
- **`git stash` + `pnpm lint --fix` en la misma secuencia es peligroso en este repo**: el `--fix` normaliza fin de línea en prácticamente todo el árbol (ruido, sin diff real) pero además reformatea un puñado de archivos con contenido real. Si se necesita stashear durante Fase 5, hacerlo en pasos separados (nunca encadenar `git stash && <algo que pueda escribir archivos> && git stash pop` en un solo comando) para poder inspeccionar el estado intermedio antes de aplicar el pop.
- El commit constraint (aislar Fase 4 de `BreakoutRoomsService`/Controller/DTOs/cliente) se cumple por construcción: ninguno de esos archivos existe todavía en el repo, así que no hay nada que excluir manualmente — Fase 5 es la que introduce el riesgo real de mezclar.
- `resolveGroupAnchor` con un código `::` que no matchea ninguna fila conocida degrada a `{ parentSid: sid propio, parentCode: código propio }` (se trata como si no tuviera grupo) en vez de lanzar o devolver `null` — esta es la decisión concreta que hace que "sin efecto de negocio" (spec webhook-ingestion/roomCode-sin-grupo) sea el MISMO camino de código que un roomCode sin `::`, no una rama especial nueva. Documentarlo si Fase 5 necesita distinguir "grupo desconocido" de "sin grupo" para algún propósito nuevo (hoy no lo necesita).

### TDD Cycle Evidence (Strict TDD activo)

| Tarea | RED | GREEN | REFACTOR |
|---|---|---|---|
| 4.1.1–4.1.3 (`buildCallGroupRoomNames`) | ✅ tests escritos primero en `call-group.spec.ts`, fallaban contra el stub de Fase 3 | ✅ implementación completa en `call-group.ts` | — |
| 4.1.5 (`parseBreakoutRoomName`) | ✅ | ✅ | — |
| 4.2.1–4.2.3 (`resolveCallGroupRoomNames`) | ✅ tests contra `CallGroupResolverService` antes de que existiera el archivo | ✅ | — |
| 4.2.5/4.2.6 (`resolveGroupAnchor`) | ✅ incluye el caso "sin match" (4.5.3) como RED adicional | ✅ | — |
| 4.2.8 (`findExpiredBreakouts`) | ✅ | ✅ | — |
| 4.3.1–4.3.6 (`assertHostConnected` multi-sala) | ✅ 4.3.3–4.3.6 escritos contra la firma nueva antes de implementar D3 | ✅ | ✅ factoreo a `listRoomParticipantIdentities`/`listGroupParticipantIdentities`/`hasAdminAmongIdentities` sin romper C1/C2/C9 |
| 4.4.1, 4.4.3, 4.4.4, 4.4.6 (`CallSessionCloseService`) | ✅ | ✅ | ✅ `listGroupIdentities` extraído, reusa el mismo patrón D2/D3 |
| 4.4.8 (webhook → `roomId`) | ✅ test existente actualizado con justificación explícita | ✅ | — |
| 4.5.1–4.5.3 (atribución webhook) | ✅ | ✅ implementado dentro de `onRoomFinished` | — |
| 4.6.1/4.6.2 (`callGroupId`) | ✅ | ✅ | — |
| 4.7.1 (`RoomResolverService` guard) | ✅ | ✅ `assertResolvableCode` | — |
| 4.8.1 (regresión D7) | ✅ test nuevo, sin depender de Fase 5 | ✅ (ya satisfecho por el código de 4.3, el test solo lo fija) | — |

### Próximo lote: Fase 5

Fase 5 (CRUD/ciclo de vida de mini salas + enforcement de `locked`) depende de esta fase y queda pendiente: `BreakoutRoomsService`/`Controller`/DTOs nuevos, tope `MAX_BREAKOUT_ROOMS`, traslados (`moveIn`), política de salida, cierre manual/cascada/timer, y el único punto donde Fase 5 vuelve a tocar `call-session-close.service.ts` (conectar `claimAndClose` → `closeGroupBreakouts`, aditivo sobre el `TODO` ya dejado en esta fase). No se tocó ningún archivo de Fase 5 en adelante.
