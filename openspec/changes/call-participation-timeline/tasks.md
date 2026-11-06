# Tareas: Línea de tiempo de participación en llamadas

## Review Workload Forecast

| Campo | Valor |
|---|---|
| Líneas estimadas de cambio | ~2000–3000 (4 tablas + migración, webhook, gate + cierre forzado, materialización, 2 endpoints, 6 piezas de cliente, tests por cada punto) |
| Riesgo de presupuesto de 400 líneas | High |
| PRs encadenados recomendados | Yes |
| Split sugerido | PR1 → PR2 → PR3 → PR4 → PR5 → PR6 → PR7 (ver Work Units) |
| Estrategia de entrega | ask-on-risk |
| Estrategia de cadena | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

**Por qué es alto**: 4 tablas nuevas + migración, un webhook controller/service nuevo (primer consumidor de webhooks del proyecto), un gate que modifica `join()` (ruta ya en producción), un servicio de cierre idempotente con ventana de gracia y timers, una agregación pura con su propio set de casos borde, dos endpoints de lectura nuevos, y 6 piezas de cliente nuevas/modificadas. Cada bloque tiene su propio set de tests TDD. No es exagerar el pronóstico: es la superficie real del diseño.

**Antes de `sdd-apply`**: el orquestador debe preguntar qué `chain_strategy` usar (`stacked-to-main` o `feature-branch-chain`) — no está decidida.

### Suggested Work Units

| Unit | Objetivo | PR probable | Depende de | Notas |
|---|---|---|---|---|
| 1 | Esquema (4 tablas) + migración + bootstrap `rawBody` (gotcha Content-Type con test) | PR1 | — | Aditivo puro, sin cambio de comportamiento observable |
| 2 | Correlación de identidad en `join()` (upsert, sin gate todavía) | PR2 | PR1 | No cambia quién puede unirse hoy |
| 3 | Webhook de ingestión: controller, HMAC, dedupe, dispatcher | PR3 | PR1 | Sin efectos secundarios de negocio todavía (gate/cierre vienen después) |
| 4 | Materialización: `aggregateSession()` + persistencia en `room_finished` | PR4 | PR1, PR3 | Función pura testeada sin DB; persistencia con transacción |
| 5 | Endpoints de lectura `GET /calls/sessions(/:id/timeline)` + test de regresión de `GET /calls/history` | PR5 | PR4 | Expone lo que PR4 materializa |
| 6 | Cliente: avatar, timeline, página nueva, link desde Historial | PR6 | PR5 | Consume el contrato de PR5 |
| 7 | **Gate de admin + cierre forzado idempotente + estado terminal de cliente** | PR7 | PR2, PR3, PR6 | **El único PR que puede romper el flujo actual de unirse; se activa último en despliegue (ver Fase 11)** |

PR7 es el de mayor riesgo y el único que toca una ruta ya productiva (`join()` sin chequeo de rol hoy). Debe desplegarse — y preferentemente revisarse — al final, con la auditoría de admins (11.2) ya resuelta.

---

## Fase 1 — Esquema de datos y migración (PR1)

- [x] 1.1 Modificar `src/db/schema.ts`: agregar `call_participant_identities`, `call_events`, `call_sessions`, `call_session_participants` + relaciones + tipos inferidos; no tocar tablas existentes.
- [x] 1.2 Generar `pnpm drizzle-kit generate` → `drizzle/0012_call_participation_timeline.sql`; confirmar que solo contiene `CREATE TABLE` + índices, sin `ALTER`.
- [x] 1.3 Aplicar en desarrollo y correr `pnpm test` completo para confirmar que nada existente se rompe por la adición.

## Fase 2 — Bootstrap de ingesta: `rawBody` + gotcha de Content-Type (PR1)

