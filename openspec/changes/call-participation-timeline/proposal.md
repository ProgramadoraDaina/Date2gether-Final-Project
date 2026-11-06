# Propuesta: Línea de tiempo de participación en llamadas

## Intención

Hoy `callHistory` solo registra "esta cuenta entró alguna vez a esta sala" (`roomId`, `userId`, `startedAt`): sin hora de salida, sin duración, sin invitados y sin vínculo con la sesión real de LiveKit. No se puede responder quién participó de una llamada concreta ni por cuánto tiempo. Esta propuesta agrega una línea de tiempo **post-llamada** por sesión, alimentada por webhooks de LiveKit.

Además, hoy la videollamada no tiene anfitrión: `CallsService.join()` emite el token de LiveKit sin ningún chequeo de rol, por lo que una llamada puede ocurrir sin ningún `administrador` presente y una sesión puede quedar abierta indefinidamente mientras alguien siga conectado. Esta propuesta incorpora la regla **"sin admin no hay llamada"** (modelo anfitrión, estilo Zoom), que además es el disparador confiable del fin de sesión (`room_finished`) y, con él, de la materialización de la línea de tiempo. Ambas piezas quedan conectadas: el cierre forzado por ausencia de admin es lo que garantiza que el resumen final se arme.

## Alcance

### Dentro de alcance
- Endpoint de webhook de LiveKit en el módulo `calls`, con verificación de firma HMAC.
- Tabla de correlación `identity` de LiveKit ↔ `userId` o invitado, escrita en `CallsService.join()`.
- Tabla de eventos append-only (dedupe por `id` de evento) + tabla resumen por participante materializada en `room_finished`.
- Página nueva y dedicada de línea de tiempo, con link "ver línea de tiempo" desde `client/src/app/history/page.tsx`.
- Avatar de iniciales (nombre → iniciales + color determinístico).
- Invitados incluidos en la línea de tiempo.
- **Control de acceso a la videollamada por presencia de administrador** ("sin admin no hay llamada"): chequeo en `CallsService.join()` antes de emitir el token de LiveKit.
- **Cierre forzado de la sesión de LiveKit** cuando se desconecta el último `administrador` conectado, desconectando a todos los participantes restantes.

### Fuera de alcance
- Dashboard en vivo durante la llamada.
- Detección real de voz (VAD / niveles de audio).
- Google Sign-In y fotos de perfil reales (feature separada a futuro).
- Cambiar la semántica actual de `callHistory`.
- Cambiar el ciclo de vida de la **sala** (chat, miembros, `rooms.isActive`): la regla de admin aplica **exclusivamente a la videollamada**, no a la sala.
- Gestión de roles: promover/transferir `administrador` durante la llamada, delegación temporal o sala de espera para admitir participantes.
- Aviso previo o cuenta regresiva antes del cierre forzado (el corte es inmediato).

## Decisiones de producto cerradas

| Decisión | Justificación |
|---|---|
| Solo post-llamada | Sin necesidad de sincronización en tiempo real |
| Fuente = webhooks de servidor, no auto-reporte del cliente | El proyecto ya vio conexiones LiveKit inestables |
| "Habló" = track de micrófono publicado | Único dato disponible vía webhook; simplicidad explícita |
| Invitados incluidos | "Quiénes participaron" incluye a todos los presentes |
| Visibilidad: cualquier participante ve a todos los de su misma sesión | Dato compartido de la llamada; sin rol admin extra |
| Retención indefinida del log crudo | Auditoría y depuración |
| Entrada vía ruta propia desde Historial | Evita modal/expansión inline; URL compartible |
| Nadie se une a la videollamada si no hay al menos un `administrador` de esa sala ya conectado | Modelo anfitrión: la llamada necesita una persona responsable presente |
| El rol es por sala y puede haber varios `administrador` en la misma sala (confirmado en `roomMembers`: PK `(roomId, userId)`, sin restricción de unicidad; default `participante`) | La regla se evalúa por presencia de **al menos un** admin, no por "el" admin |
| La llamada se sostiene mientras quede al menos un admin conectado | Que un admin se vaya no corta la llamada si otro admin permanece |
| Al desconectarse el **último** admin conectado, la sesión de LiveKit se cierra para todos (desconexión forzada, no opcional) | Consistencia con el modelo anfitrión; cada participante no decide si se queda |
| Un `administrador` siempre puede unirse, incluso si la llamada está vacía | Sin esta excepción ninguna llamada podría iniciarse |
| Los invitados (sin `userId`) nunca son admin | No existen en `roomMembers`; siempre requieren un admin conectado |
| La regla aplica solo a la videollamada; la sala y su chat siguen disponibles | El corte de llamada no es un cierre de sala |

