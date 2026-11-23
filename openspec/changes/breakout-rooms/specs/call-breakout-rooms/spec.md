# Especificación: call-breakout-rooms

## Propósito

Define el ciclo de vida de las mini salas ("breakout rooms") dentro de una videollamada: creación bajo tope configurable, política de salida por mini sala, traslado de participantes con reemisión de token, cierre manual y cierre automático por timer, y el cierre en cascada desde la sala principal. Las mini salas son filas operativas ligadas a la sala padre, nunca entidades de la tabla `rooms`: no tienen `code` propio, no tienen `roomMembers`, y no son resolubles por `RoomResolverService`.

## Requisitos

### Requirement: Tope configurable de mini salas simultáneas

El sistema MUST limitar la cantidad de mini salas activas simultáneas por llamada al valor configurado en `MAX_BREAKOUT_ROOMS`. El sistema MUST validar ese valor con el mismo patrón fail-fast que `MAX_ROOM_PARTICIPANTS`: si `MAX_BREAKOUT_ROOMS` no es un entero dentro del rango `0-3`, el sistema MUST rechazar la operación con un error explícito en lugar de aplicar un valor por defecto silencioso. El valor por defecto cuando la variable no está definida MUST ser `3`.

#### Scenario: Crear mini sala dentro del tope

- GIVEN una llamada con menos mini salas activas que `MAX_BREAKOUT_ROOMS`
- WHEN un `administrador` de la sala crea una mini sala nueva
- THEN la mini sala se crea y queda activa

#### Scenario: Crear mini sala en el tope

- GIVEN una llamada con exactamente `MAX_BREAKOUT_ROOMS` mini salas activas
- WHEN un `administrador` intenta crear una mini sala adicional
- THEN la solicitud se rechaza con un mensaje explícito
- AND no se crea ninguna fila de mini sala nueva

#### Scenario: Configuración fuera de rango

- GIVEN un despliegue con `MAX_BREAKOUT_ROOMS` configurado fuera del rango `0-3` o con un valor no entero
- WHEN se intenta crear una mini sala
- THEN la operación se rechaza con un error explícito de configuración
- AND no se crea ninguna fila de mini sala

### Requirement: Apagado total de la funcionalidad vía tope en cero

Cuando `MAX_BREAKOUT_ROOMS` está configurado en `0`, el sistema MUST rechazar la creación de cualquier mini sala nueva para toda llamada, sin requerir ningún otro cambio de código o de datos.

#### Scenario: Tope en cero

- GIVEN un despliegue con `MAX_BREAKOUT_ROOMS=0`
- WHEN un `administrador` intenta crear una mini sala
- THEN la solicitud se rechaza con un mensaje explícito
- AND ninguna mini sala llega a crearse en todo el despliegue

### Requirement: Política de salida por mini sala

Cada mini sala MUST tener una política de salida explícita, definida por el `administrador` al crearla: `locked` (valor por defecto) o `free_return`. El sistema MUST permitir que un `administrador` cambie esa política mientras la mini sala permanece abierta.

#### Scenario: Crear mini sala sin especificar política

- GIVEN un `administrador` que crea una mini sala sin indicar política de salida
- WHEN la mini sala se crea
- THEN su política de salida queda en `locked`

#### Scenario: Crear mini sala con política explícita

- GIVEN un `administrador` que crea una mini sala indicando política `free_return`
- WHEN la mini sala se crea
- THEN su política de salida queda en `free_return`

#### Scenario: Cambiar la política mientras la mini sala está abierta

- GIVEN una mini sala abierta con política `locked`
- WHEN un `administrador` la cambia a `free_return`
- THEN las solicitudes de retorno por cuenta propia de sus ocupantes pasan a aceptarse desde ese momento

### Requirement: Traslado de un participante hacia una mini sala

El sistema MUST permitir que un `administrador` de la sala traslade a un participante conectado hacia una mini sala activa del mismo grupo. El sistema MUST validar, antes de emitir el token nuevo, que quien solicita el traslado es `administrador` de la sala y que la mini sala destino tiene capacidad disponible. El sistema MUST emitir un token de acceso nuevo acotado al nombre de la mini sala destino para el participante trasladado.

#### Scenario: Traslado válido con capacidad disponible

- GIVEN una mini sala activa con capacidad disponible
- WHEN un `administrador` traslada a un participante conectado hacia esa mini sala
- THEN se emite un token de acceso nuevo acotado a la mini sala destino
- AND el participante queda habilitado para conectarse a esa mini sala

#### Scenario: Traslado rechazado por falta de capacidad

- GIVEN una mini sala activa que ya está en su capacidad máxima
- WHEN un `administrador` intenta trasladar a un participante hacia esa mini sala
- THEN la solicitud se rechaza con un mensaje explícito
- AND no se emite ningún token nuevo para ese participante

#### Scenario: Traslado solicitado por un no-administrador

- GIVEN un participante no-administrador
- WHEN intenta trasladar a otro participante hacia una mini sala
- THEN la solicitud se rechaza
- AND no se emite ningún token nuevo

### Requirement: Retorno de un participante a la sala principal

El sistema MUST permitir que un `administrador` devuelva a cualquier ocupante de una mini sala a la sala principal, sin importar la política de salida vigente. En una mini sala con política `free_return`, el sistema MUST permitir que el propio ocupante solicite su retorno a la sala principal. En una mini sala con política `locked`, el sistema MUST rechazar la solicitud de retorno hecha por el propio ocupante y MUST NOT emitir ningún token de la sala principal a partir de esa solicitud.

#### Scenario: Administrador devuelve a un ocupante