- [x] 2.1 [RED] Test: POST con `Content-Type: application/webhook+json` → `req.rawBody` vacío (reproduce el gotcha D6 antes de corregirlo).
- [x] 2.2 [GREEN] `src/main.ts`: `NestFactory.create<NestExpressApplication>(AppModule,{rawBody:true})` + `app.useBodyParser('json',{type:['application/json','application/webhook+json']})`.
- [x] 2.3 [RED] Test de regresión: una ruta JSON existente responde igual con `rawBody: true`.
- [x] 2.4 [GREEN] Confirmar 2.3 en verde sin tocar ningún controller existente.

## Fase 3 — Correlación de identidad en `join()` (PR2, depende de Fase 1)

- [x] 3.1 [RED] Usuario registrado se une → se persiste correlación `identity↔userId,roomId` (spec identity/persistencia-registrado).
- [x] 3.2 [GREEN] Upsert `onConflictDoUpdate(livekitIdentity)` en `CallsService.join()`, antes de emitir el token.
- [x] 3.3 [RED] Invitado se une → correlación sin `userId`, con `displayName` (spec identity/invitado).
- [x] 3.4 [GREEN] Extender el upsert al caso invitado.
- [x] 3.5 [RED] Misma cuenta se reconecta → dos correlaciones, `identity` distinto, mismo `userId` (spec identity/reconexión-cuenta).
- [x] 3.6 [RED] Mismo invitado se reconecta → dos correlaciones, mismo nombre (spec identity/reconexión-invitado).
- [x] 3.7 [GREEN] Confirmar 3.5/3.6 en verde (el `unique(livekitIdentity)` por unión ya lo garantiza).
- [x] 3.8 [RED+GREEN] Regresión: condiciones actuales de inserción en `callHistory` para invitados no cambian (spec identity/callHistory-invitados).

## Fase 4 — Webhook de LiveKit: ingestión (PR3, depende de Fase 1)

- [x] 4.1 Crear `calls-webhook.controller.ts`: `POST /calls/livekit/webhook`, clase propia sin guards, `@SkipThrottle()`, `@HttpCode(200)`, body leído solo de `@Req()`.
- [x] 4.2 [RED] Firma inválida/ausente → 401, sin persistencia (spec webhook/firma-inválida).
- [x] 4.3 [GREEN] Verificación HMAC con `WebhookReceiver.receive(rawBody, authorizeHeader)`.
- [x] 4.4 [RED] `rawBody` ausente/vacío → 400.
- [x] 4.5 [GREEN] Guard explícito antes de llamar a `WebhookReceiver`.
- [x] 4.6 [RED] Evento duplicado (mismo `id`) → 200, sin fila ni efecto adicional (spec webhook/idempotencia).
- [x] 4.7 [GREEN] Insert `ON CONFLICT (id) DO NOTHING`; despachar efectos solo si el insert afectó una fila.
- [x] 4.8 [RED] Evento de tipo no reconocido → se persiste, sin efecto de negocio (spec webhook/eventos-soportados).
- [x] 4.9 [GREEN] Dispatcher por `event_type` para los 6 tipos soportados; cualquier otro solo se persiste.
- [x] 4.10 [RED] Dos `room.sid` del mismo `roomCode` no mezclan eventos (spec webhook/alcance-sesión).
- [x] 4.11 [GREEN] Confirmar que toda consulta de sesión usa `livekit_room_sid`, nunca `room_code` solo.
- [x] 4.12 Registrar controller/service en `CallsModule`.

## Fase 5 — Gate de admin en `join()` (parte de PR7, depende de Fase 3)

