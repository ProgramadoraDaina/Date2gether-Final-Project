# Especificación: call-breakout-rooms (delta)

## Propósito del delta

El spec vigente de `call-breakout-rooms` cubre el ciclo de vida completo de las mini salas (tope configurable, `leavePolicy`, traslado y retorno, expulsión por reconexión ilegítima, cierre manual/automático/en cascada, nombres no resolubles). Ninguno de esos aspectos cambia. Este delta agrega una política de ingreso (`joinPolicy`) separada de `leavePolicy`, amplía quién puede invocar el traslado hacia una mini sala para habilitar el auto-traslado, introduce proyección por rol en el listado de mini salas, y agrega una señal explícita de motivo cuando el sistema remueve por la fuerza una conexión viva como parte de un traslado o de una vuelta forzada. Los requisitos no listados abajo no cambian.

## ADDED Requirements

### Requirement: Política de ingreso por mini sala (joinPolicy)

Cada mini sala MUST tener una política de ingreso explícita, independiente de su política de salida (`leavePolicy`): `admin_only` (valor por defecto) o `open`. El sistema MUST permitir que un `administrador` cambie esa política mientras la mini sala permanece abierta, con el mismo patrón que ya usa `updatePolicy` para `leavePolicy`. Cambiar `joinPolicy` MUST NOT alterar el valor ni el comportamiento de `leavePolicy` de esa mini sala, y cambiar `leavePolicy` MUST NOT alterar el valor ni el comportamiento de `joinPolicy`. Son dos controles separados, con nombres y textos distintos en todo el código y la UI.

#### Scenario: Crear mini sala sin especificar joinPolicy

- GIVEN un `administrador` que crea una mini sala sin indicar política de ingreso
- WHEN la mini sala se crea
- THEN su `joinPolicy` queda en `admin_only`

#### Scenario: Crear mini sala con joinPolicy explícito

- GIVEN un `administrador` que crea una mini sala indicando `joinPolicy='open'`
- WHEN la mini sala se crea
- THEN su `joinPolicy` queda en `open`

#### Scenario: Cambiar joinPolicy mientras la mini sala está abierta

- GIVEN una mini sala abierta con `joinPolicy='admin_only'`
- WHEN un `administrador` la cambia a `'open'`
- THEN las solicitudes de auto-traslado hacia esa mini sala pasan a aceptarse desde ese momento, bajo las reglas de autorización de traslado vigentes

#### Scenario: Cambiar joinPolicy no altera leavePolicy

- GIVEN una mini sala con `leavePolicy='free_return'` y `joinPolicy='admin_only'`
- WHEN un `administrador` cambia `joinPolicy` a `'open'`
- THEN `leavePolicy` sigue siendo `'free_return'`
- AND las solicitudes de retorno por cuenta propia de sus ocupantes siguen aceptándose exactamente igual que antes del cambio

#### Scenario: Cambiar leavePolicy no altera joinPolicy

- GIVEN una mini sala con `joinPolicy='open'` y `leavePolicy='locked'`
- WHEN un `administrador` cambia `leavePolicy` a `'free_return'`
- THEN `joinPolicy` sigue siendo `'open'`
- AND las solicitudes de auto-traslado hacia esa mini sala siguen aceptándose exactamente igual que antes del cambio

### Requirement: Proyección de roster por rol al listar mini salas

El sistema MUST devolver, a un `administrador` que solicita el listado de mini salas de su llamada, el roster completo de ocupantes de la sala principal y de cada mini sala. El sistema MUST devolver, a un participante no-administrador que solicita el mismo listado, únicamente la ocupación agregada de cada sala (etiqueta de la sala y cantidad de ocupantes), sin identidad de ningún ocupante, incluyendo la sala principal.

#### Scenario: Administrador lista las mini salas

- GIVEN una llamada con mini salas activas y ocupantes en la sala principal y en ellas
- WHEN un `administrador` solicita el listado
- THEN recibe el roster completo de ocupantes de la sala principal y de cada mini sala

#### Scenario: No-administrador lista las mini salas

- GIVEN la misma llamada con mini salas activas y ocupantes en la sala principal y en ellas
- WHEN un participante no-administrador solicita el listado
- THEN recibe, para cada sala incluida la principal, solo la etiqueta de la sala y la cantidad de ocupantes
- AND no recibe la identidad de ningún ocupante de ninguna sala

