# Propuesta: breakout-rooms-ux-fix (auto-unirse a mini salas + panel unificado)

## Intención

`breakout-rooms` está en producción y el uso real expuso tres cosas. (1) Auto-trasladarse rompe la llamada: `moveIn` solo valida que el actor sea `administrador` (`breakout-rooms.service.ts:227-229`) y nunca compara el target con la identidad propia, así que el `removeParticipant` forzado (línea 283) corta la conexión viva antes de que el cliente entre en `'switching'`, y `MeetingRoom.tsx:657` muestra un error de "no se pudo conectar" real. La misma carrera existe en "forzar vuelta" (línea 365). (2) La UI de mini salas se ve distinta según el rol: `BreakoutPanel` y `BreakoutBanner` tienen gates ortogonales y una admin dentro de su propia mini sala ve ambos. (3) No hay forma de ver quién quedó en la sala principal, ni de entrar a una mini sala por decisión propia.

## Decisiones de producto cerradas

| # | Decisión |
|---|---|
| 1 | **`joinPolicy` nuevo y distinto de `leavePolicy`**: `'admin_only'` (default) \| `'open'`. Gobierna el movimiento *hacia dentro* por iniciativa propia. `leavePolicy` sigue gobernando la *vuelta* a la principal, sin cambios. Son dos toggles separados. |
| 2 | Con `joinPolicy='open'`, **cualquier** participante puede moverse a **cualquier** mini sala visible, sin requisitos de origen. Con `'admin_only'`, solo el admin traslada — ahora también a sí misma (auto-traslado habilitado para admin). |
| 3 | El panel unificado (principal + ocupantes + cada mini sala + ocupantes) es **solo-admin**. El no-admin ve su propio estado y, si `joinPolicy='open'`, la lista mínima de salas elegibles (etiqueta + ocupación como número, sin roster). Panel y vista no-admin nunca coexisten. |
| 4 | Admin sola que se mueve a una mini sala: se apoya en la lógica de presencia a nivel grupo ya existente (`hasConnectedAdmin`, Flujo 2 de `breakout-rooms/design.md`). **Sin diálogo ni advertencia nueva.** Ver riesgo R1. |
| 5 | La expulsión por `locked` (`calls-webhook.service.ts:214`) debe mostrar un mensaje propio y específico, reutilizando el precedente `BREAKOUT_RETURN_LOCKED_CODE` (`breakout-rooms.service.ts:37-38`). El arreglo de `PARTICIPANT_REMOVED` **no** puede taparla. |

## Alcance

### Dentro de alcance

- **Backend — carrera de `PARTICIPANT_REMOVED`**: los tres callers de `removeParticipant` (`moveIn`, `selfReturn` del admin, expulsión `locked` del webhook) emiten una señal explícita que le dice al cliente *por qué* lo removieron. Una desconexión removida con traslado/vuelta en curso es esperada (no es error); la expulsión `locked` lleva su propio código y mensaje.
- **Backend — `joinPolicy`**: campo nuevo en `call_breakout_rooms`, default restrictivo, mutable por el admin mientras la sala está abierta (mismo patrón que `updatePolicy` para `leavePolicy`). `moveIn` pasa a autorizar por `rol OR (joinPolicy='open' AND target === actor)`.
- **Backend — proyección por rol de `list`**: hoy `list` (`breakout-rooms.service.ts:169`) devuelve rosters completos a cualquier participante. Pasa a devolver roster completo solo al admin y ocupación agregada al resto.
- **Frontend — panel unificado solo-admin** que reemplaza la combinación Panel+Banner, mostrando sala principal con ocupantes (reusando `breakoutParticipants`, `page.tsx:298-301`) y cada mini sala con los suyos, y filtrando la identidad propia del selector con el patrón `currentParticipantId` ya usado en `PollPanel` (`page.tsx:951`).
- **Frontend — vista mínima no-admin** con estado propio ("estás en {sala}") y selector de ingreso solo cuando `joinPolicy='open'`.
- **Frontend — `onDisconnected`** (`MeetingRoom.tsx:638-657`) distingue removido-esperado de expulsado-por-`locked` de fallo real.

### Fuera de alcance (no-goals)

- Monitoreo simultáneo multi-sala del host / N conexiones LiveKit concurrentes ("escuchar" varias mini salas). No fue pedido y sigue cerrado desde `breakout-rooms`.
- Cualquier cambio a la semántica de `leavePolicy`. Se mantiene tal cual; solo se vuelve explícitamente distinta del toggle nuevo.
- Cualquier cambio al tope `MAX_BREAKOUT_ROOMS=3` o a los supuestos de capacidad de la EC2, ya cerrados en `breakout-rooms`.
- Alcance de chat por mini sala, grabación, línea de tiempo fusionada (siguen fuera).

## Capacidades

### Capacidades nuevas

- Ninguna.

### Capacidades modificadas

- `call-breakout-rooms`: `joinPolicy` como campo y toggle del admin; autorización de traslado propio; proyección de `list` por rol; señal explícita de motivo de remoción en traslado y vuelta forzada.
- `call-webhook-ingestion`: la expulsión de un ocupante `locked` reconectado pasa de ser silenciosa a emitir un motivo explícito y consumible por el cliente.
- `call-host-gate`: requisito nuevo fijado por caracterización — una admin que es la única persona del grupo y se traslada a una mini sala no debe sufrir cierre forzado. Sin cambio de implementación esperado.

## Enfoque

