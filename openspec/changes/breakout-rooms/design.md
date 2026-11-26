# Diseño: breakout-rooms (mini salas dentro de una llamada)

## Enfoque técnico

El cambio no agrega una feature al costado del ciclo de vida de la llamada: **reemplaza un identificador por una lista** en los tres puntos donde el código hardcodea la suposición 1:1 sala-de-la-app ↔ sala-de-LiveKit (`CallsService.join()`, `CallsService.assertHostConnected()`, `CallSessionCloseService.hasConnectedAdmin()`), y construye el ciclo de vida de mini sala encima de las primitivas ya probadas en producción (`createRoom`, `AccessToken`, `listParticipants`, `listRooms`, `deleteRoom`, webhooks append-only).

Tres piezas:

1. **Resolución de grupo** (`CallGroupResolverService` + un módulo puro `call-group.ts`): traduce `(roomId, roomCode)` a la lista de nombres de salas de LiveKit del grupo, y traduce un nombre de mini sala de vuelta a su ancla padre. Es la única pieza nueva de la que depende la seguridad.
2. **Ciclo de vida** (`BreakoutRoomsService` + `BreakoutRoomsController`): crear bajo tope, política de salida, traslados, cierre manual, cierre por `autoCloseAt`, reconciliación perezosa.
3. **Control de acceso a nivel grupo**: los dos evaluadores de presencia de admin iteran la lista en vez de un nombre. Con cero mini salas activas la lista tiene un solo elemento y el código recorre un *fast path* literalmente idéntico al actual.

La propiedad que sostiene todo el plan de rollback es esa: **el caso degenerado no es "equivalente", es el mismo camino de ejecución**.

---

## Decisiones de arquitectura

### D1 — `resolveCallGroupRoomNames` se parte en dos: una función pura y un envoltorio con IO

| Opción | Tradeoff | Decisión |
|---|---|---|
| Una sola función async que consulta y arma la lista | Un solo punto de llamada, pero la regla de seguridad (qué entra y qué no entra en el grupo) solo se puede testear con la base mockeada | Rechazada |
| `buildCallGroupRoomNames()` pura + `CallGroupResolverService.resolveCallGroupRoomNames()` con la consulta | Dos piezas en vez de una | **Elegida** |

**Justificación**: la decisión "¿qué salas pertenecen a este grupo *ahora*?" es la única pieza de seguridad nueva del cambio. Separarla en una función pura la vuelve testeable con arrays armados a mano — sin base, sin LiveKit, sin timers — exactamente el precedente de `aggregateSession()` (`aggregate-session.ts`), que es la pieza más testeada del módulo justamente por ser pura. El envoltorio queda reducido a una consulta indexada sin lógica.

La función pura también es donde vive el **filtro de vencimiento**: una mini sala con `autoCloseAt <= now` se excluye de la lista del grupo *antes* de cualquier evaluación de presencia. Una mini sala vencida no puede sostener viva a la llamada, aunque su sala de LiveKit siga existiendo porque todavía nadie corrió la reconciliación.

```ts
// src/modules/calls/call-group.ts — puro, sin IO, sin Nest
export const BREAKOUT_NAME_SEPARATOR = '::';

export interface OpenBreakout {
  id: string;
  livekitRoomName: string;
  autoCloseAt: Date | null;
}

export function buildBreakoutRoomName(roomCode: string, index: number): string; // `${roomCode}::breakout-${index}`
export function parseBreakoutRoomName(name: string): { parentCode: string; index: number } | null;
export function isBreakoutRoomName(name: string): boolean; // name.includes('::')

/** [roomCode, ...nombres de mini salas abiertas y NO vencidas] + las vencidas aparte. */
export function buildCallGroupRoomNames(
  roomCode: string,
  openBreakouts: OpenBreakout[],
  now: Date,
): { names: string[]; expired: OpenBreakout[] };
```

### D2 — El *fast path* de un solo nombre es un camino de ejecución separado y deliberado

| Opción | Tradeoff | Decisión |
|---|---|---|
| Un único bucle sobre `names`, con `names.length === 1` como caso particular del bucle | Código más corto; pero el caso de producción actual pasa por código nuevo (bucle, acumulador, manejo de errores por nombre) | Rechazada |
| `if (names.length === 1) return <el código de hoy, intacto>` y recién después el camino multi-sala | Una rama extra | **Elegida** |

**Justificación**: el riesgo número uno de la propuesta es regresionar el control de acceso **ya en producción** para llamadas que nunca crean una mini sala. Con `MAX_BREAKOUT_ROOMS=0` o simplemente sin mini salas abiertas, `names` tiene un elemento y la ejecución recorre la misma única llamada a `listParticipants(roomCode)`, con la misma propagación de excepción y la misma consulta a `call_participant_identities` que hoy. No hay equivalencia que haya que *demostrar* porque no hay código nuevo en ese camino. Esto es lo que hace del nivel 1 de rollback (`MAX_BREAKOUT_ROOMS=0`, sin deploy) un killswitch real y no una promesa.

### D3 — Presencia en el camino multi-sala: existencia por `listRooms`, presencia por `listParticipants`

Problema concreto: `listParticipants(name)` sobre una sala que LiveKit ya no tiene **tira**, y el `catch` de `hasConnectedAdmin()` interpreta cualquier error como "no se pudo verificar" → devuelve `true` → **nunca se fuerza el cierre**. Una mini sala reapeada por `departureTimeout` cuya fila sigue abierta dejaría al grupo inmortal. Eso es una regresión de seguridad, no una molestia.

| Opción | Tradeoff | Decisión |
|---|---|---|
| `listRooms(names)` para saber qué salas existen, y `listParticipants` solo sobre esas | Una llamada de red extra en el camino multi-sala | **Elegida** |
| Degradar cualquier error de una mini sala a "sala vacía" | Si el único admin estaba justo en esa mini sala y LiveKit tuvo un error transitorio, se fuerza el cierre de un grupo supervisado | Rechazada |
| Hacer *string matching* sobre el mensaje de error de LiveKit | Acopla la seguridad a la redacción de una librería externa | Rechazada |

`listRooms([names])` no falla por nombres inexistentes: devuelve solo las que existen — patrón ya usado y verificado en `CallsService.reportTrackState()` (`const [room] = await client.listRooms([roomCode]); if (!room?.sid) return;`).

Semántica final del camino multi-sala:

- Nombre ausente de `listRooms` → se trata como **vacío** y se encola para reconciliación (marcar `closedAt`).
- `listParticipants` tira sobre una sala que *sí* existe → se propaga: `catch` → `true` → **no se fuerza el cierre** (fail-safe actual, sin cambios).
- `listRooms` tira → ídem.
- Ningún identity en ninguna sala del grupo → `false` → se fuerza el cierre.

### D4 — `call_breakout_rooms` es una tabla operativa, no una extensión de `rooms`

