# Especificación: call-host-gate (delta)

## Propósito del delta

El spec vigente de `call-host-gate` (incluido el delta ya aplicado por `breakout-rooms` sobre evaluación a nivel de grupo de llamada) no cambia. Este delta agrega un requisito fijado por caracterización, no por verificación de comportamiento actual confirmado: una `administradora` que es la única persona conectada en todo el grupo y se traslada de la sala principal hacia una mini sala del mismo grupo no debe sufrir el cierre forzado del grupo, siempre que su reconexión a la mini sala ocurra dentro de la ventana de gracia ya existente del gate de anfitrión. El comportamiento actual frente a este caso específico no está confirmado; `sdd-design` y `sdd-apply` MUST verificarlo explícitamente con un test de caracterización antes de asumir que ya está cubierto, y MUST mitigarlo de forma explícita si no lo está. Los requisitos no listados abajo no cambian.

## ADDED Requirements

### Requirement: Administradora única del grupo que se traslada a una mini sala no dispara cierre forzado dentro de la ventana de gracia

El sistema MUST NOT forzar el cierre de un grupo de llamada cuando su único `administrador` conectado se traslada de la sala principal hacia una mini sala del mismo grupo, siempre que ese `administrador` se reconecte a la mini sala dentro de la ventana de gracia ya existente del gate de anfitrión, incluso si durante el tramo entre su remoción de la sala principal y su reconexión a la mini sala no queda ningún participante conectado en ninguna sala del grupo.

#### Scenario: Administradora sola se traslada a una mini sala y reconecta dentro de la ventana de gracia

- GIVEN un grupo de llamada con una única `administradora` conectada a la sala principal y ningún otro participante conectado en ninguna sala del grupo
- WHEN esa `administradora` inicia un traslado hacia una mini sala del grupo, quedando removida de la sala principal con la reconexión a la mini sala todavía pendiente, y durante ese tramo el grupo queda con cero participantes conectados en cualquiera de sus salas
- THEN el gate de anfitrión no dispara el cierre forzado del grupo mientras la reconexión ocurra dentro de la ventana de gracia existente
- AND al completarse la reconexión a la mini sala, el grupo permanece activo con la `administradora` conectada en la mini sala y ningún participante fue desconectado por cierre forzado