## Capacidades

### Nuevas
- `call-webhook-ingestion`: recepción, verificación de firma e idempotencia de eventos de LiveKit.
- `call-participant-identity`: correlación `identity` ↔ usuario/invitado al emitir el token.
- `call-host-gate`: control de acceso a la videollamada por presencia de `administrador` y cierre forzado de la sesión cuando se va el último admin. Capacidad conceptualmente independiente de `call-participant-identity`, aunque **reusa** su tabla de correlación para resolver qué rol tiene cada `identity` conectado.
- `call-participation-timeline`: resumen por participante-sesión y su lectura.

### Modificadas
- Ninguna (no existen specs previas en `openspec/specs/`).

## Enfoque

1. `CallsWebhookController` propio (sin `JwtAuthGuard`), `WebhookReceiver` de `livekit-server-sdk` sobre `req.rawBody`; bootstrap con `rawBody: true`.
2. Eventos consumidos: `room_started`, `room_finished`, `participant_joined`, `participant_left`, `track_published`, `track_unpublished`.
3. Unidad de sesión = `room.sid` (par `room_started`→`room_finished`).
4. Escritura: insert append-only deduplicado por `id` de evento. Al llegar `room_finished`, agregación única → fila resumen por participante (primer join, último leave, duración total, `spoke`, `screenShared`, reconexiones).
5. Lectura: endpoint autorizado para participantes de esa sesión → página cliente nueva.
6. **Gate de admin en `join()`**: resolver el rol del solicitante en `roomMembers` (`roomId` + `participant.userId`; el JWT de `RoomParticipant` hoy no transporta rol). Si es `administrador`, se permite siempre. Si no, se exige que haya al menos un `administrador` de esa sala conectado en ese momento; si no hay ninguno, se rechaza antes de emitir el token.
7. **Cierre forzado en el webhook**: al recibir `participant_left` de un `identity` que corresponde a un `administrador`, verificar si queda algún otro admin conectado. Si no queda ninguno, cerrar la sala de LiveKit para todos vía `RoomServiceClient` (`deleteRoom`). La operación debe ser idempotente. El `room_finished` resultante dispara la materialización de la línea de tiempo (paso 4).

## Áreas afectadas

| Área | Impacto | Descripción |
|---|---|---|
| `src/main.ts` | Modificado | `rawBody: true` |
| `src/db/schema.ts` + migración | Modificado | 3 tablas nuevas |
| `src/modules/calls/` | Modificado | Webhook controller/service + correlación en `join()` |
| `src/modules/calls/calls.service.ts::join()` | Modificado | Chequeo nuevo antes de emitir el token: ¿hay un `administrador` conectado ahora? Hoy no existe ningún chequeo de rol en este método (confirmado) |
| `src/modules/calls/` (handler de webhook) | Nuevo | Al recibir `participant_left` de un admin, verificar si queda otro admin conectado; si no, forzar el cierre de la sala de LiveKit para todos (`RoomServiceClient.deleteRoom`) de forma idempotente |
| Lectura de `roomMembers` desde `calls` | Modificado | Resolver el rol por sala; `RoomParticipant` no transporta rol |
| `client/src/features/calls/` (llamada en vivo) | Modificado | Manejo de la desconexión forzada y del rechazo "no hay anfitrión conectado" con mensaje claro |
| `client/src/app/history/page.tsx` | Modificado | Link a la línea de tiempo |
| `client/src/features/calls/` | Nuevo | Componentes de línea de tiempo + avatar |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| `rawBody: true` altera el bootstrap global | Baja | Aditivo; cubrir rutas JSON existentes con tests |
| Throttler global (60 req/min/IP) ante ráfagas de webhooks | Media | `@SkipThrottle()` en la ruta de webhook |
| `identity` inestable entre reconexiones | Alta | Correlación persistida en `join()`; agrupar por `userId`/invitado en el resumen |
| `room_finished` nunca llega | Baja | El log crudo sigue siendo fuente de verdad; permitir re-materialización |
| Fin de sesión sin `track_unpublished` (navegador colgado) | Media | Cerrar tracks abiertos con el timestamp de `participant_left`/`room_finished` |
| Condición de carrera: dos `participant_left` de admins distintos llegan casi simultáneos y ambos disparan el cierre | Media | El cierre forzado debe ser idempotente: cerrar una sala ya cerrada no debe fallar ni duplicar efectos (tolerar error de "sala inexistente") |
| Determinar de forma confiable "quién está conectado ahora mismo" para el chequeo síncrono en `join()` | Media | **Pregunta abierta para `sdd-design`** (ver sección siguiente); no se decide en esta propuesta |
| Reconexión de red del único admin interpretada como salida definitiva → corte indeseado de la llamada | Media | Evaluar en diseño el uso de `departureTimeout`/ventana de gracia antes de forzar el cierre |
| El gate rompe el flujo actual de unirse (hoy cualquiera entra) para salas sin admin asignado | Media | Verificar que las salas existentes tengan al menos un `administrador`; mensaje de error explícito ("no hay anfitrión conectado") en lugar de un fallo genérico |
| Cierre forzado percibido como caída del sistema | Baja | Mensaje de cliente explícito al ser desconectado por salida del anfitrión |

