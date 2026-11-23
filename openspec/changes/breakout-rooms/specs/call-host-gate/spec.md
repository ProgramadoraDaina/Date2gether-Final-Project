# Especificación: call-host-gate (delta)

## Propósito del delta

El spec vigente de `call-host-gate` evalúa la presencia de administrador conectado y el cierre forzado por sala de LiveKit individual. Este delta redefine esa evaluación a nivel de **grupo de llamada** (la sala principal más sus mini salas activas, ver `call-breakout-rooms`), para que un `administrador` presente en cualquier sala del grupo sostenga el acceso y evite el cierre forzado de todo el grupo. Para una llamada sin mini salas activas, el grupo se reduce exactamente a la sala principal, por lo que el comportamiento MUST ser idéntico al spec vigente. Los requisitos no listados abajo (idempotencia ante cierre concurrente, invitados nunca administradores, alcance exclusivo a la videollamada) no cambian y siguen vigentes tal como están especificados.

## MODIFIED Requirements

### Requirement: Bloqueo de acceso sin administrador conectado

El sistema MUST rechazar la emisión del token de acceso a la videollamada a un solicitante que no es `administrador` de esa sala, cuando ningún `administrador` de la sala principal ni de ninguna mini sala activa del mismo grupo de llamada está conectado en ese momento.

#### Scenario: Participante no-admin sin ningún admin conectado en el grupo

- GIVEN un grupo de llamada (sala principal y sus mini salas activas) sin ningún `administrador` conectado en ninguna de sus salas
- WHEN un participante no-admin solicita unirse a cualquier sala del grupo
- THEN la solicitud se rechaza con un mensaje explícito
- AND no se emite ningún token de acceso a LiveKit

#### Scenario: Admin conectado en una mini sala satisface el gate de la sala principal

- GIVEN un `administrador` conectado únicamente a una mini sala activa del grupo, sin ningún admin conectado a la sala principal
- WHEN un participante no-admin solicita unirse a la sala principal
- THEN se emite su token de acceso a LiveKit

#### Scenario: Participante no-admin con al menos un admin conectado en el grupo

- GIVEN al menos un `administrador` conectado a alguna sala del grupo de llamada (principal o mini sala)
- WHEN un participante no-admin solicita unirse a cualquier sala de ese mismo grupo
- THEN se emite su token de acceso a LiveKit

### Requirement: Cierre forzado al perder el último admin conectado

El sistema MUST forzar el cierre de la sesión de LiveKit de todo el grupo de llamada únicamente cuando ningún `administrador` permanece conectado en ninguna sala del grupo (ni en la sala principal ni en ninguna mini sala activa). Mientras quede al menos un `administrador` conectado en cualquier sala del grupo, el sistema MUST NOT forzar el cierre de ninguna sala del grupo.

#### Scenario: Único admin del grupo se desconecta de una mini sala

- GIVEN un único `administrador` conectado a una mini sala del grupo, y ningún otro administrador conectado en ninguna otra sala del grupo
- WHEN ese administrador se desconecta
- THEN todas las salas del grupo (principal y mini salas activas) fuerzan el cierre de su sesión de LiveKit
- AND todos los participantes restantes del grupo quedan desconectados

#### Scenario: Admin presente en otra sala del grupo evita el cierre forzado

- GIVEN un `administrador` conectado a la sala principal y otro `administrador` conectado a una mini sala del mismo grupo
- WHEN el administrador de la mini sala se desconecta
- THEN ninguna sala del grupo fuerza su cierre
- AND los participantes de la mini sala permanecen conectados a esa mini sala

## ADDED Requirements

### Requirement: Equivalencia exacta sin mini salas activas

Para una llamada sin mini salas activas, el sistema MUST evaluar el gate de acceso y el cierre forzado exactamente igual que el spec vigente de una sola sala: el grupo se reduce a la sala principal únicamente.

#### Scenario: Llamada sin mini salas activas

- GIVEN una llamada sin ninguna mini sala activa
- WHEN se evalúa el gate de acceso o el disparador de cierre forzado para esa llamada
- THEN el comportamiento MUST ser idéntico al spec vigente de `call-host-gate`, como si el modelo de grupo no existiera

### Requirement: Cascada de cierre forzado hacia las mini salas del grupo

Cuando el cierre forzado dispara para un grupo de llamada, el sistema MUST aplicar el cierre tanto a la sala principal como a cada mini sala activa de ese grupo.

#### Scenario: Cierre forzado con mini salas activas

- GIVEN un grupo de llamada con mini salas activas, donde se pierde el último `administrador` conectado en todo el grupo
- WHEN se dispara el cierre forzado
- THEN la sala principal y cada mini sala activa del grupo fuerzan el cierre de su sesión de LiveKit
