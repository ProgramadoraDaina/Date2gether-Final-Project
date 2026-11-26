# Exploración: breakout-rooms-ux-fix (corrección de auto-traslado + panel unificado de mini salas)

Change de seguimiento sobre `breakout-rooms` (ya en producción). Surge de uso real: la admin reportó que auto-asignarse a una mini sala rompe la llamada, y que la UI de mini salas se ve distinta según el contexto y no muestra quién queda en la sala principal.

## Estado actual (verificado línea por línea, no por inferencia)

**Bug 1 — auto-traslado rompe la llamada:**

- `src/modules/calls/breakout-rooms.service.ts:220-287` (`moveIn`): el chequeo de rol (227-229) solo verifica que el actor sea `administrador`. No hay ninguna comparación entre `target.livekitIdentity` y la identidad del propio actor.
- `client/src/features/calls/BreakoutPanel.tsx:173-184`: el `<select>` "Trasladar a" se arma directo desde el prop `participants`, sin filtrar la identidad local.
- `src/modules/chat/chat.gateway.ts:216-224`: al conectarse, el servidor agrega al cliente a `connectedUsers` ANTES de emitirle `roomUsers` a ese mismo cliente — la lista de presencia que te llega a vos siempre te incluye a vos misma. Si estás sola en la sala principal, sos la única opción del dropdown.
- Al elegirte a vos misma: `breakout-rooms.service.ts:271-283` emite `breakout:assigned` y enseguida llama `this.client.removeParticipant(parentCode, target.livekitIdentity)` — te desconecta por la fuerza de tu propia conexión LiveKit viva en la sala principal.
- Carrera confirmada: `MeetingRoom.tsx:400-417` reacciona al evento de socket pidiendo un token nuevo (`issueBreakoutToken`, viaje HTTP) y recién ahí llama `switchRoom(token)`, que es lo único que pone `call.status` en `'switching'` (`useCallSession.ts:106-114`). El `removeParticipant` forzado por el servidor llega casi instantáneo a la conexión viva, disparando `onDisconnected` (`MeetingRoom.tsx:638`) mientras `call.status` todavía es `'in-call'` — el corte especial para `'switching'` (línea 643) todavía no aplica. La razón de desconexión no matchea ninguno de los casos esperados (644-656) y cae en `else call.failed(new Error('Disconnected'))` (657): sesión nula, error visible de "no se pudo conectar". Segundos después, la promesa pendiente de `issueBreakoutToken().then(switchRoom)` resuelve y te reconecta sola a la mini sala — pero ya hubo un parpadeo de error real, y si la usuaria reacciona a ese error (cuelga, reintenta) la llamada termina de verdad.
- **Dato nuevo, no reportado originalmente**: `removeParticipant` se llama desde TRES lugares, no uno: `moveIn` (línea 283), el "forzar vuelta" del admin en `selfReturn` (`breakout-rooms.service.ts:365`), y `calls-webhook.service.ts:214` (expulsar a quien está `locked` e intenta reconectarse ilegítimamente a la sala principal). La misma carrera de desconexión pega también en el flujo de "admin fuerza la vuelta" de un tercero. Además, el SDK instalado (`client/node_modules/livekit-client/dist/src/room/events.d.ts:36`) ya expone `DisconnectReason.PARTICIPANT_REMOVED` ("fue removido por la API RemoveParticipant") — el caso exacto que falta manejar en `MeetingRoom.tsx`, y hoy no se chequea en ningún lado.
- Tratar `PARTICIPANT_REMOVED` como "nunca es error" no es gratis: taparía también el caso del webhook (expulsión legítima de alguien `locked` que no debería reconectarse) — ese es un trade-off real para la fase de diseño, no un arreglo sin costo.
- `openspec/changes/breakout-rooms/design.md:379-473` (Flujo 1/2) documenta el traslado asumiendo siempre DOS conexiones distintas (`Admin(cliente)` y `Participante(cliente)`); el auto-traslado nunca fue un escenario contemplado. Ni `specs/call-breakout-rooms/spec.md` ni `specs/call-host-gate/spec.md` lo mencionan. No hay ningún test que lo cubra.

**Bug 2 — UI inconsistente / incompleta:**

