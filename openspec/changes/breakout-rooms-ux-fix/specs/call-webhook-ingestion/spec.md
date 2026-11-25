# Especificación: call-webhook-ingestion (delta)

## Propósito del delta

El spec vigente de `call-webhook-ingestion` (incluido el delta ya aplicado por `breakout-rooms` sobre atribución de eventos de mini sala a la sala de grupo padre) no cambia en su verificación de firma, idempotencia ni conjunto de eventos soportados. Este delta agrega únicamente una señal explícita de motivo para la expulsión de un ocupante `locked` que reconecta ilegítimamente a la sala principal, y el requisito de que esa señal sobreviva al arreglo general de la carrera de `PARTICIPANT_REMOVED` sin quedar tapada por él. Los requisitos no listados abajo no cambian.

## ADDED Requirements

### Requirement: Señal explícita en la expulsión de un ocupante locked reconectado

Cuando el sistema expulsa de la sala principal a un ocupante de una mini sala `locked` que reconectó usando un token previo todavía vigente (ver `call-breakout-rooms`, expulsión del ocupante `locked`), el sistema MUST emitir una señal de motivo específica y distinta de la señal genérica de "traslado o vuelta en curso" usada en remociones forzadas por `moveIn` o por vuelta forzada (ver `call-breakout-rooms`). Esta señal MUST sobrevivir a cualquier tratamiento que convierta la señal genérica en "desconexión esperada, no es error": el cliente MUST seguir pudiendo renderizar un mensaje propio y específico para esta expulsión, aun cuando la señal genérica de traslado/vuelta se trate como no-error.

#### Scenario: Ocupante locked reconectado es expulsado con señal propia

- GIVEN un ocupante trasladado a una mini sala `locked`, cuyo token previo de la sala principal todavía no venció
- WHEN ese ocupante se reconecta a la sala principal y el sistema lo expulsa
- THEN la expulsión lleva una señal de motivo específica de política `locked`, distinta de la señal genérica de traslado/vuelta en curso

#### Scenario: La señal genérica de "no es error" no tapa la expulsión locked

- GIVEN que el cliente trata la señal genérica de "traslado o vuelta en curso" como una desconexión esperada sin mostrar error
- WHEN llega una expulsión por política `locked` con su señal propia
- THEN el cliente renderiza el mensaje específico de expulsión por política
- AND esa expulsión nunca se interpreta ni se descarta como si fuera un traslado o vuelta en curso

#### Scenario: Ambas señales en la misma ráfaga se distinguen correctamente

- GIVEN que en una ventana breve ocurren, para participantes distintos, una remoción forzada por traslado y una expulsión por política `locked`
- WHEN el cliente de cada participante recibe su propia señal
- THEN cada cliente distingue correctamente cuál de las dos señales recibió
- AND ningún cliente confunde una señal con la otra
