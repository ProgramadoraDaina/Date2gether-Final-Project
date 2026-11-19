# Especificación: call-webhook-ingestion

## Propósito

Define la recepción confiable de webhooks de LiveKit: verificación de firma, idempotencia por evento y el conjunto de eventos soportados que alimentan la correlación de identidad, el gate de anfitrión y la línea de tiempo.

## Requisitos

### Requirement: Verificación de firma

El sistema MUST verificar la firma HMAC de cada solicitud de webhook entrante contra las credenciales de LiveKit antes de procesar su contenido.

#### Scenario: Firma válida

- GIVEN una solicitud de webhook con firma válida
- WHEN el sistema la recibe
- THEN el contenido se procesa normalmente

#### Scenario: Firma inválida o ausente

- GIVEN una solicitud de webhook con firma inválida, ausente o alterada
- WHEN el sistema la recibe
- THEN la solicitud se rechaza
- AND el contenido no se persiste ni genera ningún efecto

### Requirement: Idempotencia por identificador de evento

El sistema MUST deduplicar los eventos entrantes usando el identificador único de evento provisto por LiveKit. Una entrega repetida del mismo evento no debe producir efectos adicionales ni filas duplicadas.

#### Scenario: Entrega duplicada

- GIVEN un evento con un identificador ya procesado previamente
- WHEN el sistema recibe una segunda entrega del mismo evento
- THEN la segunda entrega no genera ningún efecto adicional
- AND no se crea ninguna fila ni registro duplicado

#### Scenario: Entrega fuera de orden

- GIVEN eventos de una misma sesión que llegan en un orden distinto al orden real en que ocurrieron (por ejemplo, un `participant_left` llega antes que su `participant_joined` correspondiente por reordenamiento de red)
- WHEN el sistema los procesa
- THEN el resultado final se basa en los datos temporales propios de cada evento, no en el orden de llegada
- AND ningún evento válido se descarta por llegar fuera de orden

### Requirement: Eventos soportados

El sistema MUST procesar los eventos `room_started`, `room_finished`, `participant_joined`, `participant_left`, `track_published` y `track_unpublished`. Eventos de un tipo no reconocido MUST ser aceptados sin error pero sin generar ningún efecto.

#### Scenario: Evento soportado

- GIVEN un evento de tipo `participant_joined` con firma válida
- WHEN el sistema lo recibe
- THEN se persiste y queda disponible para los consumidores de ese evento

#### Scenario: Evento de tipo no reconocido

- GIVEN un evento con firma válida de un tipo no listado arriba
- WHEN el sistema lo recibe
- THEN la solicitud se acepta sin error
- AND no se genera ningún efecto de negocio

### Requirement: Alcance por sesión de llamada

El sistema MUST tratar cada par `room_started`/`room_finished` identificado por el identificador de instancia de sala de LiveKit como una sesión de llamada independiente, distinta de cualquier otra instancia que comparta el mismo código de sala.

#### Scenario: Dos sesiones distintas del mismo código de sala

- GIVEN dos instancias de sala distintas creadas en momentos diferentes para el mismo código de sala
- WHEN llegan eventos de ambas
- THEN los eventos de una instancia no se mezclan con los de la otra

### Requirement: Retención del registro crudo

El sistema MUST conservar cada evento aceptado y no duplicado en un registro de solo-adición, de forma indefinida, como fuente de verdad para auditoría y para una eventual re-materialización.

#### Scenario: Consulta de auditoría

- GIVEN eventos procesados hace tiempo de una sesión ya finalizada
- WHEN se necesita auditar qué ocurrió en esa sesión
- THEN el registro crudo de esos eventos sigue disponible sin haber sido purgado
