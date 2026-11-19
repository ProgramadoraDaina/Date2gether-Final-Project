# Especificación: call-host-gate

## Propósito

Define la regla de modelo anfitrión para la videollamada: nadie se une sin al menos un `administrador` de la sala ya conectado (salvo el propio administrador), y la sesión se cierra para todos cuando se desconecta el último administrador conectado. La regla aplica exclusivamente a la videollamada, no a la sala, su chat ni su lista de miembros.

## Requisitos

### Requirement: Bloqueo de acceso sin administrador conectado

El sistema MUST rechazar la emisión del token de acceso a la videollamada a un solicitante que no es `administrador` de esa sala, cuando ningún `administrador` de esa sala está conectado a la videollamada en ese momento.

#### Scenario: Participante no-admin sin ningún admin conectado

- GIVEN una sala sin ningún `administrador` conectado a la videollamada
- WHEN un participante no-admin solicita unirse
- THEN la solicitud se rechaza con un mensaje explícito
- AND no se emite ningún token de acceso a LiveKit

#### Scenario: Participante no-admin con al menos un admin conectado

- GIVEN una sala con al menos un `administrador` conectado a la videollamada
- WHEN un participante no-admin solicita unirse
- THEN se emite su token de acceso a LiveKit

### Requirement: Un administrador siempre puede unirse

El sistema MUST permitir siempre que un `administrador` de la sala se una a la videollamada y emitir su token de acceso, incluso si la videollamada está vacía o sin ningún otro participante conectado.

#### Scenario: Administrador inicia la llamada

- GIVEN una sala sin ningún participante conectado a la videollamada
- WHEN un `administrador` de esa sala solicita unirse
- THEN se emite su token de acceso a LiveKit
- AND la llamada queda iniciada

### Requirement: La llamada se sostiene con al menos un admin conectado

Mientras al menos un `administrador` de la sala permanezca conectado a la videollamada, el sistema MUST mantener la sesión abierta y seguir permitiendo que participantes no-admin se unan, sin importar cuántos administradores en total tenga la sala.

#### Scenario: Un admin de varios se desconecta

- GIVEN dos administradores conectados a la misma videollamada
- WHEN uno de ellos se desconecta
- THEN el otro administrador permanece conectado
- AND la llamada sigue activa para el resto de los participantes
- AND nuevos participantes no-admin pueden seguir uniéndose

### Requirement: Cierre forzado al perder el último admin conectado

Cuando el último `administrador` conectado a una videollamada se desconecta, el sistema MUST forzar el cierre de la sesión de LiveKit para todos los participantes restantes de esa videollamada.

#### Scenario: Único admin se desconecta con otros participantes presentes

- GIVEN un único `administrador` conectado a la videollamada junto con otros participantes no-admin
- WHEN ese administrador se desconecta
- THEN todos los participantes restantes quedan desconectados de la videollamada
- AND la sesión de LiveKit para esa videollamada termina

### Requirement: Idempotencia ante cierre concurrente

Ante la desconexión casi simultánea de dos administradores de la misma sala (condición de carrera), el sistema MUST ejecutar el cierre forzado como una operación idempotente: intentar cerrar una sesión que ya está cerrada MUST NOT producir un error visible ni efectos duplicados.

#### Scenario: Dos admins se desconectan casi al mismo tiempo

- GIVEN dos administradores conectados y ningún otro administrador en la sala
- WHEN ambos se desconectan casi simultáneamente y ambas desconexiones evalúan si deben forzar el cierre
- THEN la sesión de LiveKit se cierra efectivamente una sola vez
- AND ninguna de las dos evaluaciones produce un error visible ni un efecto duplicado

### Requirement: Los invitados nunca cuentan como administrador

El sistema MUST tratar a los participantes invitados (sin `userId`) como nunca administradores. La presencia de uno o más invitados conectados MUST NOT satisfacer el requisito de "al menos un administrador conectado".

#### Scenario: Solo invitados conectados, sin ningún admin

- GIVEN una sala con varios invitados conectados a la videollamada y ningún `administrador` conectado
- WHEN otro participante no-admin solicita unirse
- THEN la solicitud se rechaza igual que si no hubiera nadie conectado

### Requirement: Alcance exclusivo a la videollamada

El gate de acceso y el cierre forzado MUST NOT afectar la sala, su chat ni su lista de miembros (`roomMembers`), que permanecen accesibles independientemente del estado de la videollamada.

#### Scenario: Chat disponible tras el cierre forzado

- GIVEN una videollamada que acaba de cerrarse por salida del último admin
- WHEN los participantes que fueron desconectados de la videollamada acceden al chat de la sala
- THEN el chat y la lista de miembros de la sala siguen disponibles sin cambios