| Opción | Tradeoff | Decisión |
|---|---|---|
| Tabla `call_breakout_rooms` acotada al padre | Una tabla nueva; dos modelos de "sala" en el sistema | **Elegida** |
| Fila en `rooms` con `parentRoomId` | Hereda gratis el `code` y `roomMembers`… y con eso hereda **todo** lo que cuelga de `rooms`: unicidad parcial del pool de códigos, `retireExpired()`, `touchEntry()`, `roomMembers`, chat, notas, admisiones, salas programadas, página de historial. Una mini sala no tiene ninguna de esas semánticas, así que cada consumidor de `rooms` pasaría a necesitar un filtro `parentRoomId IS NULL` — y el que se olvide produce un bug silencioso | Rechazada |
| Derivar la membresía del grupo desde `call_events` (la revisión que pedía C1) | El log es una proyección **rezagada** y, peor, *append-only*: no tiene forma de expresar "esta mini sala ya cerró" salvo reconstruyendo estado por reducción en cada evaluación. Usar una proyección eventualmente consistente para una decisión de admisión es exactamente lo que D1 del diseño de `call-participation-timeline` ya rechazó | Rechazada |
| Mantener las mini salas activas en memoria | Hereda la limitación de proceso único de `pendingCloses` para una decisión de **seguridad**. Un reinicio dejaría grupos cuyos miembros el servidor no puede enumerar | Rechazada |

**Justificación**: la pregunta que el control de acceso a nivel grupo tiene que contestar es "¿qué salas de LiveKit pertenecen a este grupo *ahora*?". Eso es estado **operativo mutable y durable** (abre, cambia de política, vence, cierra), con un ciclo de vida de minutos y sin identidad de producto: no tiene código, no tiene miembros, no tiene historial propio. `rooms` modela lo contrario — contenedores persistentes con identidad pública. Son dos conceptos distintos; fusionarlos solo ahorra un `CREATE TABLE` y paga con una condición de filtrado nueva en cada consulta existente de `rooms`.

### D5 — Desvío declarado: 2 tablas nuevas y 2 columnas de ancla, no 1 tabla

La propuesta dice "tabla nueva `call_breakout_rooms`" con seis columnas. El diseño necesita más, y acá está por qué. (Mismo patrón de desvío declarado que D8 en `call-participation-timeline/design.md`.)