### Requirement: Señal explícita de motivo en remoción forzada por traslado o vuelta forzada

Cuando el sistema remueve por la fuerza la conexión viva de un participante como parte de un traslado (`moveIn`) o de una vuelta forzada por el `administrador` (`selfReturn` forzado sobre un tercero), el sistema MUST emitir, junto con esa remoción, una señal explícita que identifique el motivo como "traslado o vuelta en curso", distinguible por el cliente de una desconexión por fallo real. Esta señal MUST ser distinta de la señal de expulsión por política `locked` emitida desde el webhook (ver `call-webhook-ingestion`); ambas señales nunca deben confundirse entre sí ni con una desconexión real sin motivo conocido.

#### Scenario: Remoción forzada por traslado lleva señal de motivo

- GIVEN un traslado válido de un participante hacia una mini sala, que requiere remover su conexión viva de la sala de origen
- WHEN el sistema ejecuta esa remoción forzada
- THEN la remoción lleva la señal explícita de "traslado en curso"
- AND esa señal es distinguible del cierre por fallo real

#### Scenario: Remoción forzada por vuelta forzada lleva señal de motivo

- GIVEN un `administrador` que fuerza la vuelta de un ocupante de una mini sala a la sala principal, lo que requiere remover su conexión viva de la mini sala
- WHEN el sistema ejecuta esa remoción forzada
- THEN la remoción lleva la señal explícita de "vuelta en curso"
- AND esa señal es distinguible del cierre por fallo real

## MODIFIED Requirements

### Requirement: Traslado de un participante hacia una mini sala

El sistema MUST permitir el traslado de un participante conectado hacia una mini sala activa del mismo grupo únicamente cuando se cumple alguna de estas dos condiciones: (a) quien solicita el traslado es `administrador` de la sala, sin importar el `joinPolicy` vigente de la mini sala destino y sin importar si el destino es ella misma o un tercero; o (b) el `joinPolicy` de la mini sala destino es `'open'` y el participante trasladado es la misma persona que solicita el traslado. El sistema MUST rechazar cualquier otra combinación, incluyendo a un no-administrador que intenta trasladar a un tercero bajo cualquier `joinPolicy`. El sistema MUST validar, antes de emitir el token nuevo y sin importar cuál de las dos condiciones de autorización aplicó, que la mini sala destino tiene capacidad disponible.

#### Scenario: Administrador traslada a un tercero

- GIVEN una mini sala activa con capacidad disponible, con cualquier `joinPolicy`
- WHEN un `administrador` traslada a otro participante conectado hacia esa mini sala
- THEN se emite un token de acceso nuevo acotado a la mini sala destino para ese participante

#### Scenario: Administrador se traslada a sí misma

- GIVEN una mini sala activa con capacidad disponible y `joinPolicy='admin_only'`
- WHEN la propia `administradora` se traslada a esa mini sala
- THEN se emite un token de acceso nuevo acotado a la mini sala destino para ella misma
- AND el traslado se autoriza aunque el destino sea ella misma

#### Scenario: No-administrador intenta trasladar a un tercero

- GIVEN cualquier mini sala activa, con cualquier `joinPolicy`
- WHEN un participante no-administrador intenta trasladar a otro participante hacia esa mini sala
- THEN la solicitud se rechaza
- AND no se emite ningún token nuevo

#### Scenario: No-administrador se auto-traslada bajo admin_only

- GIVEN una mini sala activa con `joinPolicy='admin_only'`
- WHEN un participante no-administrador intenta trasladarse a sí mismo hacia esa mini sala
- THEN la solicitud se rechaza
- AND no se emite ningún token nuevo

#### Scenario: No-administrador se auto-traslada bajo open

- GIVEN una mini sala activa con `joinPolicy='open'` y capacidad disponible
- WHEN un participante no-administrador se traslada a sí mismo hacia esa mini sala
- THEN se emite un token de acceso nuevo acotado a la mini sala destino para él mismo

#### Scenario: Traslado rechazado por falta de capacidad

- GIVEN una mini sala activa que ya está en su capacidad máxima, con cualquier `joinPolicy`
- WHEN se intenta trasladar a un participante hacia esa mini sala bajo cualquiera de las dos condiciones de autorización
- THEN la solicitud se rechaza con un mensaje explícito
- AND no se emite ningún token nuevo para ese participante
