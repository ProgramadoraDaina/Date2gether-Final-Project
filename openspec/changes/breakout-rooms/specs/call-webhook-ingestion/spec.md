# Especificación: call-webhook-ingestion (delta)

## Propósito del delta

El spec vigente de `call-webhook-ingestion` cubre la verificación de firma, la idempotencia por evento y el conjunto de eventos soportados en el endpoint `POST /calls/livekit/webhook`. Ninguno de esos tres aspectos cambia con este cambio: el mismo endpoint, los mismos eventos (`room_started`, `room_finished`, `participant_joined`, `participant_left`, `track_published`, `track_unpublished`) y la misma verificación de firma HMAC siguen aplicando sin modificación, incluyendo para los eventos que LiveKit emite para mini salas, que llegan al mismo endpoint único por servidor. El único comportamiento nuevo es de atribución: un `roomCode` que contiene el separador `::` MUST atribuirse a su sala de grupo padre en lugar de tratarse como una sala no reconocida. Los requisitos no listados abajo no cambian.

## ADDED Requirements

### Requirement: Atribución de eventos de mini sala a la sala de grupo padre

Cuando el `roomCode` de un evento de webhook entrante contiene el separador `::`, el sistema MUST atribuir ese evento a la sala de grupo padre identificada por la parte del nombre anterior al separador, en lugar de tratarlo como proveniente de una sala no reconocida.

#### Scenario: Evento de una mini sala

- GIVEN un evento de webhook válido cuyo `roomCode` tiene el formato `${roomCode}::breakout-N`
- WHEN el sistema lo recibe y verifica su firma
- THEN el evento se atribuye a la sala de grupo padre identificada por `roomCode`
- AND queda disponible para los mismos consumidores (correlación de identidad, gate de anfitrión, línea de tiempo) que un evento de la sala principal

#### Scenario: roomCode con separador que no corresponde a ningún grupo activo

- GIVEN un evento de webhook válido cuyo `roomCode` contiene `::` pero cuya parte anterior al separador no corresponde a ninguna sala de grupo activa conocida por el sistema
- WHEN el sistema lo recibe
- THEN el evento se acepta sin error, igual que cualquier evento de una sala no reconocida bajo el spec vigente
- AND no se genera ningún efecto de negocio

### Requirement: Verificación y conjunto de eventos sin cambios para mini salas

El sistema MUST aplicar la misma verificación de firma HMAC y el mismo conjunto de eventos soportados a los eventos atribuidos a mini salas que a los eventos de la sala principal, sin ningún endpoint, tipo de evento o configuración adicional.

#### Scenario: Ráfaga de eventos de un grupo con mini salas activas

- GIVEN un grupo de llamada con su sala principal y mini salas activas, todas emitiendo eventos hacia el mismo endpoint de webhook
- WHEN llega una ráfaga de eventos de varias salas del grupo
- THEN cada evento se verifica y procesa con las mismas reglas que un evento de una sola sala, sin camino de código adicional