- El modal de referencia de la usuaria ("Salas para grupos pequeños - No ha iniciado", lista de salas con nombres, botones "Opciones" / "Volver a crear" / "Añadir una sala" / "Abrir todas las salas") **no existe en el código** — es un mockup de referencia (estilo Zoom/Teams), nunca se implementó así acá.
- Lo que hay son dos componentes independientes y mal coordinados en `MeetingRoom.tsx`: `BreakoutPanel` (562-584, popover solo-admin, gateado por `isCurrentUserAdmin`, anclado al dock de controles — no es un modal centrado) y `BreakoutBanner` (478-484, gateado por `visibleBreakoutAssignment`, se muestra cuando la usuaria LOCAL tiene una asignación de mini sala abierta, sin importar si es admin).
- Los dos gates son ortogonales: una admin que termina dentro de su propia mini sala ve AMBOS componentes al mismo tiempo — combinación que nadie más ve. Esto es el "se ve distinto" reportado.
- `client/src/app/room/[code]/page.tsx:298-301` (`breakoutParticipants`) ya deriva de `users` (el mismo estado de presencia de sockets implicado en el bug 1) — los datos de "quién queda en la sala principal" ya existen y se reutilizan para el dropdown de mini salas; no hace falta estado nuevo para mostrarlos.
- Precedente reutilizable ya existente en el código: `page.tsx:951` ya pasa `currentParticipantId={access.participant.sub}` a `PollPanel` para auto-exclusión/auto-resaltado. El mismo patrón (pasar `currentParticipantId` hacia abajo, filtrar en el componente) es el arreglo natural y de bajo esfuerzo para el dropdown de `BreakoutPanel` — no es un idioma nuevo para este código.
- **Requisito nuevo pedido por la usuaria durante la conversación**: poder ver la sala principal con quién quedó ahí (no solo las mini salas) — no existe hoy en ninguna forma.
- **Requisito nuevo pedido por la usuaria**: debería poder auto-unirse a una mini sala por decisión propia (sin que un admin la arrastre), sin necesidad de que haya alguien más en la sala principal — hoy el único camino para terminar en una mini sala es que un admin te mueva vía `moveIn`.

## Áreas afectadas

- `src/modules/calls/breakout-rooms.service.ts` — `moveIn` necesita decisión explícita sobre auto-traslado (bloquear vs. permitir como funcionalidad).
- `client/src/features/calls/MeetingRoom.tsx` — manejo de `onDisconnected` (falta caso `PARTICIPANT_REMOVED`), y los dos gates independientes de `BreakoutPanel`/`BreakoutBanner`.
- `client/src/features/calls/BreakoutPanel.tsx` — filtrado de la identidad local en el dropdown; posible rediseño para mostrar sala principal + mini salas + ocupantes en una vista.
- `client/src/features/calls/useCallSession.ts` — estado `'switching'` y su relación con la carrera de desconexión.
- `src/modules/calls/calls-webhook.service.ts:214` — el otro caller de `removeParticipant` que un fix genérico de `PARTICIPANT_REMOVED` podría afectar sin querer.
- Tests que van a necesitar actualización sin importar qué opción se elija: `breakout-rooms.service.spec.ts` §5.4 (ningún caso cubre `target === actor`), `BreakoutPanel.spec.tsx` (el fixture de `participants` nunca incluye "una misma"), `BreakoutBanner.spec.tsx` (va a necesitar casos nuevos si se fusiona con el Panel), `MeetingRoom.spec.tsx` (solo testea `ROOM_DELETED`/`ROOM_CLOSED` en `onDisconnected`, líneas 538/562 — falta cobertura de `PARTICIPANT_REMOVED`).

## Preguntas de producto abiertas (para `sdd-propose`)

1. **Auto-traslado: ¿se bloquea o se habilita como feature?** La usuaria pidió explícitamente poder meterse sola a una mini sala "sin necesidad de que haya alguien en la sala principal" — esto suena a pedido de funcionalidad (auto-join), no solo "que no rompa". Necesita decisión cerrada porque cambia el modelo de autorización de `moveIn` (hoy solo-admin).
2. **¿El fix de la carrera de desconexión es general o acotado al auto-traslado?** La misma carrera afecta el "forzar vuelta" de un tercero. Arreglar `PARTICIPANT_REMOVED` en general es más valioso pero debe convivir con el caso legítimo de expulsión por política `locked` del webhook — ¿cómo se distinguen en el cliente?
3. **¿Cómo se ve la vista unificada?** ¿Un único panel con sala principal + cada mini sala + ocupantes de cada una (más parecido al mockup de referencia), reemplazando Panel+Banner, o se mantienen como piezas separadas pero con gates mutuamente excluyentes?
4. **¿Quién puede auto-unirse?** ¿Cualquier participante (no solo admin) puede elegir entrar a una mini sala visible, o sigue siendo una acción exclusiva de admin pero ahora también disponible para auto-aplicarse?