**1. Tabla `call_breakout_occupants`.** Surge de un hueco de seguridad real en la decisión 2 de producto: `locked` **no se puede** hacer cumplir solo no emitiendo tokens nuevos. El `AccessToken` de la sala principal que el participante ya tiene vive `ttl: '15m'` (`calls.service.ts:141`) y sigue siendo válido después del traslado: puede reconectarse a la principal por su cuenta. Y el JWT de acceso a sala (`participant.sub`) vive 24 h, así que `POST /calls/:roomCode` también le emitiría uno nuevo. Para rechazarlo, el servidor necesita saber de forma **durable** que ese sujeto tiene una asignación abierta a una mini sala `locked`. En memoria sería la misma objeción de C1: proceso único para una decisión de seguridad.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk defaultRandom` | |
| `breakout_room_id` | `uuid not null → call_breakout_rooms(id) on delete cascade` | |
| `source_identity` | `varchar(64) not null` | `participant.sub` del pase de sala (estable 24 h): la clave con la que `join()` reconoce al solicitante |
| `livekit_identity` | `varchar(64) not null` | La identity **nueva** emitida para la mini sala (D7) |
| `user_id` | `uuid → users(id) on delete set null` | `null` para invitados |
| `display_name` | `varchar(60) not null` | |
| `assigned_at` | `timestamp not null defaultNow` | |
| `returned_at` | `timestamp` | `null` = asignación abierta |

Índices: `unique(livekit_identity)`, `(breakout_room_id) where returned_at is null`, `(source_identity) where returned_at is null`.

**2. `call_breakout_rooms.parent_livekit_room_sid`.** Cuando el último admin se desconecta **de una mini sala**, el webhook trae el `sid` y el nombre de *la mini sala*; el compare-and-set de cierre forzado tiene que reclamarse sobre la fila de `call_sessions` **del padre**, que es la que ancla el grupo. Sin esta columna habría que adivinar el `sid` padre desde el log de eventos por cercanía temporal. El `sid` del padre se conoce con certeza al crear la mini sala (el admin está conectado, así que `listRooms([parentCode])` lo devuelve) — se captura ahí, una vez, de forma determinista.

**3. `call_sessions.call_group_id varchar(64)`** (la columna que la propuesta ya pide) **= el `livekitRoomSid` de la sesión padre**, no un uuid nuevo.

| Opción | Tradeoff | Decisión |
|---|---|---|
| `call_group_id` = `livekit_room_sid` del padre | Nombre con `Id` pero tipo `varchar(64)` | **Elegida** |
| Auto-FK a `call_sessions.id` del padre | La fila padre puede no existir todavía cuando llega el `room_finished` de la mini sala (los webhooks llegan desordenados) → requiere backfill diferido | Rechazada |
| Uuid de grupo generado al crear la mini sala | Exige otra columna donde guardarlo y no se puede stampear en el padre sin una escritura extra | Rechazada |

`livekitRoomSid` ya es **la** clave de sesión de todo el pipeline (índices, unicidad, dedupe). Con esto el agrupamiento es `WHERE call_group_id = $parentSid`, resoluble en el propio handler de `room_finished` de la mini sala: `call_breakout_rooms.livekit_room_name = event.room.name` → `parent_livekit_room_sid`. Cero backfill, cero orden de llegada asumido.

**4. Ensanchar `call_events.room_code` y `call_sessions.room_code` de `varchar(20)` a `varchar(40)`.** No es cosmético, es un **bloqueante**: `rooms.code` es `varchar(20)`, así que `${roomCode}::breakout-N` puede llegar a 32 caracteres, y `CallsWebhookService.toEventRow()` escribe `event.room.name` crudo en una columna de 20. Sin el ensanche, **todo** webhook de mini sala falla al insertarse y se pierde la ingestión entera del grupo. Ensanchar un `varchar` en Postgres es un cambio de catálogo sin reescritura de tabla y sin downtime.

### D6 — Atribución de grupo: el log guarda el nombre crudo, el dispatcher resuelve el ancla

| Opción | Tradeoff | Decisión |
|---|---|---|
| `call_events.room_code` guarda el nombre real de la sala de LiveKit (`A1B2C3::breakout-2`); la normalización al padre ocurre en el dispatcher | El log pide un `parseBreakoutRoomName` al leerlo por grupo | **Elegida** |
| Reescribir `room_code` al código del padre al insertar | Rompe la fidelidad del log de auditoría: dejaría de poder reconstruirse en qué sala concreta pasó cada cosa, y el log es append-only e inmutable por diseño (D7 del diseño anterior) | Rechazada |

El único cambio de ingestión es de **atribución**, en el dispatcher:

```ts
// CallGroupResolverService
/** Mini sala → ancla padre. Un código sin '::' se devuelve tal cual, SIN consultar nada. */
async resolveGroupAnchor(
  livekitRoomSid: string,
  roomCode: string,
): Promise<{ parentSid: string; parentCode: string }>;
```

El retorno sin consulta para códigos sin `::` mantiene el camino de las llamadas sin mini salas sin una sola consulta nueva.

### D7 — Identidad nueva por traslado: `randomUUID()`, y la anterior no se invalida

| Opción | Tradeoff | Decisión |
|---|---|---|
| `livekitIdentity = randomUUID()` + fila nueva en `call_participant_identities` con el **mismo** `roomId`, `userId`, `displayName`, `roleAtIssue` | Una fila más de correlación por traslado | **Elegida** |
| Reusar `participant.sub` en la mini sala | El mismo identity en dos salas del grupo vuelve ambigua la atribución por identity: `CallsWebhookService.onParticipantLeft()` busca por `livekit_identity` sin discriminar sala, y un `participant_left` de la principal (el que dispara el traslado) sería indistinguible de una salida real | Rechazada |
| Identity derivada (`${sub}::b1`) | Determinista, pero un segundo traslado a otra mini sala choca con `unique(livekit_identity)` salvo que se lleve un contador por participante — complejidad sin beneficio | Rechazada |

**Justificación**: es el patrón que el sistema ya usa. `RoomAccessService.create()` genera `sub = randomUUID()` en cada acceso, y el diseño de `call-participation-timeline` ya construyó todo asumiendo que **una persona = N identities** (es textual en D3: "un admin que se reconecta vuelve con un `identity` nuevo y distinto"). La agregación colapsa las N identities en una fila vía `participant_key` (`userId`, o `guest:` + nombre en minúscula), así que **`aggregate-session.ts` no se toca**. Un uuid son 36 caracteres y la columna es `varchar(64)`.

Dos consecuencias deliberadas:

- La fila nueva se escribe **antes** de emitir el token, igual que en `join()`: cuando llegue cualquier webhook de ese identity la correlación ya existe.
- `roomId` es el del **padre** (decisión 8 de la propuesta). Por eso el filtro `eq(callParticipantIdentities.roomId, roomId)` de `assertHostConnected()` sigue funcionando sin tocarse sobre identities de mini sala: todas pertenecen al mismo `roomId`.
- El token de la sala principal **no se invalida** (no hay forma de hacerlo en LiveKit). Eso es un riesgo asumido y mitigado por D8, y a la vez es la mitigación del riesgo "participante varado a mitad de traslado" que la propuesta ya declaró.

### D8 — `locked` se hace cumplir en dos puntos, porque el token viejo sigue vivo

Enforcement real, no por omisión:

1. **En `join()`** (emisión de token de la sala principal): si el solicitante **no es `administrador`** y tiene una asignación abierta a una mini sala con `leavePolicy = 'locked'` → `403 { code: 'BREAKOUT_RETURN_LOCKED' }`, sin emitir token. Este es el criterio de éxito "no se emite token de la sala principal".
2. **En el webhook `participant_joined` de la sala principal** (bucle de reconciliación): si el identity que entró corresponde a una asignación abierta `locked` → `removeParticipant(parentCode, identity)`. Cubre al que reconecta con el token de 15 min que todavía tenía en memoria.

`participant_joined` es hoy un hueco vacío en `CallsWebhookService` (`onParticipantJoined(event): void {}`), así que llenarlo es puramente aditivo.

**Limitación residual declarada**: entre que un occupant `locked` reconecta a la principal y que llega el webhook, hay una ventana de uno o dos segundos de presencia real de medios. Es una ventana de fuga breve, no un agujero permanente, y es el techo de lo que LiveKit permite sin un hook de admisión del lado servidor. Debe quedar documentada en el spec, no disimulada.

**`locked` nunca aplica a un `administrador`**: el admin siempre vuelve libremente. Esto no es una comodidad, es lo que mantiene el cortocircuito de admin de `join()` **intacto**: el admin sigue sin consultar presencia ni asignaciones, y sigue pudiendo abrir una llamada con LiveKit inestable (la excepción que D2 del diseño anterior exige).

### D9 — Costo agregado en `join()`: una consulta para el no-admin, cero para el admin

| Camino | Consultas nuevas |
|---|---|
| `administrador` | **0** (cortocircuito intacto) |
| No-admin, grupo sin mini salas abiertas | **1** — las filas abiertas de `call_breakout_rooms` por `room_id` (índice parcial). Devuelve vacío → `names = [roomCode]` → D2 fast path → y además se saltea el chequeo de `locked`, que no tiene sentido si el grupo no tiene mini salas |
| No-admin, grupo con mini salas abiertas | 2 — la anterior más la asignación abierta por `source_identity` |

**Justificación**: la consulta que el gate necesita para armar el grupo es la misma que decide si hace falta chequear `locked`. No se suman dos costos: se reusa uno. Y como el cortocircuito de admin queda antes, el camino más sensible a latencia (el admin abriendo la llamada) no paga nada.

**Implicancia para la fase de tasks**: los specs existentes de `CallsService` mockean `db` con secuencias de llamadas. Una consulta nueva en el camino no-admin puede obligar a **extender el harness de mocks** (fixtures aditivas). Eso es aceptable; **cambiar una aserción de comportamiento no lo es**. Cualquier `expect` que haya que modificar en los tests de host-gate es una señal de alarma que debe justificarse explícitamente, no normalizarse.

### D10 — `autoCloseAt`: persistido, con timer en proceso como atajo y reevaluación perezosa como garantía

Sin scheduler nuevo. Es el patrón exacto de D3 del diseño anterior (timer en memoria + invariante que se re-evalúa en cada evento), que ya está en producción.

```
autoCloseAt persistido en call_breakout_rooms
   ├─ atajo: setTimeout en proceso al crear/actualizar (Map<breakoutId, Timeout>)
   └─ garantía: reconciliación perezosa en cada interacción del grupo
        ├─ cualquier webhook de una sala del grupo (participant_joined/left, room_finished)
        └─ cualquier acción del controlador de mini salas (listar, crear, cerrar, trasladar)