Enfoque 3 de la exploración: guardia explícita + arreglo general de la carrera. El motivo de remoción se modela del lado servidor (no se infiere en el cliente desde el estado `'switching'`), porque inferirlo es justo lo que haría indistinguible un traslado legítimo de una expulsión por política. `joinPolicy` reusa el camino de `moveIn` ya probado: cambia solo la autorización, no la mecánica de reemisión de token. El frontend converge en un único componente con cuatro estados explícitos (no-admin sin asignación / no-admin ocupante / admin / admin-ocupante) para eliminar la coexistencia Panel+Banner.

## Áreas afectadas

| Área | Impacto | Descripción |
|---|---|---|
| `src/db/schema.ts` + migración | Modificado | `joinPolicy` en `call_breakout_rooms`, aditivo con default `'admin_only'` |
| `src/modules/calls/breakout-rooms.service.ts` | Modificado | Autorización de `moveIn`, `updatePolicy`, `list` por rol, señal de motivo |
| `src/modules/calls/breakout-rooms.controller.ts` | Modificado | DTOs de `joinPolicy` |
| `src/modules/calls/calls-webhook.service.ts` | Modificado | Señal explícita en la expulsión `locked` (línea 214) |
| `src/modules/rooms/room-events.service.ts` | Modificado | Evento/campo nuevo de motivo de remoción |
| `client/src/features/calls/MeetingRoom.tsx` | Modificado | `onDisconnected` con `PARTICIPANT_REMOVED`; un solo gate de UI |
| `client/src/features/calls/BreakoutPanel.tsx` + `BreakoutBanner.tsx` | Modificado/Removido | Fusión en vista unificada + vista mínima no-admin |
| Tests | Modificado | `breakout-rooms.service.spec.ts` §5.4, `BreakoutPanel.spec.tsx`, `BreakoutBanner.spec.tsx`, `MeetingRoom.spec.tsx`, `calls-webhook.service.spec.ts` |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **R1 — La gracia a nivel grupo puede no cubrir el caso "admin sola"**. Verificación pendiente, no afirmación de seguridad: al removerla de la principal, el grupo queda con cero participantes conectados *en todas las salas* hasta que termine el viaje HTTP de `issueBreakoutToken` + reconexión. `hasConnectedAdmin` devuelve `false` y se agenda el cierre a T+15s; además la principal vacía puede disparar `room_finished` (`calls-webhook.service.ts:150`), que materializa la sesión y cancela el pendiente. | Media | `sdd-design` debe verificar explícitamente ambos caminos con un test de caracterización antes de asumir cobertura. Si la reconexión no cierra dentro de los 15s, hace falta una mitigación explícita. |
| Tratar `PARTICIPANT_REMOVED` como "no es error" tapa la expulsión legítima por `locked` | Media | El motivo viaja desde el servidor con código propio; test obligatorio de que la expulsión `locked` sigue produciendo mensaje visible |
| `joinPolicy='open'` permite saltar entre mini salas en loop y agotar capacidad | Media | La validación de capacidad del destino ya existe (`moveIn`, línea 237); el default restrictivo limita la exposición |
| Fusionar Panel+Banner toca la matriz de 4 estados hoy sin cobertura | Alta | Tests por estado antes del refactor (TDD estricto ya activo) |
| Confundir `joinPolicy` con `leavePolicy` en código, UI o copy | Media | Nombres y textos distintos en el mismo PR; la UI los muestra como dos controles separados y rotulados |

## Plan de rollback

1. **Sin deploy**: el admin deja `joinPolicy` en `'admin_only'` en toda mini sala; el auto-ingreso queda inaccesible y la autorización de `moveIn` degenera a la de hoy más el auto-traslado del admin.
2. **Revert parcial**: el commit del panel unificado se mantiene separado del commit backend, así que se puede revertir solo la UI restaurando Panel+Banner.
3. **Revert completo**: revertir el change y correr el `down`. `joinPolicy` es aditivo con default, así que borrarlo no pierde ningún dato preexistente de mini salas.

## Dependencias

- `breakout-rooms` ya desplegado en producción (lo está desde 2026-11-23), sin cambios de infraestructura ni credenciales nuevas.
- `strict_tdd: true` (`pnpm test`): los tests preceden al código, incluyendo los de caracterización de R1.

## Criterios de éxito

- [ ] Una admin sola en la llamada se traslada a una mini sala y **no** ve ningún error de desconexión; la llamada sigue viva y el grupo no sufre cierre forzado.
- [ ] El "forzar vuelta" de un tercero tampoco muestra error de desconexión.
- [ ] Un ocupante `locked` que se reconecta a la principal es expulsado y ve un mensaje específico de política, no un error genérico ni silencio.
- [ ] Con `joinPolicy='admin_only'` (default), un no-admin no puede moverse a ninguna mini sala: rechazo del lado servidor.
- [ ] Con `joinPolicy='open'`, cualquier participante entra por su cuenta a cualquier mini sala visible, hasta la capacidad del destino.
- [ ] Cambiar `joinPolicy` no altera en nada el comportamiento de `leavePolicy`, y viceversa.
- [ ] El panel completo (principal + ocupantes + mini salas + ocupantes) se renderiza solo para admin; un no-admin nunca recibe rosters por API.
- [ ] En ningún estado de los cuatro se renderizan dos vistas de mini sala a la vez.
- [ ] El selector de traslado nunca ofrece una fila duplicada ni ambigua para la identidad propia.