## Plan de rollback

Revertir el commit, aplicar la migración `down` (drop de las 3 tablas) y quitar `rawBody: true`. Las tablas nuevas son aditivas: `callHistory` y el flujo de llamada actual quedan intactos, por lo que el rollback no pierde datos preexistentes. Opcionalmente, desconfigurar `webhook.urls` en `livekit.yaml` para detener la ingesta sin desplegar.

El gate de admin es reversible por separado y sin migración: quitar el chequeo de rol en `join()` y la rama de cierre forzado del handler de webhook restaura el comportamiento actual (cualquiera se une, la llamada no se corta por ausencia de admin). Conviene dejarlo detrás de un punto de reversión independiente del resto del cambio.

## Dependencias

- Configurar `webhook.urls` en `livekit.yaml` apuntando al nuevo endpoint (reusa la API key/secret existentes).
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` ya presentes.
- `RoomServiceClient` ya se usa en `CallsService.join()`; el cierre forzado reutiliza esa configuración (`LIVEKIT_API_URL`).
- Cada sala que vaya a tener llamadas necesita al menos un miembro con rol `administrador`.

## Preguntas abiertas para diseño

1. Cómo determinar de forma confiable "quién está conectado ahora mismo" para el chequeo síncrono en `join()`: consulta en vivo a LiveKit (`RoomServiceClient.listParticipants`) o estado derivado del log de eventos. Incluye definir qué hacer si LiveKit no responde (¿rechazar o permitir?).
2. Ventana de gracia ante reconexiones del último admin antes de forzar el cierre, y su relación con `departureTimeout`.
3. Mecanismo exacto de idempotencia del cierre forzado (dedupe por `room.sid`, tolerancia a "sala inexistente").
4. Cómo comunica el cliente la desconexión forzada por salida del anfitrión.

## Criterios de éxito

- [ ] Los eventos de LiveKit se persisten con firma verificada y entregas duplicadas no generan filas repetidas.
- [ ] Al terminar una sesión, cada participante (incluidos invitados) tiene join, leave, duración, `spoke` y `screenShared`.
- [ ] Desde Historial se llega a la línea de tiempo de una sesión pasada y se ven todos sus participantes.
- [ ] `callHistory` y el resto del flujo de llamada siguen funcionando sin cambios de semántica.
- [ ] Un participante no administrador que intenta unirse sin ningún admin conectado recibe un rechazo explícito y no obtiene token de LiveKit.
- [ ] Un `administrador` puede unirse a una llamada vacía e iniciarla.
- [ ] Con dos admins conectados, la salida de uno no corta la llamada; los demás siguen conectados.
- [ ] Al salir el último admin, todos los participantes restantes quedan desconectados de la videollamada y la sesión de LiveKit termina.
- [ ] Ese cierre forzado produce `room_finished` y, en consecuencia, la línea de tiempo queda materializada sin intervención manual.
- [ ] La sala, su chat y su lista de miembros siguen accesibles después del corte de la videollamada.