```

Dos propiedades separadas, y la distinción importa:

- **Exclusión del grupo** (seguridad): es *pura* y sincrónica. `buildCallGroupRoomNames()` saca de la lista toda mini sala con `autoCloseAt <= now`, aunque su teardown todavía no haya corrido. Una mini sala vencida **nunca** sostiene viva a la llamada, ni después de un reinicio, ni sin que llegue ningún evento. No depende de ningún timer.
- **Teardown** (devolver a la gente y borrar la sala de LiveKit): es *best-effort* y lo dispara el timer o la reconciliación.

`join()` **no** dispara teardown — solo consume la lista ya filtrada. Nunca se encola trabajo de LiveKit desde la ruta síncrona de unión.

**Limitación residual declarada**: si el proceso se reinicia y al grupo no le llega ninguna interacción, los occupants de una mini sala vencida siguen ahí hasta que LiveKit reapee la sala por `departureTimeout`/`emptyTimeout`. El invariante de seguridad (no cuenta para la presencia de admin) se cumple igual. Misma clase de limitación que ya documenta D3, y se declara en voz alta en lugar de agregar un scheduler fuera de alcance.

### D11 — Rechazo de `::` en el resolver de códigos: `404`, no `400`

`RoomResolverService` se autodeclara "the ONLY place in the codebase allowed to query `rooms` by code for live traffic". Se agrega `assertResolvableCode(code)` al inicio de los tres caminos públicos (`resolveJoinable`, `lockJoinable`, `findPoolOccupant`), lanzando `NotFoundException('No existe una sala con el código "…"')` ante cualquier código que contenga `BREAKOUT_NAME_SEPARATOR`.

**Justificación de `404` y no `400`**: un nombre de mini sala no es un código mal formado, es un identificador de otro espacio de nombres. Responder "no existe" no le revela a nadie el esquema interno de nombres — mismo criterio que la autorización de la línea de tiempo, que ya devuelve 404 y no 403 para no filtrar la existencia de sesiones ajenas. El rechazo va en el resolver y no en los DTOs porque ahí está el *choke point* que el archivo ya garantiza: un consumidor nuevo hereda la guarda sin tener que acordarse de ella.

### D12 — Aviso de traslado por el socket de sala, pero el token nunca viaja por ahí

| Opción | Tradeoff | Decisión |
|---|---|---|
| Socket.io de sala emite la **señal** `breakout:assigned`; el cliente pide el token por HTTP autenticado | Dos pasos | **Elegida** |
| El socket emite la señal **con el token** | Un `AccessToken` es una credencial; mandarla por un canal de broadcast agranda el radio de daño de cualquier error de ruteo, y saca la emisión de tokens del único camino auditado que escribe `call_participant_identities` | Rechazada |
| `removeParticipant` y que el cliente, al ver `PARTICIPANT_REMOVED`, consulte dónde ir | UX al revés: primero te cortan, después averiguás; y un round trip extra con el usuario desconectado | Rechazada |
| Polling desde el cliente | Latencia y costo constante para un evento raro | Rechazada |

**Por qué el socket acá sí, cuando D5 del diseño anterior lo rechazó**: D5 rechazó el socket para el **cierre terminal**, por una carrera inherente — el mensaje compite con el teardown del propio socket. Esto es otro problema: no hay teardown. El participante sigue conectado al socket de la sala *durante* el cambio de sala de LiveKit, porque el socket es por sala de la app y las mini salas comparten el `roomId` del padre. Y el precedente ya existe: el socket de sala es el canal establecido para controles del admin sobre la sala (bloqueo de medios, toggle de foco por nombre).

---

## Modelo de datos

Todo aditivo. `rooms`, `roomMembers`, `call_events` (salvo el ancho de `room_code`), `call_session_participants` y `call_history` no cambian de semántica.

### `call_breakout_rooms` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk defaultRandom` | |
| `room_id` | `uuid not null → rooms(id) on delete cascade` | La sala **padre** |
| `livekit_room_name` | `varchar(40) not null` | `${roomCode}::breakout-N` — **unique** |
| `parent_livekit_room_sid` | `varchar(64)` | Ancla del grupo (D5.2); capturado al crear |
| `label` | `varchar(60) not null` | Etiqueta visible; default `Mini sala N` |
| `leave_policy` | `varchar(16) not null default 'locked'` | `'locked' \| 'free_return'` |
| `auto_close_at` | `timestamp` | `null` = sin timer |
| `closed_at` | `timestamp` | `null` = abierta. Objetivo del compare-and-set de cierre |
| `created_at` | `timestamp not null defaultNow` | |

Índices: `unique(livekit_room_name)`, `index(room_id, closed_at)`.

`leave_policy` es `varchar(16)` con una unión de TS y no un `pgEnum`, siguiendo el precedente de `call_sessions.close_reason` (`varchar(32)` con la unión documentada en comentario): un `ALTER TYPE` de enum en Postgres es mucho más caro de revertir que un valor nuevo en una unión, y este campo es operativo, no una taxonomía de dominio.

**Índice `N`**: es el primer *slot* libre en `1..MAX_BREAKOUT_ROOMS` entre las filas **abiertas** del `room_id`. Los nombres se reusan entre ciclos abrir/cerrar, y `unique(livekit_room_name)` hace que una carrera de dos creaciones simultáneas del mismo slot falle en la base en vez de producir dos filas apuntando a la misma sala de LiveKit. El cliente reintenta con el siguiente slot. Sin secuencias ni contadores en memoria.

### `call_breakout_occupants` (nueva) — ver D5.1

### Cambios en tablas existentes

| Tabla | Cambio | Tipo |
|---|---|---|
| `call_sessions` | `+ call_group_id varchar(64)` nullable | Aditivo |
| `call_sessions` | `room_code` `varchar(20)` → `varchar(40)` | Ensanche, sin reescritura |
| `call_events` | `room_code` `varchar(20)` → `varchar(40)` | Ensanche, sin reescritura (**bloqueante**, D5.4) |

---

## Contratos

### `CallGroupResolverService` (nuevo — `src/modules/calls/call-group-resolver.service.ts`)

```ts
@Injectable()
export class CallGroupResolverService {
  /**
   * El núcleo de seguridad del cambio. Devuelve [roomCode] cuando el grupo no
   * tiene mini salas abiertas y no vencidas — SIN excepción y SIN depender de
   * ninguna configuración. roomId null (sesión sin correlación de identity
   * conocida) también degenera a [roomCode].
   */
  async resolveCallGroupRoomNames(roomId: string | null, roomCode: string): Promise<string[]>;

  /** Mini sala → ancla padre. Código sin '::' se devuelve tal cual, sin consultar. */
  async resolveGroupAnchor(
    livekitRoomSid: string,
    roomCode: string,
  ): Promise<{ parentSid: string; parentCode: string }>;

  /** Misma consulta, otra proyección: filas abiertas con auto_close_at vencido. */
  async findExpiredBreakouts(roomId: string): Promise<OpenBreakout[]>;
}
```

### `BreakoutRoomsService` (nuevo — `src/modules/calls/breakout-rooms.service.ts`)