- [ ] 5.1 [RED] Administrador se une a sala vacía → token emitido, sin consultar `listParticipants` (spec host-gate/admin-siempre).
- [ ] 5.2 [GREEN] Resolver rol local (`roomMembers`); si es admin, cortocircuitar antes de cualquier chequeo de presencia.
- [ ] 5.3 [RED] No-admin con admin conectado → token emitido (spec host-gate/con-admin).
- [ ] 5.4 [RED] No-admin sin ningún admin conectado → 403 `NO_HOST_CONNECTED`, sin token (spec host-gate/sin-admin).
- [ ] 5.5 [GREEN] `listParticipants()` + cruce contra `call_participant_identities.roleAtIssue` para resolver admins conectados.
- [ ] 5.6 [RED] `listParticipants` falla → 503, no 403 (D2).
- [ ] 5.7 [GREEN] Try/catch sobre la consulta de presencia → `ServiceUnavailableException`.
- [ ] 5.8 [RED] Solo invitados conectados, sin admin → se rechaza igual que sala vacía (spec host-gate/invitados-no-admin).
- [ ] 5.9 [RED] Dos admins conectados, uno se va → el otro sostiene la llamada, nuevos no-admin se siguen uniendo (spec host-gate/sostiene-con-uno).

## Fase 6 — Cierre forzado idempotente (parte de PR7, depende de Fase 4 y 5)

- [ ] 6.1 Crear `call-session-close.service.ts` con `Map<roomSid, Timeout>` (single-flight).
- [ ] 6.2 [RED] (timers falsos) Único admin se desconecta con otros presentes → tras 15s todos quedan desconectados y la sesión termina (spec host-gate/cierre-forzado).
- [ ] 6.3 [GREEN] Handler de `participant_left` de admin → `listParticipants`; sin otro admin, agendar re-chequeo a T+15s.
- [ ] 6.4 [RED] Admin se reconecta (nuevo identity) dentro de la ventana → se cancela el cierre agendado.
- [ ] 6.5 [GREEN] En el re-chequeo a T+15s, admin presente → cancelar sin cerrar.
- [ ] 6.6 [RED] Dos `participant_left` de admins casi simultáneos → un solo `deleteRoom`, sin error visible ni duplicado (spec host-gate/idempotencia-concurrente).
- [ ] 6.7 [GREEN] Compare-and-set: `UPDATE call_sessions SET forced_close_at=now() WHERE livekit_room_sid=$1 AND forced_close_at IS NULL RETURNING id`; 0 filas → sin `deleteRoom`.
- [ ] 6.8 [RED] `deleteRoom` falla (sala ya cerrada) → sin throw, log nivel `log`, sin payload externo.
- [ ] 6.9 [GREEN] Try/catch sobre `deleteRoom` con mensaje propio `'La sala de medios ya estaba cerrada'`, nivel `log`, sin re-lanzar.
- [ ] 6.10 Conectar `CallsWebhookService` → en `participant_left` de identity con `roleAtIssue='administrador'`, invocar `CallSessionCloseService`.

## Fase 7 — Materialización de la línea de tiempo (PR4, depende de Fase 1 y 4)

- [x] 7.1 [RED] `aggregateSession()` con 3 participantes (incl. invitado) → resumen con join/leave/duración/spoke/screenShared por cada uno (spec timeline/materialización).
- [x] 7.2 [GREEN] Implementar `aggregateSession(events, identities, fallbackEndAt)` como función pura.
- [x] 7.3 [RED] Mismo participante con dos pares join/leave → una sola entrada, duración = suma de intervalos, `rejoin_count` (spec timeline/reconexiones).
- [x] 7.4 [RED] Track publicado sin evento de cierre explícito → `spoke`/`screenShared` true, cierre implícito con `fallbackEndAt` (spec timeline/cierre-implícito).
- [x] 7.5 [GREEN] Confirmar 7.3/7.4 (plegado por `participant_key`, cierre de tracks abiertos al `fallbackEndAt`).
- [x] 7.6 [RED] `room_finished` dispara upsert de `call_sessions` (`materialized_at IS NULL`) + insert de `call_session_participants` en una transacción; reentrega no duplica (spec timeline/resiliencia parcial).
- [x] 7.7 [GREEN] Handler de `room_finished`: compare-and-set sobre `materialized_at` + agregación + insert transaccional.
- [x] 7.8 [RED+GREEN] Regresión: `callHistory` no cambia con el despliegue de esta fase (spec timeline/independencia-callHistory).

