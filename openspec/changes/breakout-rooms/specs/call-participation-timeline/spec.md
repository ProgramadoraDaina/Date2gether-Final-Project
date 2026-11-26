# Especificación: call-participation-timeline (delta)

## Propósito del delta

El spec vigente de `call-participation-timeline` materializa un resumen por participante al finalizar una sesión de llamada, una fila de `call_sessions` por cada instancia de sala de LiveKit. Este delta agrega un vínculo de grupo nullable (`callGroupId`) a `call_sessions`, que conecta la sesión de una mini sala con la sesión de su sala principal, sin cambiar el comportamiento del modelo de lectura existente: cada mini sala sigue produciendo su propia fila de sesión y su propio resumen, de forma independiente. Los requisitos no listados abajo (materialización, reconexiones agregadas, invitados incluidos, cierre implícito de tracks, acceso de lectura, punto de entrada desde Historial, resiliencia, independencia de callHistory) no cambian y siguen vigentes tal como están especificados.

## ADDED Requirements

### Requirement: Vínculo de grupo en la sesión de una mini sala

Al materializar la sesión de llamada correspondiente a una mini sala, el sistema MUST registrar un `callGroupId` que referencia la sesión de la sala principal del mismo grupo de llamada. Para sesiones de salas que no son mini salas, `callGroupId` MUST quedar nulo.

#### Scenario: Mini sala finaliza su sesión

- GIVEN una mini sala con sesión de llamada activa, perteneciente a un grupo con una sala principal
- WHEN la sesión de esa mini sala finaliza y se materializa
- THEN su fila de `call_sessions` tiene `callGroupId` apuntando a la sesión de la sala principal del mismo grupo

#### Scenario: Sala principal sin mini salas finaliza su sesión

- GIVEN una llamada sin ninguna mini sala asociada
- WHEN la sesión de la sala principal finaliza y se materializa
- THEN su fila de `call_sessions` tiene `callGroupId` nulo

### Requirement: El modelo de lectura no se fusiona en este recorte

El sistema MUST continuar devolviendo, para cada sesión de mini sala, un resumen de participación independiente, sin fusionarlo con el resumen de la sesión de la sala principal del mismo grupo, en este cambio.

#### Scenario: Lectura de la línea de tiempo de una mini sala

- GIVEN una sesión de mini sala finalizada con `callGroupId` apuntando a su sala principal
- WHEN un participante de esa sesión consulta su línea de tiempo
- THEN recibe el resumen de participación propio de esa sesión de mini sala únicamente
- AND el resumen no incluye los participantes de la sesión de la sala principal