```ts
export type LeavePolicy = 'locked' | 'free_return';
export interface BreakoutRoomView {
  id: string; livekitRoomName: string; label: string;
  leavePolicy: LeavePolicy; autoCloseAt: Date | null;
  occupants: { livekitIdentity: string; displayName: string; userId: string | null }[];
}

@Injectable()
export class BreakoutRoomsService {
  /** 503 si MAX_BREAKOUT_ROOMS no es un entero en 0..3 (fail-fast, patrón MAX_ROOM_PARTICIPANTS).
   *  403 si el solicitante no es administrador. 409 si el tope ya está alcanzado. */
  async create(roomId: string, roomCode: string, actor: RoomParticipant,
               dto: { label?: string; leavePolicy?: LeavePolicy; autoCloseInMinutes?: number }): Promise<BreakoutRoomView>;

  async list(roomId: string, actor: RoomParticipant): Promise<BreakoutRoomView[]>;

  async updatePolicy(breakoutId: string, roomId: string, actor: RoomParticipant,
                     dto: { leavePolicy?: LeavePolicy; autoCloseInMinutes?: number | null }): Promise<BreakoutRoomView>;

  /** Admin: traslada a un occupant. Valida rol, capacidad del destino y pertenencia al grupo.
   *  Escribe la identity nueva (D7) y la asignación, y emite el AccessToken acotado a la mini sala. */
  async moveIn(breakoutId: string, roomId: string, actor: RoomParticipant,
               target: { livekitIdentity: string }): Promise<{ targetIdentity: string }>;

  /** Token de la mini sala para quien tiene una asignación abierta (y para un admin del grupo,
   *  que monitorea de a una sala a la vez). Único punto de emisión además de join(). */
  async issueBreakoutToken(breakoutId: string, roomId: string,
                           requester: RoomParticipant): Promise<{ url: string; token: string; roomName: string; participantLimit: number }>;

  /** Autosalida. 403 BREAKOUT_RETURN_LOCKED si la política es 'locked' y el solicitante no es admin.
   *  No emite token de la principal: cierra la asignación y el cliente reusa join(). */
  async selfReturn(breakoutId: string, roomId: string, requester: RoomParticipant): Promise<void>;

  /** Cierre manual: compare-and-set sobre closed_at + deleteRoom tolerante + cierre de asignaciones. */
  async close(breakoutId: string, roomId: string, actor: RoomParticipant, reason: 'manual' | 'auto' | 'cascade'): Promise<void>;
  async closeAll(roomId: string, actor: RoomParticipant): Promise<void>;

  /** Cascada desde el cierre de la principal. Sin actor: lo invoca el camino de cierre forzado. */
  async closeGroupBreakouts(roomId: string | null, parentCode: string): Promise<void>;

  /** Reconciliación perezosa (D10): cierra vencidas y marca las que LiveKit ya no tiene. Nunca tira. */
  async reconcileGroup(roomId: string): Promise<void>;
}
```

### `CallsService` (modificado)

```ts
// ANTES: assertHostConnected(client, roomCode, roomId)
// AHORA: la lista reemplaza al nombre único; [roomCode] recorre el fast path de D2.
private async assertHostConnected(
  client: RoomServiceClient,
  groupRoomNames: string[],
  roomId: string,
): Promise<void>;

// Nuevo, solo en el camino no-admin y solo si el grupo tiene mini salas abiertas (D9).
private async assertBreakoutReturnAllowed(roomId: string, sourceIdentity: string): Promise<void>;
```

Orden dentro de `join()`, sin mover nada de lo existente:

```
getByCodeOrThrow → assertBound(roomId) → config → resolveLocalRole → createRoom
  └─ role === 'administrador' ? → SIGUE IGUAL, sin consultas nuevas
  └─ no-admin:
       names = resolveCallGroupRoomNames(room.id, roomCode)
       if (names.length > 1) assertBreakoutReturnAllowed(room.id, participant.sub)
       assertHostConnected(client, names, room.id)
→ upsert identity → AccessToken → callHistory → touchEntry   [todo sin cambios]
```

### `CallSessionCloseService` (modificado)

```ts
// roomId lo aporta el llamador: CallsWebhookService.onParticipantLeft ya consulta
// call_participant_identities por identity, y esa fila YA tiene el roomId del padre
// (decisión 8 de la propuesta). Cero consultas nuevas en el camino de webhook.
async onAdminLeft(livekitRoomSid: string, roomCode: string, roomId: string | null): Promise<void>;

private async hasConnectedAdmin(roomCode: string, roomId: string | null): Promise<boolean>;
private async listGroupIdentities(groupRoomNames: string[]): Promise<string[]>; // D2 + D3
private async claimAndClose(parentSid: string, parentCode: string, roomId: string | null): Promise<void>;
```

`pendingCloses` se sigue indexando por el **sid del padre** (`parentSid`), no por el sid de la sala donde ocurrió el `participant_left`: así dos admins que se van de dos salas distintas del mismo grupo siguen produciendo **un** timer. Es la capa 1 de D4 generalizada a grupo con el mismo mecanismo.

---

## Flujo 1 — Traslado de un participante a una mini sala

```
Admin(cliente)   BreakoutRoomsController        Postgres        LiveKit      RoomSocket   Participante(cliente)
   │                      │                        │               │             │              │
   ├ POST /calls/:code/breakouts ────────────────────────────────────────────────────────────────┤
   │                      ├ rol del actor = administrador? no → 403                              │
   │                      ├ MAX_BREAKOUT_ROOMS entero en 0..3? no → 503 (fail-fast)              │
   │                      ├ filas abiertas del room_id ───────────►│             │              │
   │                      │   count >= MAX → 409 'Alcanzaste el máximo de mini salas'            │
   │                      ├ listRooms([code]) → parentSid ────────────────────────►│             │
   │                      ├ insert call_breakout_rooms (slot libre N) ────────────►│             │
   │                      │   unique(livekit_room_name) viola → reintento con N+1  │             │
   │                      ├ createRoom(`code::breakout-N`, maxParticipants, 300/30) ►│           │
   │◄ 201 BreakoutRoomView┤                        │               │             │              │
   │                      │                        │               │             │              │
   ├ POST …/breakouts/:id/participants {livekitIdentity} ──────────┤             │              │
   │                      ├ actor admin? destino abierto y del mismo room_id? ───►│             │
   │                      ├ listParticipants(destino).length < MAX_ROOM_PARTICIPANTS ─►│         │
   │                      │   lleno → 409                         │               │             │
   │                      ├ identity origen → fila de correlación (userId, name, role, roomId)  │
   │                      ├ insert call_participant_identities ───►│  identity NUEVA = randomUUID() (D7)
   │                      │   mismo roomId / userId / displayName / roleAtIssue   │             │
   │                      ├ insert call_breakout_occupants ───────►│  source_identity = sub del pase
   │                      │                        │               │             │              │
   │                      ├ emit 'breakout:assigned' {breakoutId, label, leavePolicy} ──────────►│
   │                      │        (SEÑAL, nunca el token — D12)   │               │             │
   │                      ├ removeParticipant(code, identityOrigen) ──────────────►│             │
   │◄ 202 ────────────────┤                        │               │             │              │
   │                      │                        │               │             │              │
   │                      │◄ POST …/breakouts/:id/token ──────────────────────────────────────────┤
   │                      ├ ¿asignación abierta para este sub? no → 403           │             │
   │                      ├ AccessToken{ room: `code::breakout-N`, identity: la NUEVA } ─────────►│
   │                      │                        │               │             │   switchRoom(session)
   │                      │                        │               │             │   <LiveKitRoom key=roomName>
   │                      │                        │               │             │   desmonta y reconecta
   │                      │                        │               │             │              │
   │                      │          LiveKit emite participant_left(principal) y                │
   │                      │          participant_joined(mini sala) por el endpoint ya existente  │
```

**Puntos de cuidado del flujo**:

- `removeParticipant` sobre la principal se invoca **después** de escribir la asignación. Si el cliente nunca pide el token, la asignación abierta queda registrada y el admin puede recuperarlo con "devolver a todos" — la mitigación del riesgo "participante varado" que la propuesta ya declaró.
- El `participant_left` de la principal que genera el traslado pertenece a la identity **vieja**. Si quien se traslada era admin, el camino de cierre forzado se dispara y la evaluación a nivel grupo lo encuentra en la mini sala con su identity **nueva** → no cierra. Ese es el Flujo 2.
- El cliente cambia de sala con `key={call.session.roomName}` en `<LiveKitRoom>`: desmonte y montaje completos. Cambiar solo `token` sobre un `<LiveKitRoom>` montado no reconecta de forma confiable.