## Fase 8 — Endpoints de lectura (PR5, depende de Fase 7)

- [x] 8.1 Crear `call-timeline.controller.ts`: `GET /calls/sessions` bajo `JwtAuthGuard`.
- [x] 8.2 [RED] Devuelve solo las sesiones donde participó el solicitante.
- [x] 8.3 [GREEN] Query filtrando `call_session_participants.userId = solicitante`.
- [x] 8.4 [RED] `GET /calls/sessions/:sessionId/timeline` — participante de la sesión ve el resumen completo (spec timeline/lectura-participante).
- [x] 8.5 [RED] Usuario ajeno a la sesión → 404, no 403 (spec timeline/lectura-ajeno).
- [x] 8.6 [GREEN] Implementar el endpoint con chequeo de pertenencia antes de devolver datos.
- [x] 8.7 [RED+GREEN] Regresión explícita: `GET /calls/history` devuelve el mismo payload y semántica que antes del cambio.

## Fase 9 — Cliente: timeline y navegación (PR6, depende de Fase 8)

- [ ] 9.1 [RED] `InitialsAvatar`: iniciales de 1/2/3+ palabras, nombres Unicode, color estable por nombre.
- [ ] 9.2 [GREEN] Implementar `client/src/features/calls/InitialsAvatar.tsx`.
- [ ] 9.3 [RED] `ParticipationTimeline`: lista por participante con avatar, horarios, duración, chips "habló"/"compartió pantalla".
- [ ] 9.4 [GREEN] Implementar `client/src/features/calls/ParticipationTimeline.tsx`.
- [ ] 9.5 Crear `client/src/app/history/[sessionId]/page.tsx` (reusa `AppShell`, `isLoggedIn()`, `useTranslation`).
- [ ] 9.6 Modificar `client/src/app/history/page.tsx`: sección "Sesiones de llamada" desde `GET /calls/sessions`, link a la línea de tiempo.
- [ ] 9.7 Modificar `client/src/lib/api.ts` / `client/src/lib/calls.ts`: clientes para los endpoints nuevos.

## Fase 10 — Gate en el cliente + estado terminal (parte de PR7, depende de Fase 6 y 9)

- [ ] 10.1 [RED] `endedByHost()` produce `status:'ended'`, `endReason:'host-left'`.
- [ ] 10.2 [GREEN] Implementar el estado terminal en `client/src/features/calls/useCallSession.ts`.
- [ ] 10.3 [RED] `onDisconnected(ROOM_DELETED|ROOM_CLOSED)` → `endedByHost()`; otro reason → `failed()` sin regresión.
- [ ] 10.4 [GREEN] Ruteo en `MeetingRoom.tsx` + panel terminal ("La llamada terminó porque el anfitrión se desconectó", links "Ver línea de tiempo" / "Volver a la sala").
- [ ] 10.5 [RED+GREEN] Código `NO_HOST_CONNECTED` del 403 se mapea a mensaje traducido con botón "Reintentar"; cae al mensaje crudo si no viene el código.

## Fase 11 — Despliegue (orden crítico; checklist operativo, no PR de código)

- [ ] 11.1 Desplegar con `rawBody: true` sin configurar aún `webhook.urls`; confirmar comportamiento idéntico al actual.
- [ ] 11.2 **Precondición bloqueante**: auditar `roomMembers` → listar salas con llamadas sin ningún `role='administrador'`; asignar admin donde falte. No avanzar a 11.4 sin esto resuelto.
- [ ] 11.3 Configurar `webhook.urls` en `livekit.yaml` (infraestructura, fuera del repo) apuntando al endpoint nuevo; confirmar ingesta real en `call_events`.
- [ ] 11.4 Activar el gate de admin en `join()` (merge/flag final de PR7), solo después de confirmar 11.2.
- [ ] 11.5 E2E Playwright: Historial → línea de tiempo con participantes y duración; rechazo "no hay anfitrión conectado" con mensaje explícito.
