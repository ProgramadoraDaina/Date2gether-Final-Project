# Especificación: call-participant-identity (delta)

## Propósito del delta

El spec vigente de `call-participant-identity` cubre la correlación entre `identity` de LiveKit y la identidad real del solicitante al emitir un token para una sala. Este delta extiende esa correlación a los tokens emitidos para mini salas: cada reemisión de token al trasladar un participante hacia o desde una mini sala MUST persistir como una correlación nueva, usando el `roomId` de la sala principal padre (no un `roomId` propio de la mini sala) y el `roleAtIssue` que corresponde al participante en esa sala principal. Los requisitos no listados abajo no cambian.

## ADDED Requirements

### Requirement: Correlación de tokens de mini sala vinculada al roomId padre

Al emitir un token de acceso para una mini sala (traslado hacia adentro o retorno hacia la sala principal), el sistema MUST persistir una correlación nueva entre el `identity` de LiveKit generado para esa unión y la identidad real del participante (`userId` si tiene cuenta, o su nombre si es invitado), usando el mismo `roomId` de la sala principal a la que pertenece la mini sala, junto con el `roleAtIssue` correspondiente a ese participante en esa sala principal.

#### Scenario: Traslado de un participante hacia una mini sala

- GIVEN un participante con una identidad ya correlacionada en la sala principal
- WHEN un `administrador` lo traslada hacia una mini sala y se le emite un token nuevo
- THEN se persiste una correlación nueva para el `identity` de LiveKit generado en esa unión
- AND esa correlación usa el mismo `roomId` de la sala principal
- AND su `roleAtIssue` corresponde al rol que ese participante tiene en la sala principal

#### Scenario: Retorno de un participante desde una mini sala a la sala principal

- GIVEN un participante conectado a una mini sala con una correlación de identidad propia de esa unión
- WHEN se le emite un token nuevo para volver a la sala principal
- THEN se persiste otra correlación nueva para el `identity` generado en esa reconexión
- AND esa correlación usa el mismo `roomId` de la sala principal

### Requirement: Múltiples correlaciones por traslado dentro de la misma sesión

Dado que cada traslado hacia o desde una mini sala genera una unión nueva con `identity` propio, el sistema MUST permitir que coexistan, para la misma persona y el mismo `roomId`, tantas correlaciones distintas como traslados haya tenido dentro de la misma sesión de llamada, de la misma forma en que ya conviven las correlaciones por reconexión del spec vigente.

#### Scenario: Participante trasladado y devuelto más de una vez

- GIVEN un participante que fue trasladado a una mini sala y devuelto a la sala principal dos veces dentro de la misma sesión de llamada
- WHEN se emite un token en cada traslado
- THEN se persisten correlaciones distintas para cada unión
- AND todas apuntan al mismo `userId` o nombre de invitado y al mismo `roomId` padre