## Flujo 2 — Control de acceso a nivel grupo: el admin se va de la principal pero sigue en una mini sala

```
LiveKit        CallsWebhookService        CloseService      GroupResolver      Postgres     LiveKit
  │                    │                       │                 │                │           │
  ├ participant_left (principal, identity vieja del admin) ──────────────────────────────────────┤
  │                    ├ firma HMAC + insert call_events ON CONFLICT(id) ─────────►│           │
  │                    ├ select roleAtIssue, roomId from call_participant_identities ►│         │
  │                    │   roleAtIssue != 'administrador' → fin (sin cambios)        │          │
  │                    ├ onAdminLeft(sid, 'A1B2C3', roomId) ─────►│                 │          │
  │                    │                       ├ resolveGroupAnchor('A1B2C3') → sin '::' → tal cual, 0 consultas
  │                    │                       ├ pendingCloses.has(parentSid)? → sí: fin
  │                    │                       ├ hasConnectedAdmin ──►│                │        │
  │                    │                       │   resolveCallGroupRoomNames(roomId,'A1B2C3') ─►│
  │                    │                       │     filas abiertas y NO vencidas: breakout-1   │
  │                    │                       │   → ['A1B2C3', 'A1B2C3::breakout-1']           │
  │                    │                       │   length > 1 → camino multi-sala (D3)          │
  │                    │                       ├ listRooms([ambas]) ─────────────────────────────►│
  │                    │                       │   → ambas existen                   │           │
  │                    │                       ├ listParticipants('A1B2C3') → [p2, p3] ─────────►│
  │                    │                       ├ listParticipants('…::breakout-1') → [adminNuevo, p4] ►│
  │                    │                       ├ identities unidas → UNA consulta ──────────────►│
  │                    │                       │   where livekit_identity in (…)                │
  │                    │                       │     and room_id = roomId                       │
  │                    │                       │     and role_at_issue = 'administrador'        │
  │                    │                       │   → 1 fila (la identity NUEVA del admin, mismo roomId por D7)
  │                    │                       ├ hasAdmin = true → NO se agenda nada            │
  │◄ 200 ──────────────┤                       │                 │                │           │
  ·
  · Los participantes que quedaron en la principal NO sufren cierre forzado:
  · el grupo tiene un admin conectado, aunque ninguna sala individual lo tenga "en la principal".
  ·
  · Contraste — el admin cierra también el navegador en la mini sala:
  ├ participant_left (mini sala, identity nueva del admin) ───────────────────────────────────────┤
  │                    ├ select roleAtIssue, roomId → 'administrador', roomId del PADRE (D7)     │
  │                    ├ onAdminLeft(sidBreakout, 'A1B2C3::breakout-1', roomId) ──►│             │
  │                    │                       ├ resolveGroupAnchor → tiene '::' → lee
  │                    │                       │   call_breakout_rooms.livekit_room_name ───────►│
  │                    │                       │   → { parentSid, parentCode: 'A1B2C3' }         │
  │                    │                       ├ pendingCloses indexado por parentSid (capa 1 por GRUPO)
  │                    │                       ├ hasConnectedAdmin(grupo) → false                │
  │                    │                       └ agenda re-chequeo a T+15s (D3, sin cambios)     │
  ·                                            ·
  ·                                  T+15s     ├ hasConnectedAdmin(grupo) → ¿volvió algún admin a CUALQUIER sala?
  ·                                            │   sí → cancela. no → cascada (Flujo 3)
```

**La propiedad que este flujo garantiza**: el cierre forzado dispara si y solo si no queda ningún `administrador` conectado en **ninguna** sala del grupo. Con cero mini salas abiertas, `resolveCallGroupRoomNames` devuelve un elemento, `listGroupIdentities` recorre el fast path de D2 y la evaluación es la de hoy, llamada por llamada.

## Flujo 3 — Cierre de la principal con mini salas activas: cascada sobre el grupo

```
CloseService            BreakoutRoomsService        Postgres                    LiveKit
    │                          │                       │                          │
    ├ claimAndClose(parentSid, 'A1B2C3', roomId)        │                          │
    ├ ensureSessionRow(parentSid, 'A1B2C3') ───────────►│  (sin cambios: creación perezosa)
    ├ UPDATE call_sessions SET forced_close_at=now(), close_reason='last_admin_left'
    │   WHERE livekit_room_sid=$parentSid AND forced_close_at IS NULL RETURNING id ►│
    │   0 filas → otro handler ya reclamó → fin (capa 2 de D4, sin cambios)        │
    │                          │                       │                          │
    ├ closeGroupBreakouts(roomId, 'A1B2C3') ──────────►│                          │
    │                          ├ select filas abiertas del room_id ──────────────►│
    │                          │   para cada mini sala, en orden:                  │
    │                          ├ UPDATE call_breakout_rooms SET closed_at=now()    │
    │                          │   WHERE id=$1 AND closed_at IS NULL RETURNING id ►│  ← compare-and-set
    │                          │   0 filas → ya cerrada, se saltea                 │     por mini sala
    │                          ├ UPDATE call_breakout_occupants SET returned_at=now()
    │                          │   WHERE breakout_room_id=$1 AND returned_at IS NULL ►│
    │                          ├ clearTimeout del atajo en proceso, si había        │
    │                          ├ deleteRoom('A1B2C3::breakout-N') ─────────────────────────────►│
    │                          │   error → logger.log('La sala de medios ya estaba cerrada')   │
    │                          │   NUNCA logger.error, NUNCA rethrow (capa 3 de D4)            │
    │◄ nunca tira ─────────────┤                       │                          │
    │                          │                       │                          │
    ├ deleteRoom('A1B2C3')  ← la PRINCIPAL al final ───────────────────────────────►│
    │   error → logger.log, sin rethrow                 │                          │
    ·
    · LiveKit emite room_finished de cada mini sala y de la principal por el endpoint existente.
    · Cada uno materializa su propia call_sessions; las de mini sala llevan
    · call_group_id = parentSid (D5.3), resuelto desde call_breakout_rooms.
```

**Orden: mini salas primero, principal al final.** Justificación: el reclamo del cierre sobre `call_sessions` del padre es el **único** punto de exclusión del grupo entero (capa 2 de D4, ya persistida y ya probada); hacerlo primero garantiza que una cascada duplicada sea un no-op completo. Cerrar las mini salas antes evita el estado peor: occupants vivos en una mini sala cuyo padre ya no existe, viendo medios sin ninguna supervisión posible y sin forma de volver. Cada paso de la cascada es idempotente por su propio compare-and-set, así que una cascada interrumpida a la mitad converge en el siguiente disparo sin duplicar efectos.

**Otros disparadores de la cascada**, los dos aditivos sobre huecos ya existentes:

