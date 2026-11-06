# Especificación: call-participant-identity

## Propósito

Define la correlación entre el `identity` aleatorio que LiveKit asigna en cada unión a una sala y la identidad real del solicitante (cuenta registrada o invitado), persistida en el momento en que se emite el token de acceso.

## Requisitos

### Requirement: Persistencia de la correlación al emitir el token

El sistema MUST persistir, en el momento en que se emite el token de acceso a una sala, la correlación entre el `identity` de LiveKit generado para esa unión y la identidad real del solicitante: `userId` si es una cuenta registrada, o el nombre provisto si es un invitado, junto con el `roomId` de la sala.

#### Scenario: Usuario registrado se une

- GIVEN un usuario con cuenta que solicita unirse a una sala
- WHEN se emite su token de acceso a LiveKit
- THEN se persiste una correlación entre su `identity` de LiveKit y su `userId`, para ese `roomId`

#### Scenario: Invitado se une

- GIVEN un invitado sin cuenta que solicita unirse a una sala con un nombre
- WHEN se emite su token de acceso a LiveKit
- THEN se persiste una correlación entre su `identity` de LiveKit y su nombre, sin `userId`, para ese `roomId`

### Requirement: Identity inestable entre reconexiones

Dado que cada unión a una sala genera un `identity` de LiveKit nuevo, el sistema MUST permitir que existan múltiples correlaciones distintas para la misma persona (misma cuenta o mismo invitado) dentro de una misma sesión de llamada.

#### Scenario: Misma cuenta se reconecta en la misma sesión

- GIVEN un usuario con cuenta que se une, se desconecta y vuelve a unirse dentro de la misma sesión de llamada
- WHEN se emite un token en cada unión
- THEN se persisten dos correlaciones distintas, cada una con un `identity` diferente
- AND ambas correlaciones apuntan al mismo `userId`

#### Scenario: Mismo invitado se reconecta en la misma sesión

- GIVEN un invitado que se une y se reconecta dentro de la misma sesión de llamada usando el mismo nombre
- WHEN se emite un token en cada unión
- THEN se persisten dos correlaciones distintas con `identity` diferentes
- AND ambas correlaciones apuntan al mismo nombre de invitado

### Requirement: Invitados sin afectar callHistory

El sistema MUST persistir la correlación de invitados sin requerir que exista `userId`, y esta persistencia MUST NOT alterar las condiciones actuales bajo las cuales se registra una fila en `callHistory`.

#### Scenario: Invitado sin cuenta

- GIVEN un invitado sin `userId` que se une a una sala
- WHEN se emite su token de acceso
- THEN la correlación se persiste igual
- AND no se genera ninguna fila de `callHistory` para esa unión, igual que antes de este cambio

### Requirement: Correlación resoluble para otros consumidores

El sistema MUST exponer la correlación persistida de forma que, dado un `identity` de LiveKit conectado a una sala en un momento dado, pueda resolverse a su `userId` o a su nombre de invitado y a su `roomId`.

#### Scenario: Resolución de un identity conectado

- GIVEN un `identity` de LiveKit que está actualmente conectado a una sala
- WHEN un proceso necesita saber a qué usuario o invitado corresponde
- THEN puede resolverlo a partir de la correlación persistida en el momento de su unión