- GIVEN un ocupante en una mini sala, con cualquier política de salida
- WHEN un `administrador` lo devuelve a la sala principal
- THEN se emite un token nuevo acotado a la sala principal para ese participante

#### Scenario: Ocupante pide volver en política free_return

- GIVEN un ocupante en una mini sala con política `free_return`
- WHEN solicita volver a la sala principal por cuenta propia
- THEN se emite un token nuevo acotado a la sala principal

#### Scenario: Ocupante pide volver en política locked

- GIVEN un ocupante en una mini sala con política `locked`
- WHEN solicita volver a la sala principal por cuenta propia
- THEN la solicitud se rechaza del lado servidor
- AND no se emite ningún token de la sala principal

### Requirement: Expulsión de un ocupante `locked` que reconecta con un token previo

El token de la sala principal emitido antes del traslado sigue siendo técnicamente válido durante su vigencia (no existe forma de invalidarlo del lado de LiveKit). Por lo tanto, rechazar la emisión de un token nuevo NO es suficiente por sí solo para hacer cumplir la política `locked`: el sistema MUST además detectar, a partir de la conexión en vivo a la sala principal, a cualquier ocupante con una asignación abierta a una mini sala `locked`, y MUST expulsarlo de la sala principal sin intervención del `administrador`.

El sistema reconoce que esta expulsión ocurre después de que la conexión ya se estableció, por lo que existe una ventana breve y acotada de presencia real de medios en la sala principal antes de la expulsión. Esta ventana es una limitación aceptada y declarada, no un defecto a ocultar: es el límite de lo que LiveKit permite hacer cumplir sin un mecanismo de admisión del lado servidor anterior a la conexión.

#### Scenario: Ocupante locked reconecta a la principal con el token previo todavía vigente

- GIVEN un ocupante trasladado a una mini sala `locked`, cuyo token previo de la sala principal todavía no venció
- WHEN ese ocupante se reconecta a la sala principal usando ese token previo
- THEN el sistema detecta la conexión y expulsa al ocupante de la sala principal en una ventana breve y acotada
- AND esa ventana de presencia de medios antes de la expulsión queda documentada como limitación aceptada, no como ausencia de control

### Requirement: Cierre manual inmediato

El sistema MUST permitir que un `administrador` cierre una mini sala activa en cualquier momento. El cierre MUST ser inmediato, sin cuenta regresiva ni período de gracia. El sistema MUST devolver o desconectar a todos los ocupantes de la mini sala cerrada hacia la sala principal en el momento del cierre.

#### Scenario: Cierre manual de una mini sala con ocupantes

- GIVEN una mini sala activa con ocupantes conectados
- WHEN un `administrador` la cierra manualmente
- THEN la mini sala queda cerrada de inmediato
- AND todos sus ocupantes son devueltos a la sala principal sin demora

#### Scenario: Cierre de una mini sala ya cerrada

- GIVEN una mini sala que ya fue cerrada previamente
- WHEN un `administrador` intenta cerrarla de nuevo
- THEN la operación se rechaza con un mensaje explícito
- AND no se produce ningún efecto duplicado

#### Scenario: Cierre de una mini sala inexistente

- GIVEN un identificador de mini sala que no corresponde a ninguna mini sala de la llamada
- WHEN un `administrador` intenta cerrarla
- THEN la operación se rechaza con un mensaje explícito

### Requirement: Cierre automático por timer opcional

El sistema MUST permitir que un `administrador` defina, al crear o mientras la mini sala está abierta, un momento de cierre automático (`autoCloseAt`). El sistema MUST persistir ese valor de forma durable, no solo en memoria de proceso. Al transcurrir `autoCloseAt`, el sistema MUST forzar el retorno de todos los ocupantes de esa mini sala a la sala principal sin requerir ninguna acción del `administrador`.

#### Scenario: Timer definido y transcurrido

- GIVEN una mini sala con `autoCloseAt` definido en un momento futuro
- WHEN ese momento transcurre
- THEN todos los ocupantes de esa mini sala son devueltos a la sala principal
- AND la mini sala queda cerrada sin que el `administrador` haya actuado

#### Scenario: Mini sala sin timer definido

- GIVEN una mini sala creada sin `autoCloseAt`
- WHEN transcurre cualquier cantidad de tiempo
- THEN la mini sala permanece abierta hasta que un `administrador` la cierre manualmente

### Requirement: Nombres de mini sala no resolubles como código de sala

El sistema MUST nombrar cada mini sala de LiveKit como `${roomCode}::breakout-N`, donde `roomCode` es el código de la sala padre. El sistema MUST NOT permitir que un nombre que contiene el separador `::` sea resuelto como un código de sala válido por el resolvedor de salas de la aplicación. Una mini sala MUST NOT generar ninguna fila en la tabla `rooms`.

#### Scenario: Intento de resolver un nombre de mini sala como código de sala

- GIVEN el nombre de una mini sala con el formato `${roomCode}::breakout-N`
- WHEN se intenta resolverlo como si fuera un código de sala de la aplicación
- THEN la resolución falla como si la sala no existiera
- AND no se crea ninguna fila en la tabla `rooms` a partir de ese nombre

### Requirement: Cierre en cascada desde la sala principal

Cuando la sala principal de una llamada se cierra, el sistema MUST cerrar también todas las mini salas activas de ese grupo y MUST devolver o desconectar a todos sus ocupantes, de la misma forma que el cierre manual de una mini sala individual.

#### Scenario: Cierre de la sala principal con mini salas activas

- GIVEN una llamada con dos mini salas activas y ocupantes en cada una
- WHEN la sala principal se cierra
- THEN ambas mini salas quedan cerradas
- AND todos sus ocupantes quedan desconectados o devueltos, igual que los de la sala principal