| Disparador | Acción |
|---|---|
| `room_finished` de la **principal** (LiveKit la reapeó por su cuenta) | `closeGroupBreakouts` — un grupo no sobrevive a su padre |
| `room_finished` de una **mini sala** | Marca `closedAt`, cierra asignaciones, stampea `call_group_id` en su `call_sessions` |
| `autoCloseAt` vencido | `close(reason: 'auto')` por timer o por reconciliación (D10) |
| Cierre manual del admin (una o todas) | `close` / `closeAll`, inmediato y sin cuenta regresiva (precedente de `call-host-gate`) |

---

## Cliente

| Pieza | Ruta | Cambio |
|---|---|---|
| `useCallSession.ts` | `client/src/features/calls/` | **Modificar**. `switchRoom(session: CallSession)` reemplaza `current.current` y `session` de forma atómica — `joinCall` no sirve: su guarda `if (pending.current \|\| current.current) return;` aborta cualquier traslado. `EndReason` gana `'breakout-closed'`; `CallStatus` gana `'switching'` para que el desmonte del traslado no se interprete como fallo |
| `MeetingRoom.tsx` | ídem | **Modificar**. `key={call.session.roomName}` en `<LiveKitRoom>` fuerza desmonte/montaje completos por traslado. En `onDisconnected`, si `status === 'switching'` el reason se ignora (no es `leaveCall()` ni `failed()`) |
| `BreakoutPanel.tsx` | ídem | **Crear**. Panel solo-admin: crear bajo tope, toggle de política, timer opcional, arrastrar/elegir participante, cerrar una o todas, "devolver a todos" |
| `BreakoutBanner.tsx` | ídem | **Crear**. Para el occupant: etiqueta de la mini sala, botón "Volver" solo si `free_return`, y texto explícito cuando es `locked` ("el host te va a devolver" — mitigación del riesgo "percibido como estar atrapado") |
| `useRoomSocket` | `client/src/features/chat/` | **Modificar**. Escucha `breakout:assigned`, `breakout:closed` |
| `lib/breakouts.ts` | `client/src/lib/` | **Crear**. Cliente HTTP del controlador; mapea `BREAKOUT_RETURN_LOCKED` a su cadena traducida por **código**, nunca por texto (precedente `NO_HOST_CONNECTED` en `lib/calls.ts`) |

---

## Cambios de archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `src/modules/calls/call-group.ts` | Crear | Funciones puras: nombres, parseo, armado de lista de grupo, filtro de vencidas (D1) |
| `src/modules/calls/call-group-resolver.service.ts` | Crear | `resolveCallGroupRoomNames`, `resolveGroupAnchor`, `findExpiredBreakouts` |
| `src/modules/calls/breakout-rooms.service.ts` | Crear | Ciclo de vida, política, traslados, cierre, reconciliación |
| `src/modules/calls/breakout-rooms.controller.ts` | Crear | Rutas bajo `@Controller('calls')` + `@UseGuards(RoomAccessGuard)` |
| `src/modules/calls/dto/*.dto.ts` | Crear | `CreateBreakoutRoomDto`, `UpdateBreakoutRoomDto`, `MoveParticipantDto` |
| `src/db/schema.ts` | Modificar | 2 tablas nuevas, `call_sessions.callGroupId`, ensanche de los dos `room_code` |
| `drizzle/00XX_breakout_rooms.sql` | Crear | Migración generada con `pnpm drizzle-kit generate` |
| `src/modules/calls/calls.service.ts` | Modificar | `assertHostConnected` sobre lista; `assertBreakoutReturnAllowed`; cortocircuito de admin intacto |
| `src/modules/calls/call-session-close.service.ts` | Modificar | Ancla de grupo, presencia multi-sala, cascada |
| `src/modules/calls/calls-webhook.service.ts` | Modificar | `roomId` al `onAdminLeft`; `onParticipantJoined` aplica `locked`; `room_finished` cascada + `call_group_id` |
| `src/modules/calls/calls.module.ts` | Modificar | Registrar providers y controller nuevos |
| `src/modules/rooms/room-resolver.service.ts` | Modificar | `assertResolvableCode` rechaza `::` (D11) |
| `src/modules/chat/chat.gateway.ts` | Modificar | Emitir `breakout:assigned` / `breakout:closed` (señal, sin token) |
| `client/src/features/calls/*` | Crear/Modificar | Ver tabla de Cliente |
| `.env.example`, `deploy/*` | Modificar | `MAX_BREAKOUT_ROOMS=3` |

---

## Tests de caracterización obligatorios (antes de tocar `assertHostConnected` / `hasConnectedAdmin`)

TDD estricto está activo. Estos tests **fijan el comportamiento actual** y se escriben y se ven en verde **antes** de cualquier edición de los dos evaluadores. La fase de tasks debe ordenarlos primero, en su propio commit.

**Ya existen en el repo** y deben quedar en verde sin cambios de aserción (`calls.service.spec.ts` → `describe('CallsService: gate de administrador (host-gate)')`, 7 casos; `call-session-close.service.spec.ts`, 11 casos). No alcanzan: ninguno fija la **cardinalidad** que el refactor generaliza.

Nuevos, a escribir primero:

| # | Archivo | Qué fija |
|---|---|---|
| C1 | `calls.service.spec.ts` | `assertHostConnected` llama a `listParticipants` **exactamente una vez** y con el `roomCode` de la sala principal |
| C2 | `calls.service.spec.ts` | La consulta a `call_participant_identities` del gate filtra por `roomId` **y** por `roleAtIssue='administrador'` — el filtro por sala es parte del contrato, no un detalle |
| C3 | `calls.service.spec.ts` | Un `administrador` no dispara **ninguna** consulta de presencia ni de mini salas: cero `listParticipants`, cero lecturas de `call_breakout_rooms` (es la invariante que D9 promete) |
| C4 | `call-session-close.service.spec.ts` | `hasConnectedAdmin` **hoy no filtra por `roomId`**: solo por identity + `roleAtIssue`. Hay que dejarlo escrito antes de agregar el filtro de grupo, porque es un cambio de alcance de la consulta |
| C5 | `call-session-close.service.spec.ts` | Las tres ramas de `hasConnectedAdmin`: lista vacía → `false`; admin presente → `true`; `listParticipants` tira → `true` (fail-safe) |
| C6 | `call-session-close.service.spec.ts` | `onAdminLeft` usa el `roomCode` recibido **tal cual**, sin normalizar ni derivar — es el punto exacto donde se inserta `resolveGroupAnchor` |
| C7 | `call-session-close.service.spec.ts` | `claimAndClose` llama a `deleteRoom` con **un solo** nombre, y reclama sobre el `livekit_room_sid` que recibió — la cardinalidad 1 que la cascada pasa a N |
| C8 | `call-group.spec.ts` (nuevo) | `buildCallGroupRoomNames(code, [], now)` → `{ names: [code], expired: [] }`. El caso degenerado como test propio y aislado, sin base ni LiveKit |
| C9 | `calls.service.spec.ts` | Equivalencia end-to-end del camino degenerado: con cero filas en `call_breakout_rooms`, un no-admin produce la **misma secuencia** de llamadas a LiveKit que antes del cambio |