## Enfoques

### 1. Guardia simple: bloquear auto-traslado en `moveIn`

- **Mecanismo**: en `moveIn`, rechazar con error claro si `target.livekitIdentity` coincide con la identidad del actor.
- **A favor**: esfuerzo mínimo, elimina el crash reportado de inmediato.
- **En contra**: no resuelve la carrera de desconexión en general (sigue latente para "forzar vuelta" de terceros con jitter de red), y bloquea justo la funcionalidad de auto-join que la usuaria pidió como requisito, no como bug.

### 2. Arreglar la carrera en general + habilitar auto-join

- **Mecanismo**: manejar `DisconnectReason.PARTICIPANT_REMOVED` en `MeetingRoom.tsx:638-657` como "desconexión esperada, no error" cuando corresponde a un traslado en curso (coordinado con el estado `'switching'` o con el evento `breakout:assigned` ya recibido), dejando que el camino de expulsión por `locked` del webhook siga mostrando error. Esto habilita el auto-traslado como código ya soportado, sin el guardia del Enfoque 1.
- **A favor**: resuelve el bug reportado Y el requisito de producto de auto-join en el mismo cambio; también corrige la carrera latente en "forzar vuelta".
- **En contra**: mayor superficie — hay que distinguir con cuidado "me removieron porque me estoy trasladando" de "me removieron porque estoy `locked` y no debía reconectarme", para no tapar un caso de seguridad real.

### 3. Ambos (guardia de defensa en profundidad + arreglo de la carrera)

- Cubre el bug reportado de inmediato y el latente, a costa de algo más de superficie para revisar.

**Nota de encuadre**: dado que la usuaria ya pidió auto-join como requisito explícito, el Enfoque 1 solo no alcanza — como mínimo hace falta el Enfoque 2. El Enfoque 3 es la recomendación natural.

### UI — Fusionar Panel + Banner en una vista coordinada

- **Mecanismo**: un único componente con estados explícitos (no-admin/sin-asignación, admin, ocupante-de-mini-sala, admin-y-ocupante), que muestre en la misma vista la sala principal (ocupantes actuales, reutilizando el estado `users`/`breakoutParticipants` que ya existe) y cada mini sala con sus ocupantes. Filtrar la identidad propia del selector de traslado siguiendo el patrón ya usado en `PollPanel` (`currentParticipantId`).
- **A favor**: no requiere estado nuevo del lado cliente (los datos de presencia ya están), resuelve la inconsistencia de "se ve distinto" y agrega la visibilidad de sala principal pedida, todo en una pasada.
- **En contra**: toca un componente usado por todos los roles — necesita tests nuevos para la matriz de 4 estados, que hoy tiene cobertura cero.

## Riesgos

- Manejar `PARTICIPANT_REMOVED` como "no es error" sin distinguir el origen puede tapar silenciosamente la expulsión legítima de un participante `locked` (`calls-webhook.service.ts:214`) — necesita decisión explícita de diseño, no un efecto colateral implícito.
- Fusionar Panel+Banner toca `isCurrentUserAdmin` y `visibleBreakoutAssignment` al mismo tiempo — matriz de 4 estados sin ningún test hoy.
- Habilitar auto-join cambia el modelo de autorización de `moveIn` (hoy exclusivo de admin) — hay que acotar explícitamente quién puede auto-targetearse y bajo qué política de sala antes de entrar a diseño.

## Recomendación

Avanzar a `sdd-propose` con Enfoque 3 para el backend (guardia + arreglo general de la carrera, distinguiendo traslado de expulsión por `locked`) y la vista unificada para el frontend, incluyendo auto-join como alcance explícito de este change — no tratarlo como "nice to have" separado, ya que la usuaria lo pidió como requisito funcional en la misma conversación donde reportó el bug.
