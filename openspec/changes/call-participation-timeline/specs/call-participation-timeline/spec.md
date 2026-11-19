# Especificación: call-participation-timeline

## Propósito

Define la materialización, al finalizar una sesión de llamada, de un resumen por participante (incluidos invitados) con sus horarios de unión/salida, duración, si habló y si compartió pantalla; y su lectura desde una vista accesible a cualquier participante de esa sesión.

## Requisitos

### Requirement: Materialización al finalizar la sesión

Al recibir el evento de fin de sesión de una videollamada, el sistema MUST materializar un resumen por participante que incluya: primer momento de unión, último momento de salida, duración total conectado, si tuvo el micrófono abierto en algún momento ("habló") y si compartió pantalla en algún momento.

#### Scenario: Sesión finaliza con varios participantes

- GIVEN una sesión de llamada con tres participantes que ya se desconectaron, incluido un invitado
- WHEN la sesión finaliza
- THEN se materializa un resumen con una entrada por cada uno de los tres participantes
- AND cada entrada contiene su unión, salida, duración total, si habló y si compartió pantalla

### Requirement: Reconexiones agregadas en una sola participación

Cuando un mismo participante (misma cuenta o mismo invitado) se unió y salió más de una vez dentro de la misma sesión, el sistema MUST representarlo en el resumen como una única participación agregada, con duración total igual a la suma de sus intervalos conectados.

#### Scenario: Reconexión del mismo participante

- GIVEN un mismo participante con dos pares de unión/salida dentro de la misma sesión, por una reconexión de red
- WHEN la sesión finaliza y se materializa el resumen
- THEN el resumen muestra una única entrada para ese participante
- AND su duración total es la suma de los dos intervalos conectados

### Requirement: Invitados incluidos

El resumen materializado MUST incluir a los participantes invitados (sin cuenta) en igualdad de condiciones que a los participantes con cuenta.

#### Scenario: Invitado participó de la sesión

- GIVEN un invitado que participó de la sesión
- WHEN se materializa el resumen
- THEN aparece una entrada con su nombre y sus datos de participación, sin vínculo a ninguna cuenta

### Requirement: Cierre implícito de tracks sin evento de cierre explícito

Cuando un participante publicó un track (micrófono o pantalla) pero nunca llegó el evento correspondiente de cierre antes de salir o antes del fin de la sesión, el sistema MUST igualmente considerar que "habló" o "compartió pantalla" según corresponda, usando su salida o el fin de la sesión como límite de cierre implícito del track para el cálculo de duración.

#### Scenario: Navegador colgado sin evento de cierre de micrófono

- GIVEN un participante que publicó su micrófono y luego nunca se recibió el evento de cierre de ese track
- WHEN su salida de la sesión se registra (o la sesión finaliza)
- THEN el resumen marca que ese participante habló
- AND el cálculo de duración usa su salida o el fin de la sesión como límite de cierre del track

### Requirement: Acceso de lectura restringido a participantes de la sesión

Cualquier participante que haya estado en una sesión MUST poder ver el resumen de todos los participantes de esa misma sesión, incluidos los invitados. Un usuario que no participó de esa sesión MUST NOT poder acceder a su resumen.

#### Scenario: Participante consulta su sesión

- GIVEN un usuario que participó de una sesión de llamada ya finalizada
- WHEN solicita ver la línea de tiempo de esa sesión
- THEN puede ver los datos de resumen de todos los participantes de esa sesión

#### Scenario: Usuario ajeno intenta acceder

- GIVEN un usuario que no participó de una sesión de llamada
- WHEN intenta acceder a la línea de tiempo de esa sesión
- THEN el acceso se deniega

### Requirement: Punto de entrada desde Historial

El sistema MUST ofrecer, desde la vista existente de Historial, un enlace hacia la línea de tiempo de cada sesión pasada.

#### Scenario: Navegación desde Historial

- GIVEN un usuario en la vista de Historial con sesiones pasadas listadas
- WHEN hace click en el enlace de una sesión pasada
- THEN llega a la línea de tiempo de esa sesión

### Requirement: Resiliencia ante ausencia del evento de fin de sesión

Si el evento de fin de sesión de una sesión de llamada nunca llega, el sistema SHOULD seguir permitiendo materializar o re-materializar su resumen a partir del registro crudo de eventos conservado, sin pérdida de datos.

#### Scenario: Fin de sesión no recibido

- GIVEN una sesión cuyo evento de fin de sesión nunca fue recibido
- WHEN se necesita construir su resumen de todos modos
- THEN el registro crudo de eventos de esa sesión sigue disponible para materializar el resumen posteriormente

### Requirement: Independencia de callHistory

El sistema MUST NOT alterar los datos ni el comportamiento existentes de `callHistory`.

#### Scenario: callHistory sin cambios

- GIVEN una fila existente de `callHistory` previa a este cambio
- WHEN se despliega esta funcionalidad
- THEN esa fila sigue mostrando los mismos valores que antes