Regla para la fase de apply: si para que pase uno de los tests existentes hay que **cambiar una aserción de comportamiento**, es una regresión, no una actualización de test. Extender *fixtures* de mocks es aceptable (D9); cambiar expectativas no.

## Estrategia de pruebas

| Capa | Qué probar | Cómo |
|---|---|---|
| Unit (puro) | `buildCallGroupRoomNames`: sin mini salas, con 1-3, con una vencida excluida, con una cerrada ignorada, orden estable con la principal primero. `parseBreakoutRoomName`: nombre válido, código sin `::`, `::` suelto, índice no numérico | Arrays a mano, sin IO |
| Unit (servidor) | Gate de grupo: admin en mini sala sostiene el grupo; cero admins en todas las salas → cierre; `listRooms` tira → no cierra; mini sala ausente de `listRooms` → tratada como vacía y reconciliada | `RoomServiceClient` y `db` mockeados |
| Unit (servidor) | Cascada: un reclamo del padre → N `deleteRoom` + 1 de la principal; cascada duplicada → cero `deleteRoom` nuevos; `deleteRoom` de una mini sala falla → no tira y no corta la cascada | Timers falsos de Jest |
| Unit (servidor) | `locked`: `join()` de un occupant `locked` → 403 `BREAKOUT_RETURN_LOCKED` sin emitir token; `free_return` → token emitido; `administrador` nunca bloqueado; `participant_joined` de un occupant `locked` en la principal → `removeParticipant` | `db` mockeado |
| Unit (servidor) | Tope: `MAX_BREAKOUT_ROOMS` no entero o fuera de 0..3 → 503 fail-fast; `=0` → creación rechazada **y** `resolveCallGroupRoomNames` devuelve `[roomCode]`; crear la cuarta → 409 con mensaje explícito |  |
| Unit (servidor) | Traslado: identity nueva ≠ `sub`; fila de correlación con el `roomId` del padre y el `roleAtIssue` conservado; destino lleno → 409; destino de otro grupo → 403 |  |
| Unit (servidor) | `autoCloseAt`: vencida excluida de los nombres del grupo sin que haya corrido ningún timer; `reconcileGroup` la cierra; `reconcileGroup` nunca tira |  |
| Unit (servidor) | `RoomResolverService`: `resolveJoinable`, `lockJoinable` y `findPoolOccupant` rechazan con 404 cualquier código con `::`, sin consultar `rooms` |  |
| Unit (servidor) | Webhook: evento de una mini sala se persiste con su `room_code` completo (regresión del ensanche de D5.4) y se atribuye al grupo padre |  |
| Unit (cliente) | `useCallSession.switchRoom` reemplaza la sesión sin pasar por `'error'`; `MeetingRoom` ignora `onDisconnected` mientras `status === 'switching'`; `BreakoutBanner` oculta "Volver" si `locked` | RTL |
| E2E | Admin crea 2 mini salas, traslada a dos participantes, el aislamiento de medios se verifica por ausencia de tracks; `locked` rechaza la autosalida; cerrar todas devuelve a todos | Playwright |
| Carga (manual, bloqueante antes de uso real) | 1 principal + 3 mini salas en la t3.medium: CPU, ancho de banda y ráfaga de webhooks 4x | Según la dependencia ya declarada en la propuesta |

---

## Migración y despliegue

`pnpm drizzle-kit generate`. **Aditiva y sin downtime**, en este orden:

1. `CREATE TABLE call_breakout_rooms` + `CREATE TABLE call_breakout_occupants` + sus índices. Ninguna tabla existente se toca.
2. `ALTER TABLE call_sessions ADD COLUMN call_group_id varchar(64)` — nullable, sin default, sin backfill (las sesiones históricas no pertenecen a ningún grupo).
3. `ALTER TABLE call_events ALTER COLUMN room_code TYPE varchar(40)` y lo mismo en `call_sessions`. Ensanchar un `varchar` en Postgres es un cambio de catálogo: no reescribe la tabla y no toma un lock largo. Nada de lo que hoy quepa en 20 deja de caber en 40, así que el paso es seguro con tráfico en vivo y **debe desplegarse antes** de que exista cualquier mini sala.
4. Desplegar la API con `MAX_BREAKOUT_ROOMS=0`. La feature queda apagada: no se puede crear ninguna mini sala, `resolveCallGroupRoomNames` devuelve `[roomCode]` para toda llamada y el control de acceso recorre el fast path de D2. **Comportamiento idéntico al actual, verificable en producción antes de habilitar nada.**
5. Subir `MAX_BREAKOUT_ROOMS` a 3 recién después de la prueba de carga en la instancia EC2.

**Precondición de drizzle-kit (gotcha ya conocido del proyecto)**: `drizzle-kit` ignora el `DATABASE_URL` correcto del `.env`; hay que pasarlo inline en el comando.

**Rollback**, alineado con los tres niveles de la propuesta:

| Nivel | Acción | Efecto |
|---|---|---|
| 1 — sin deploy | `MAX_BREAKOUT_ROOMS=0` | Killswitch. Sin filas nuevas; el control de acceso y el cierre forzado vuelven al camino de hoy por construcción (D2), no por equivalencia argumentada |
| 2 — revert parcial | Revertir solo el commit del control de acceso a nivel grupo | Restaura `assertHostConnected`/`hasConnectedAdmin` literales por sala. Las tablas de mini sala quedan inertes. **Requisito para la fase de tasks: ese commit va solo y no mezcla CRUD ni UI** |
| 3 — revert completo | Revertir el cambio + `down` de la migración | `DROP` de las dos tablas y de `call_group_id`. El ensanche de `room_code` **se deja** (revertirlo sí podría truncar datos, y dejarlo es inocuo). `call_events`, `call_sessions`, `call_session_participants` y `call_history` conservan cada fila y su semántica |

---

## Limitaciones declaradas y preguntas abiertas

- [ ] **Ventana de fuga de `locked`** (D8): entre que un occupant reconecta a la principal con su token de 15 min todavía válido y que el webhook lo expulsa, hay uno o dos segundos de presencia real de medios. Es el techo de lo que LiveKit permite sin un hook de admisión del lado servidor. Debe quedar escrito en el spec de la capacidad, no disimulado.
- [ ] **`autoCloseAt` tras un reinicio sin interacción** (D10): el invariante de seguridad se cumple siempre (una mini sala vencida nunca sostiene viva a la llamada), pero el teardown que devuelve a la gente puede demorarse hasta que llegue cualquier evento del grupo. Sin scheduler nuevo, deliberadamente.
- [ ] **Chat compartido entre grupos** (C2 de la propuesta, sin cambios): el chat de la sala principal sigue siendo un canal de texto cruzado durante un examen. Si la integridad del examen lo exige, es un cambio propio.
- [ ] **Techo de la t3.medium**: el tope de 3 mini salas es una decisión de producto, no una capacidad verificada. La prueba de carga es bloqueante antes de que un examen real dependa de esto.
- [ ] **Harness de mocks de `calls.service.spec.ts`** (D9): queda por confirmar en la fase de apply cuánta extensión *aditiva* de fixtures necesita la consulta nueva del camino no-admin. Cualquier cambio de aserción es una regresión, no una actualización.
