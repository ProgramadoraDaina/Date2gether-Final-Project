> Estado actual: las decisiones de Chime de las secciones 2, 5, 9 y 11 son históricas y quedan reemplazadas por LiveKit en la sección 12.

# Decisiones técnicas

Registro de decisiones de arquitectura y herramientas, con el contexto y las alternativas consideradas en cada caso. El objetivo es que cualquiera que retome el proyecto entienda por qué se eligió cada tecnología, no solo cuál se eligió.

## 1. Resolución del conflicto entre el toggle de idioma y el toggle de tema

**Fecha:** 2026-10-25
**Rama:** `feature/multi-language_EN-ES`

### Contexto

`feature/multi-language_EN-ES` se creó antes de que el dark mode (`feature/dark-mode`) se mergeara a `develop`. Al traer `develop` a la rama, `client/src/app/layout.tsx` y `client/src/app/globals.css` quedaron en conflicto: ambas features agregan un botón fijo en la esquina superior derecha (`LanguageToggle` y `ThemeToggle`), y el dark mode además migró los colores hardcodeados a variables CSS (`--color-*`).

### Alternativas consideradas

- **Rebase de la rama sobre `develop`.** Historia más lineal, pero reescribe el único commit de la rama y requiere force-push.
- **Merge de `develop` hacia la rama, resolviendo el conflicto a mano.** Deja registro explícito del conflicto y de cómo se resolvió, sin reescribir commits existentes.

### Decisión

Se optó por el **merge** (no rebase), resolviendo el conflicto manualmente.

### Resolución aplicada

- `layout.tsx`: ambos toggles (`LanguageToggle` y `ThemeToggle`) ahora conviven dentro del mismo contenedor `.top-bar` que trajo el dark mode. Se mantiene `<html lang="es">` como en `develop` (el store de idioma corrige `document.documentElement.lang` en runtime al rehidratar).
- `globals.css`: se conservó la regla combinada de `develop` (`.language-toggle, .theme-toggle` sobre variables CSS), descartando la regla standalone con colores hardcodeados que tenía la rama vieja.
- `dictionary.ts`: se conservaron las claves de traducción de "Tema" (`Cambiar a modo claro` / `oscuro`) agregadas en `develop`.

### Verificación

`pnpm tsc --noEmit` y `pnpm build` corridos en `client/` sin errores después de la resolución.

---

## 2. Amazon Chime SDK para llamadas de voz y video

> **Decisión histórica, sustituida por LiveKit:** Chime no está admitido en el plan FREE del nuevo AWS experience (sección 11) y se reemplazó por LiveKit autohospedado en EC2 (sección 12). Se conserva como registro de la evaluación inicial; no describe el stack actual.

**Fecha:** 2026-10-24
**Rama:** `feature/voice-video-call`

### Contexto

Date2gether necesita soporte de videollamada grupal (equivalente a Google Meet). El transporte de audio/video en una videollamada grupal requiere un SFU (Selective Forwarding Unit) que reciba los streams de cada participante y los redistribuya al resto, ya que WebRTC peer-to-peer puro no escala más allá de unos pocos participantes.

El proyecto tiene planeado desplegar su infraestructura en AWS.

### Alternativas consideradas

- **SFU self-hosted (LiveKit o mediasoup) sobre EC2/ECS/Fargate.** Da más control y potencialmente menor costo a gran escala, pero implica operar, escalar y mantener los media servers (parcheo, autoescalado, monitoreo de carga de CPU/red) como responsabilidad propia del equipo.
- **Amazon Chime SDK.** Servicio de AWS nativo para videollamadas: expone una API (`@aws-sdk/client-chime-sdk-meetings`) para crear reuniones y asistentes, y un SDK de cliente (`amazon-chime-sdk-js`) que maneja la señalización y los streams en el navegador. El SFU lo opera y escala AWS.

### Decisión

Se eligió **Amazon Chime SDK**.

### Justificación

- Es un servicio administrado por AWS: no hay que operar ni escalar servidores de media propios, lo que reduce la carga operativa del equipo.
- Encaja directamente con la decisión de infraestructura ya tomada (AWS), evitando mezclar proveedores de media con el resto de la infraestructura.
- Tiene SDK oficial de cliente para React/navegador, lo que simplifica la integración en el frontend Next.js existente.

### Consecuencias

- El backend depende de credenciales de AWS y de la disponibilidad del servicio Chime SDK Meetings en la región elegida (`us-east-1` por ahora).
- Se pierde el control fino sobre el comportamiento del SFU que sí se tendría con un despliegue self-hosted (por ejemplo, ajustes de codecs o políticas de bitrate muy específicas).
- El costo escala con el uso del servicio de AWS en lugar de con infraestructura propia.

---

## 3. Jest como test runner unitario del backend

**Fecha:** 2026-10-24
**Rama:** `feature/voice-video-call`

### Contexto

El proyecto solo tenía pruebas end-to-end con Playwright (`e2e/*.spec.ts`). Para desarrollar la integración con Chime SDK con TDD se necesitaba poder probar servicios de NestJS de forma aislada, mockeando el cliente de AWS — algo que Playwright no puede hacer, porque es un driver de navegador/HTTP que corre contra la aplicación completa, no un framework que se inyecte en el contenedor de DI de Nest para sustituir una dependencia por un mock.

### Alternativas consideradas

- **Vitest.** Más rápido y con mejor DX moderna, pero no es el test runner que NestJS trae por convención: hay que configurar a mano el transform de TypeScript y los decoradores, perdiendo el "camino feliz" que ofrecen los schematics oficiales de Nest.
- **Jest.** Es el test runner que los schematics de `@nestjs/schematics` generan por defecto. Toda la documentación oficial de NestJS y la mayoría de ejemplos de la comunidad lo asumen.

### Decisión

Se eligió **Jest**, junto con `@nestjs/testing` y `ts-jest`.

### Justificación

- Es la convención oficial de NestJS, lo que reduce la fricción de configuración y mantiene el proyecto alineado con lo que cualquier desarrollador de Nest espera encontrar.
- Permite mockear dependencias (como el cliente de Chime SDK) de forma aislada y rápida, habilitando un ciclo real de TDD (rojo-verde-refactor) en milisegundos por test.
- Playwright se mantiene para las pruebas end-to-end existentes; ambas herramientas son complementarias, no sustitutas: Jest prueba unidades de lógica, Playwright prueba el flujo completo de usuario.

### Consecuencias — incompatibilidad de módulos (ESM) con NestJS 12

Al configurar Jest se encontró un problema no anticipado: NestJS 12 se distribuye como **ESM puro** (`"type": "module"`, sin build CommonJS), y algunos de sus archivos internos usan `import.meta.url`, una sintaxis sin equivalente en CommonJS. Esto hace que no sea posible transformar esos archivos a CommonJS (ni con `ts-jest` ni con Babel), que es el modo en el que Jest corre por defecto.

**Solución aplicada:** correr los archivos de test en modo ESM nativo, en lugar de intentar convertir las dependencias a CommonJS:

- `tsconfig.spec.json` (nuevo): configuración de TypeScript específica para los tests (`module: ESNext`), separada de `tsconfig.json`, que sigue compilando el build de producción en CommonJS sin cambios.
- Scripts `test`, `test:watch` y `test:cov` en `package.json` corren con `NODE_OPTIONS=--experimental-vm-modules` (vía `cross-env` para compatibilidad multiplataforma).
- Los globals de Jest (`describe`, `it`, `expect`, `jest`, etc.) se importan explícitamente desde `@jest/globals` en cada archivo de test, porque en modo ESM Jest no los inyecta automáticamente como sí hace en modo CommonJS.
- `tsconfig.json` incorporó `"types": ["jest", "node"]` explícito, porque la resolución automática de tipos de TypeScript no encontraba los tipos de Jest instalados por pnpm (estructura de `node_modules` basada en symlinks).

Esta configuración es infraestructura de una sola vez: los próximos archivos `.spec.ts` que se agreguen no necesitan repetir este trabajo, solo seguir el patrón ya establecido en `src/modules/calls/calls.service.spec.ts`.

---

## 4. JwtAuthModule: módulo compartido para separar el guard JWT de AuthService

**Fecha:** 2026-10-25
**Rama:** `feature/voice-video-call`

### Contexto

Los endpoints de `CallsController` (crear reunión, crear asistente) necesitan quedar detrás de `JwtAuthGuard`, el mismo guard que ya usa `AuthController`. Había que decidir cómo un módulo de dominio distinto a `auth` (en este caso `calls`) accede a ese guard sin arrastrar dependencias que no le corresponden.

### Alternativas consideradas

- **Importar `AuthModule` completo.** Es la forma "obvia" de reusar algo que `AuthModule` ya exportaba (`JwtAuthGuard`). Falló al compilar: `AuthModule` también provee `AuthService`, que depende del token `DRIZZLE` (conexión a Postgres). Como `DrizzleModule` es `@Global()` solo dentro del `AppModule` real, un test de `CallsModule` aislado (o cualquier contexto que no levante toda la app) rompe por una dependencia de base de datos que `CallsModule` ni usa ni le importa.
- **Duplicar `JwtModule.register({})` + `JwtAuthGuard` como providers propios en cada módulo que los necesite** (`AuthModule` y `CallsModule` por separado). Evita el problema de la DB, pero duplica la configuración del `JwtModule` en dos lugares: si mañana hay que pasarle opciones (por ejemplo, un `signOptions` global), hay que recordar tocar ambos módulos.
- **Extraer un módulo compartido `JwtAuthModule`** que solo registre `JwtModule.register({})` y provea/exporte `JwtAuthGuard` (y re-exporte `JwtModule` para quien necesite `JwtService` directamente, como `AuthService`). Tanto `AuthModule` como `CallsModule` lo importan.

### Decisión

Se eligió la tercera opción: `src/modules/auth/jwt-auth.module.ts` (`JwtAuthModule`) es la única fuente de verdad para el guard JWT. `AuthModule` lo importa (y lo necesita además para que `AuthService` obtenga `JwtService`). `CallsModule` lo importa directamente, sin pasar por `AuthModule` ni por su dependencia de base de datos.

### Justificación

- Una sola definición de `JwtModule.register({})` y `JwtAuthGuard`: ningún módulo repite el wiring, y un cambio futuro en la configuración del JWT se hace en un solo lugar.
- Separa limpiamente "verificar un JWT" (stateless, sin DB) de "gestionar usuarios y sesiones" (`AuthService`, con DB). Cualquier módulo nuevo que solo necesite autenticar requests puede importar `JwtAuthModule` sin heredar la capa de persistencia de auth.
- El test de integración `calls.module.spec.ts` (que levanta `CallsModule` real con `Test.createTestingModule`) y el nuevo `jwt-auth.module.spec.ts` detectaron el problema de acoplamiento en rojo antes de que llegara a producción: sin esos tests, el error de DI solo habría aparecido al bootear la app completa.

### Consecuencias

- Cualquier módulo nuevo que necesite proteger endpoints con JWT debe importar `JwtAuthModule`, no `AuthModule`.

---

## 5. MediaRegion de Chime en `sa-east-1` (São Paulo), control plane en `us-east-1`

**Decisión histórica, sustituida por la sección 11:** la región de medios ahora es configurable y se usa `us-east-2` para este proyecto.

**Fecha:** 2026-10-25
**Rama:** `feature/voice-video-call`

### Contexto

El curso recomienda usar la sede de AWS más cercana geográficamente para reducir latencia, y la más cercana a Argentina es São Paulo (`sa-east-1`). Había que verificar si eso aplicaba al valor `MediaRegion` hardcodeado en `CreateMeetingCommand` (`calls.service.ts`), al `AWS_REGION` del `ChimeSDKMeetingsClient` (`calls.module.ts`), o a ambos.

### Investigación

Chime SDK Meetings separa dos regiones con propósitos distintos (confirmado contra la documentación oficial de AWS, no asumido):

- **Control plane** (`AWS_REGION`, el endpoint al que el backend llama para crear/gestionar reuniones): solo disponible en un set limitado de regiones — `us-east-1`, `us-west-2`, `eu-central-1`, `ap-southeast-1`, `ap-south-1`, `ap-northeast-1`, `ap-northeast-2`, `ca-central-1`, `eu-west-2`, `il-central-1`, `af-south-1`. **`sa-east-1` no está en esta lista.**
- **Media region** (`MediaRegion`, dónde AWS procesa el audio/video real de esa reunión en particular): sí incluye `sa-east-1` entre sus valores soportados. AWS documenta explícitamente que "un control Region puede crear una reunión en cualquier media Region de la misma partición" — son independientes a propósito.

### Decisión

- `AWS_REGION` se mantiene en `us-east-1` (control plane — poner `sa-east-1` ahí rompería la conexión del SDK, esa región no expone ese endpoint).
- `MediaRegion` en `CreateMeetingCommand` pasa de `us-east-1` a `sa-east-1`.

### Justificación

- El control plane solo crea/gestiona metadata de la reunión; su latencia no la nota el usuario final.
- El `MediaRegion` es el que sí importa para la experiencia real: ahí vive el SFU que redistribuye los streams de audio/video, y acercarlo a los participantes (Argentina → São Paulo) reduce la latencia percibida en la llamada.

### Consecuencias

- Si el proyecto necesita en el futuro acercar también el control plane a la región (por ejemplo, para reducir la latencia de crear la reunión), la opción más cercana geográficamente no es `sa-east-1` sino `ca-central-1` (Canadá) — la lista de control plane regions no tiene ninguna en Sudamérica.

---

## 6. Jest + next/jest + React Testing Library para TDD en el frontend

**Fecha:** 2026-10-25
**Rama:** `feature/voice-video-call`

### Contexto

El cliente (`client/`, Next.js 15 + React 19) no tenía ningún test runner configurado — solo `oxlint` y `tsc`. Para seguir haciendo TDD también en el frontend (orquestación de las llamadas al backend de `calls` y la creación de la sesión de Chime) hacía falta elegir y configurar uno.

### Alternativas consideradas

- **Vitest + React Testing Library.** DX moderna y rápido, pero Next.js usa su propio bundler (Webpack/Turbopack, no Vite): hay que configurar a mano la resolución de `next/font`, `next/image`, variables de entorno, alias de paths, etc.
- **Jest + `next/jest` + React Testing Library.** Next.js documenta y mantiene oficialmente un preset (`next/jest`) que configura automáticamente el transform de SWC, mocks de `next/font`/CSS/imágenes y las variables de entorno del proyecto. Además reusa el mismo mental model que el backend (`describe`/`it`/`expect` de `@jest/globals`), recién establecido en este mismo ciclo de trabajo.

### Decisión

Se eligió **Jest con el preset `next/jest`**, más `jest-environment-jsdom`, `@testing-library/react` y `@testing-library/jest-dom`. Config en `client/jest.config.js`, setup en `client/jest.setup.ts`, scripts `test`/`test:watch` en `client/package.json` y pasamano `test:client` en la raíz.

### Justificación

- Es el camino oficialmente soportado por Next.js, con la menor configuración manual posible para esta versión de Next/React.
- Consistencia de herramientas con el backend: mismo test runner, mismos globals, mismo ciclo rojo-verde-refactor que el equipo ya está usando.

### Consecuencias — gotchas encontrados al configurar

`jest-environment-jsdom` simula el DOM del browser pero **no** incluye varias APIs que Node sí trae nativamente, y que hacían falta para testear código que usa `fetch`:

- `TextEncoder`/`TextDecoder` y `ReadableStream`/`WritableStream`/`TransformStream`: se toman de los módulos nativos de Node (`node:util`, `node:stream/web`) y se asignan a `globalThis` en `jest.setup.ts`.
- `fetch`/`Headers`/`Request`/`Response`: jsdom no los implementa. Se toman del paquete `undici` (la misma implementación que usa Node internamente), agregado como devDependency.
- **`MessagePort` sí se polyfillea (lo pide `undici` internamente), pero `MessageChannel` NO.** Este fue el bug más difícil de la sesión: sobreescribir `MessageChannel` con la implementación real de Node (`node:worker_threads`) cuelga `renderHook()`/`act()` de React Testing Library **indefinidamente, sin ningún error ni output** — nada en la consola, el proceso de Jest simplemente no termina. La causa: React usa `MessageChannel` internamente para su scheduler (para "cederle el control" al navegador entre renders), y la implementación de Node está pensada para workers reales con su propio event loop — no está integrada con el event loop simulado que jsdom/Jest usan en el proceso de test, así que el mensaje que el scheduler espera nunca llega. Diagnóstico: se aisló quitando partes del setup hasta reducir el test a un `renderHook()` sin ninguna llamada async, y se confirmó quitando `MessageChannel` del polyfill (dejando `MessagePort` solo) que el hang desaparecía.
- `jest.setup.ts` necesita al menos un `export {}` para que TypeScript lo trate como módulo ES, no como script global — sin eso, los `const` del archivo chocan con los tipos globales de `lib.dom.d.ts` (error `TS6200`).
- **`next/jest` (basado en SWC) no hace el hoist de `jest.mock()` por encima de los `import` estáticos**, a diferencia de Babel (`babel-plugin-jest-hoist`). Si un archivo de test importa estáticamente un módulo mockeado (o un módulo propio que a su vez lo importa), Jest carga la versión real antes de que el mock quede registrado. Solución: en esos casos, usar `import()` dinámico dentro del test, después de llamar a `jest.mock(...)` (ver `client/src/lib/chime.spec.ts`).
- El barrel de `amazon-chime-sdk-js` reexporta también `DefaultMessagingSession`, que depende de un paquete de `@aws-sdk` distribuido en ESM puro que Jest no puede transformar a CommonJS. Como no usamos messaging (solo meetings), se mockea `amazon-chime-sdk-js` con una factory explícita que solo define los símbolos que realmente se usan, evitando cargar el módulo real por completo.
- `next/jest` solo configura `moduleNameMapper` para CSS/imágenes/fonts; **no** lee el alias `"@/*"` de `tsconfig.json`. Cualquier test que importe (directa o transitivamente) un archivo con un import `@/...` fallaba con `Cannot find module`. Se agregó `moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }` a `client/jest.config.js`.
- `jest-environment-jsdom` tampoco implementa `Element.scrollTo` (no hay layout real para scrollear). Se agregó `Element.prototype.scrollTo = jest.fn()` a `jest.setup.ts`; sin esto, cualquier componente que haga autoscroll (como el panel de chat de la sala) rompe el render en tests.

---

## 7. Acceso con enlace y nombre para invitados, cuenta para crear y administrar

**Actualización:** 2026-10-26. Reemplaza la decisión inicial de exigir cuenta para entrar a cualquier sala.

Crear salas sigue requiriendo un JWT de cuenta. Al crear, el servidor registra al creador como administrador usando su identidad autenticada, conservando los roles de `develop`.

`POST /rooms/:code/access` acepta un nombre obligatorio de 1 a 60 caracteres, recortado en el servidor. Comprueba que la sala exista y esté activa. La cuenta es opcional: si llega un JWT de cuenta, se valida y registra su membresía; si no llega, se crea una participación invitada. El nombre nunca se usa como prueba de identidad.

El servidor emite un pase firmado con `kind: room-participant`, audiencia `date2gether:rooms`, identificador aleatorio, código de sala, nombre y, solo cuando fue autenticado, `userId`. Vence a las 24 horas. El JWT de cuenta no se sustituye: `JwtAuthGuard` rechaza los pases de sala para impedir que un invitado cree reuniones o administre roles.

El socket verifica ese pase, toma de él la identidad y el nombre y rechaza otra sala. La presencia usa `participantId`, de modo que dos nombres iguales no se fusionan. `POST /calls/:roomCode` verifica el mismo pase y devuelve la reunión y un asistente Chime para ese participante. Se elimina el endpoint público basado únicamente en un MeetingId arbitrario.

El enlace directo muestra el formulario de nombre antes de conectar el chat. El pase vive en memoria; la reconexión automática lo conserva y una recarga vuelve a pedir confirmación. Elegir el nombre no activa el micrófono: el audio se inicia con Llamar. La sala de espera y la moderación de ingresos quedan pendientes y serán opcionales, desactivadas por defecto.

---

## 8. Fix de hydration mismatch en `<html lang>` (bug preexistente del merge de dark-mode)

**Fecha:** 2026-10-25
**Rama:** `feature/voice-video-call`

### Contexto

React tiraba un warning de hydration mismatch en toda página (`lang="es"` esperado por el server vs `lang="en"` recibido en el cliente). No es un bug de esta rama: viene del commit `2de39ee` (`feat: add light/dark theme toggle with system preference`, ya en `main`), que agregó junto al tema oscuro un store de idioma (`features/translation/store.ts`).

Causa: `setLanguage` y el callback `onRehydrateStorage` del store mutaban `document.documentElement.lang` directamente. `onRehydrateStorage` corre apenas el store se crea en el cliente, antes de que React termine de reconciliar la hidratación, así que pisaba el `lang="es"` hardcodeado en `layout.tsx` con el valor del store (`language: 'en'`, el default) en cada carga.

### Decisión

Se aplicó el mismo patrón que `features/theme/store.ts` ya usa para el mismo problema (ahí no pasaba porque el theme nunca mutaba el DOM durante la rehidratación):

- `skipHydration: true` en el `persist` del store de idioma, igual que el de tema.
- Se sacó toda mutación del DOM de `store.ts` (el store queda puro, solo estado).
- Nuevo `features/translation/dom-helpers.ts` con `applyLanguageToDocument`, mismo rol que `theme/dom-helpers.ts`.
- `useTranslation()` dispara `useLanguageStore.persist.rehydrate()` en un efecto post-mount y aplica `applyLanguageToDocument(language)` en un efecto separado — ambos corren después de que la hidratación ya terminó, así nunca hay diferencia entre lo que mandó el server y lo que ve React al hidratar.

### Justificación

- Reusa un patrón ya revisado y en producción (`useTheme.ts`) para exactamente el mismo problema, en lugar de inventar uno nuevo.
- Separa estado (store) de efectos secundarios sobre el DOM (hook + dom-helpers), consistente con cómo ya está organizado `theme/`.

### Consecuencias

- Ninguna funcional: el store sigue exponiendo la misma API (`language`, `setLanguage`, `toggle`). No se tocó `dictionary.ts` ni el default `language: 'en'` — quedó fuera de alcance revisar si ese default tiene sentido frente al contenido en español de la mayoría de la UI, no fue lo que se reportó.

---

## 9. Cada click en "Llamar" creaba una reunión de Chime distinta — las salas no eran realmente grupales

> **Decisión histórica, sustituida por LiveKit** (secciones 11 y 12): LiveKit identifica la sala de medios por el código de la sala, por lo que `rooms.chime_meeting_id` ya no se usa.

**Fecha:** 2026-10-25
**Rama:** `feature/voice-video-call`

### Contexto

Con credenciales de AWS puestas, `CallsService.createMeetingForRoom` iba a funcionar en el sentido de "llamar a la API de Chime sin error" — pero revisando el código se encontró que **cada llamada a este método crea una `CreateMeetingCommand` nueva, con un `ClientRequestToken` random distinto cada vez**. No había ninguna tabla ni columna que asociara una sala con una reunión de Chime existente, ni ningún lookup antes de crear.

Consecuencia real: si dos personas en la misma sala apretaban "Llamar" por separado, terminaban en dos reuniones de Chime completamente distintas — nunca se verían ni escucharían entre sí. Para una feature pensada como "Meet/Zoom", esto rompía el propósito central (llamada grupal) aunque el código "funcionara" sin tirar errores.

### Decisión

`rooms` gana una columna nueva, `chime_meeting_id` (`varchar(64)`, nullable) — migración `drizzle/0003_chime_meeting.sql`. `CallsService.createMeetingForRoom(roomCode)` pasa a:

1. Buscar la sala por código (`RoomsService.getByCodeOrThrow`).
2. Si la sala ya tiene un `chimeMeetingId` guardado, pedirle a Chime esa reunión (`GetMeetingCommand`). Si todavía existe, la reusa y devuelve esa misma reunión — así todos los que llaman desde la misma sala entran al mismo `MeetingId`.
3. Si no tiene `chimeMeetingId`, o Chime responde `NotFoundException` (la reunión venció — Chime las da de baja sola tras un tiempo sin asistentes), crea una reunión nueva con `CreateMeetingCommand` y la persiste en la sala (`RoomsService.setChimeMeetingId`).

`RoomsService` ganó el método de persistencia (`setChimeMeetingId`); no sabe nada de Chime/AWS. `CallsModule` importa `RoomsModule` para poder inyectar `RoomsService` en `CallsService`.

### Justificación

- Es el mínimo necesario para que "sala" y "reunión de Chime" sean la misma cosa vista por todos los participantes, que es el requisito implícito de toda la feature.
- Manejar el caso "la reunión guardada ya no existe" (en vez de asumir que el `chimeMeetingId` persistido siempre es válido) es necesario, no un extra: las reuniones de Chime no son eternas, así que sin este chequeo la sala quedaría inutilizable para siempre después de la primera reunión vencida.
- Separar la persistencia (`RoomsService`) de la orquestación de Chime (`CallsService`) sigue el mismo criterio de responsabilidad única que ya se usó para `JwtAuthModule` (ver sección 4).

### Consecuencias

- `calls.module.spec.ts` ahora necesita `DrizzleModule` (con `DRIZZLE` mockeado vía `overrideProvider`) para compilar, porque `CallsModule` → `RoomsModule` → `RoomsService` depende de la base. A diferencia del guard JWT (sección 4), esta es una dependencia real e intencional: `CallsService` necesita leer y escribir datos de la sala.
- Sigue sin existir un endpoint para cerrar la reunión explícitamente al terminar la llamada (`DeleteMeetingCommand`) — la reunión se cierra sola del lado de Chime por inactividad; `chimeMeetingId` en la fila de la sala queda apuntando a una reunión vencida hasta el próximo `createMeetingForRoom`, que la detecta y la reemplaza.

## 10. Integración con develop y período gratuito de AWS

**Fecha:** 2026-10-26.

> La autorización de usar Amazon Chime SDK de esta sección quedó sin efecto: ver las secciones 11 y 12 (reemplazo por LiveKit).

Se conservan juntos los roles de sala, ES/EN, tema claro/oscuro, la corrección de hidratación y las llamadas. La colisión entre dos migraciones `0002` se resuelve conservando roles en `0002_panoramic_nebula` y regenerando Chime como `0003_chime_meeting`, con su snapshot enlazado al de roles. Las bases anteriores de la rama que ya hayan aplicado el antiguo `0002_fast_nebula` requieren reconciliación o una base local nueva; no se borran ni se reinician datos automáticamente.

El equipo autoriza AWS y Amazon Chime SDK para la etapa gratuita prevista de hasta seis meses. Se actualiza primero `docs/requirements.md` para reemplazar la restricción anterior de autohospedaje sin APIs comerciales. El plazo depende de los créditos y de los servicios disponibles en la cuenta; no garantiza consumo ilimitado. Las credenciales siguen solo en el backend y las pruebas automatizadas simulan Chime sin consumir AWS.


## 11. Configuración de audio para el proyecto date2gether

**Fecha:** 2026-10-26

> **Sustituida por la sección 12:** las variables `AWS_CHIME_*` descritas aquí ya no existen; el audio y el video los resuelve LiveKit autohospedado. Se conserva el hallazgo de que Chime no está admitido en el plan FREE.

La consulta `GetAccountPlanState` confirmó `FREE` y `ACTIVE`. El nuevo AWS experience excluye Chime SDK incluso en su plan pago simplificado. Instalar Agent Toolkit y autenticar AWS CLI no cambia esa restricción. No se cambia el plan, se activan funciones avanzadas ni se crean reuniones para probar el código.

`AWS_CHIME_ENABLED` exige activación explícita; su valor por defecto es `false`. Así se puede continuar con cuentas, invitados y chat mientras se decide sobre el acceso a Chime. En modo deshabilitado se devuelve HTTP 503 antes de consultar AWS. Las credenciales se resuelven con el perfil local `date2gether`, compatible con `aws login`, o con un rol en AWS. Los errores externos se convierten en mensajes de servicio sin divulgar identificadores ni políticas.

`AWS_REGION=us-east-2` representa la región seleccionada. `AWS_CHIME_MEDIA_REGION` usa esa región como valor por defecto. `AWS_CHIME_REGION=us-east-1` identifica el endpoint de control compatible; requiere acceso autorizado a esa región y no se contacta mientras Chime esté deshabilitado. Esto reemplaza la selección fija de São Paulo de la sección 5.

Los ingresos simultáneos comparten una promesa por sala en el proceso. El token idempotente de creación deriva del ID de sala y de su reunión anterior, para que un mismo intento no genere reuniones distintas entre procesos. Los tests simulan AWS y verifican también reintentos tras fallos.

El cliente escucha `audioVideoDidStart` antes de mostrar la llamada conectada. Permite cancelar, silenciar y volver a activar el micrófono. Al colgar, salir o fallar elimina el observer y destruye el controlador de dispositivos. Los intentos cancelados no encienden el micrófono cuando termina una solicitud pendiente.

La conexión real entre dispositivos permanece pendiente hasta disponer de acceso al servicio. Los pasos y fuentes oficiales están en el [README principal](../README.md#aws-y-llamadas).


## 12. LiveKit autohospedado en EC2 para la entrega académica

**Fecha:** 2026-10-27

El usuario eligió conservar el plan gratuito de seis meses, utilizar EC2 y reducir el cupo para una entrega que no tendrá tráfico diario. El objetivo de la entrega pasa a seis personas por llamada; no se requiere Chime ni un plan pago de LiveKit Cloud. Se retiran ambos SDK de Chime y se utilizan `livekit-server-sdk`, `livekit-client` y los componentes oficiales de React.

El backend confirma la sala y el pase de participante, crea idempotentemente su sala de medios con cupo y emite un JWT de corta duración. El token conserva el nombre elegido y una identidad independiente; no concede administración. El cupo se verifica en LiveKit al conectar, incluso si varios tokens se emitieron a la vez. El chat conserva Socket.io y su admisión no aplica todavía un cupo equivalente.

El cliente muestra grilla, audio remoto, controles y selección de cámara/micrófono. Ambos medios se conectan apagados hasta que la persona los active. Se puede continuar sin un dispositivo o con sus permisos rechazados. La salida desconecta y libera los tracks mediante el ciclo de vida de los componentes oficiales.

El despliegue de una EC2 en `us-east-2` incluye aplicación, PostgreSQL, LiveKit, Caddy con HTTPS y TURN/TLS. Las claves se generan en la instancia y quedan en archivos ignorados por Git. La API de producción usa `/api`, incluido el path de Socket.io, para mantener un solo origen HTTPS. La IP se reserva para conservar los enlaces al detener y volver a iniciar EC2. El apagado automático limita el tiempo de cómputo; EBS e IPv4 mantienen costos residuales.

La columna antigua de Chime se conserva para no reescribir migraciones ni borrar datos. No se utiliza para las llamadas nuevas. La configuración está en [deploy/ec2](../deploy/ec2/README.md); la validación final requiere el despliegue y una prueba real desde distintas redes.


## 13. Revisión de exposición y dependencias antes del despliegue

**Fecha:** 2026-10-27

Se revisaron archivos versionables y referencias Git locales en busca de patrones habituales de credenciales AWS, tokens GitHub y claves privadas; no se detectaron coincidencias. Los secretos JWT locales se compararon con los archivos versionables sin publicar sus valores. Se amplía `.gitignore` para excluir variantes `.env*`, `.aws`, claves privadas y los archivos generados por el despliegue; los `.env.example` siguen versionables y contienen exclusivamente datos de prueba.

La auditoría reportó avisos en Next.js, body-parser y multer. Se actualizó Next.js a 15.5.28 y se fijaron versiones corregidas de las dependencias transitivas. También se corrigieron avisos en fast-uri y esbuild utilizados por herramientas de desarrollo. Tras los cambios, `pnpm audit` no reporta avisos; el resultado está limitado a los avisos conocidos por el registro en el momento de la consulta. El override de esbuild se comprobó generando una migración en `/tmp`, sin modificar la base del usuario.

El PostgreSQL del Compose de desarrollo se vincula a `127.0.0.1` en vez de a todas las interfaces, conservando el volumen. El contenedor anterior conserva su configuración hasta que el usuario lo recree. Los códigos de las salas recién creadas usan `crypto.randomInt`. Las invitaciones anteriores no cambian y quien posea un enlace válido aún puede entrar como invitado, según la regla del producto.

Los tokens de cuenta siguen en `localStorage`; un ataque de inyección de scripts podría acceder a ellos. La prueba de penetración, la revisión de la instancia EC2 desplegada y los controles de admisión y revocación de invitaciones no forman parte de esta comprobación y quedan pendientes.


## 15. Cobertura de testing en capas (unitario, componentes, E2E) y pipeline de CI

**Fecha:** 2026-11-04

### Contexto

La rama `feature/e2e-ci-coverage` partió con una suite E2E de Playwright (registro/login/logout, chat, preferencias de tema e idioma, roles de sala, creación/acceso a salas — 28 escenarios en 5 archivos) y un workflow de GitHub Actions que solo ejecutaba esa suite. Antes de dar por cerrada la rama se auditó, archivo por archivo, qué código de negocio real tenía test propio y cuál dependía exclusivamente del camino E2E para quedar ejercitado.

### Criterio de cobertura aplicado

Se testea unitariamente lo que tiene lógica propia (ramas, cálculos, reglas de negocio, manejo de errores); no se testea lo que es pura delegación de una línea (un controlador que solo reenvía al service, un botón que solo llama a un hook). Este criterio se aplicó tanto al auditar qué faltaba como al decidir qué no entraba en el alcance.

### Brecha encontrada en el servidor

El pipeline de CI solo corría `pnpm test:e2e`; los unitarios de Nest (`pnpm test`) y los de componentes de Next (`pnpm test:client`) existían en el repositorio pero no se ejecutaban en ningún workflow. Además, `RoomsService`, `ChatService`, `AuthService`, `RoomEventsService`, `RoomRolesGuard` y `generate-room-code` no tenían ningún test unitario propio: su única cobertura era indirecta, a través de los controladores (que mockean el service por completo) o de los escenarios E2E.

Se agregaron 6 archivos de test (34 casos) para esos módulos, con un helper compartido (`src/test-support/fake-drizzle.ts`) que simula en memoria la cadena de consultas de Drizzle usada por `RoomsService`, `ChatService` y `AuthService`, evitando levantar una base real para probar lógica que no depende de SQL concreto. `AuthService` recibió la cobertura más profunda por ser la pieza de seguridad más crítica: hash de contraseña, mismo mensaje de error ante email inexistente o contraseña incorrecta (para no filtrar cuál de los dos falló), rotación y detección de reuso de refresh tokens, y logout idempotente.

Desviación encontrada durante la implementación: forzar la colisión de código de sala en `RoomsService.createRoom` mediante `jest.mock()` sobre `generate-room-code` resultó poco confiable bajo el modo ESM experimental que usa este proyecto con ts-jest. Se optó por mockear directamente `db.select` (lo que `findByCode` consulta), logrando la misma cobertura de comportamiento sin depender de un mecanismo de mocking de módulos inestable en este entorno.

### Brecha encontrada en el cliente

`lib/auth.ts`, los hooks `useTheme`, `useSystemTheme` y `useTranslation`, `useRoomMembers`, el fallback defensivo de `RoleTag` y las páginas de login/registro tampoco tenían test propio. Se agregaron 10 archivos (49 casos), incluyendo el flujo de reintento de `getCurrentUser` tras un 401 y el filtrado por clave de `onAuthChange` (solo debe reaccionar a cambios de los tokens, no a cualquier escritura en `localStorage`).

Quedaron fuera de alcance, a propósito, `ThemeToggle`, `LanguageToggle`, los stores de Zustand como archivos independientes y `dictionary.ts`: ninguno tiene lógica propia más allá de delegar a un hook ya testeado o de ser datos planos.

### Pipeline de CI ampliado

El workflow (antes `E2E`, ahora `CI`) pasó de un job a tres, corriendo en paralelo en cada push y pull request a `main`/`develop`: `unit-server` (`pnpm test`), `unit-client` (`pnpm test:client`) y `e2e` (`pnpm test:e2e`, con el service container de Postgres descartable que ya usaba). Ninguno depende de los otros, para no retrasar el feedback de los más rápidos por un E2E más lento.

### Convención de naming de tests

Durante el proceso se corrigieron nombres de test que no dejaban entender, sin leer el cuerpo, el escenario, el mecanismo verificado y el resultado esperado — por ejemplo, "cancelar descarta la respuesta tardía y elimina las credenciales" (impreciso: nunca se llega a guardar nada para borrarlo) se reescribió como "salir de la llamada mientras todavía se está conectando cancela el pedido en curso, y si la conexión se confirma después de todas formas, la pantalla se queda como si nunca hubiera entrado". El criterio quedó establecido para los tests nuevos desde el primer intento: describir el comportamiento en lenguaje de "qué pasa en pantalla", sin jerga interna de implementación (identificadores, nombres de variables), y sin acortar a costa de la precisión.

### Limitación conocida y aceptada

`applyThemeToDocument` y `applyLanguageToDocument` (en `dom-helpers.ts` de `theme` y `translation`) tienen una guarda `if (typeof document === 'undefined') return`. Sus únicos dos puntos de llamada están dentro de un `useEffect`, que por diseño de React nunca se ejecuta en el servidor — por lo tanto esa rama no se ejecuta ni en los tests (jsdom simula un `document` que siempre existe) ni en producción con el código actual. Se decidió conservarla como resguardo defensivo ante un eventual uso futuro fuera de un efecto, documentando que hoy es una rama sin cobertura real y sin impacto, en vez de testearla con un entorno Jest especial o eliminarla.

### Estado final de cobertura en esta rama

| Capa | Resultado |
|---|---|
| Unitario servidor (Jest) | 14 suites / 56 tests |
| Unitario/componentes cliente (Jest + RTL) | 18 suites / 70 tests |
| E2E (Playwright) | 28 escenarios en 5 archivos |
| CI (GitHub Actions) | 3 jobs en paralelo por push/PR a `main`/`develop`: `unit-server`, `unit-client`, `e2e` |
## 14. Correcciones de arranque y construcción detectadas en el primer despliegue real a EC2

**Fecha:** 2026-10-28

La sección 12 preparó la plantilla de EC2 sin una validación de extremo a extremo contra una instancia real. El primer despliegue efectivo expuso tres fallas que la validación local de CloudFormation no podía detectar, porque esa validación comprueba sintaxis y no ejecuta el `UserData` ni el contenedor de producción.

El backend no arrancaba dentro del contenedor: `start:prod` ejecutaba `node dist/main`, pero `nest-cli.json` fija `sourceRoot: "src"` y `tsconfig.build.json` no redefine `rootDir`, así que `nest build` conserva la estructura de carpetas de `src/` dentro de `dist/` y el archivo compilado queda en `dist/src/main.js`, no en `dist/main.js`. Node fallaba con `Cannot find module '/app/dist/main'` al iniciar `deploy/Dockerfile` (`CMD ["pnpm", "start:prod"]`). Se corrige el script a `node dist/src/main`.

La verificación de integridad de `docker-compose` no verificaba nada: el `UserData` descargaba el binario directamente con el nombre final `docker-compose` dentro de `cli-plugins/` y corría `sha256sum --check --ignore-missing` ahí mismo contra `checksums.txt`, que lista el nombre original del asset (`docker-compose-linux-x86_64`). Como ningún nombre coincidía, `--ignore-missing` descartaba la única línea relevante y el comando terminaba en éxito sin haber comparado ningún hash. Se corrige descargando el binario a `/tmp` con su nombre original, verificando el checksum ahí, e instalándolo recién después con `install -m 755` en `cli-plugins/docker-compose`. La verificación deja de ser cosmética: un hash que no coincide ahora sí interrumpe el arranque (`set -euo pipefail`).

`docker compose build backend frontend` (en `deploy/ec2/start.sh`) fallaba con `docker: 'buildx' is not a docker command`, porque el paquete `docker` de Amazon Linux instalado vía `dnf` no incluye el plugin CLI `buildx`, requerido por Compose v2 para construir imágenes. Se agrega al `UserData` la descarga e instalación de `docker-buildx` como plugin CLI, con la misma verificación de checksum contra su archivo original que se corrigió para `docker-compose`.

Ninguna de las tres fallas es visible en desarrollo local (ahí no se usa `start:prod` fuera de Docker, y `docker compose up -d` no pasa por `build` ni por el `UserData` de EC2), lo que explica por qué llegaron sin detectarse hasta el despliegue real. No cambia el comportamiento documentado en el README ni en la [guía de EC2](../deploy/ec2/README.md): los mismos pasos ahora sí completan el arranque.

---

## 16. Música ambiental sincronizada en la llamada: reproducción local por cliente, no audio retransmitido por LiveKit

**Fecha:** 2026-11-05
**Rama:** `feature/call-ambient-music` (creada desde `feature/e2e-ci-coverage`)

### Contexto

Se pidió una función de música ambiental para las salas de llamada: el administrador de la sala elige un video de YouTube y el resto de los participantes escucha "lo mismo" mientras dura la llamada.

### Alternativas consideradas

- **Capturar el audio del reproductor de YouTube y publicarlo como track de LiveKit.** Técnicamente inviable: el iframe de YouTube es cross-origin, y los navegadores bloquean `captureStream()` sobre audio de un origen distinto por seguridad.
- **Extraer el stream de audio crudo de YouTube (estilo `ytdl-core`/`yt-dlp`, como hacen los bots de música de Discord) y retransmitirlo por LiveKit.** Viola los Términos de Servicio de YouTube (sección 5.B, prohíbe descargar/extraer contenido fuera del reproductor oficial). Hay precedente de aplicación real: Google envió cese y desista a Rythm y Groovy (los dos bots de música más grandes de Discord) en 2021, forzando su cierre por esta misma práctica.
- **Reproducción local sincronizada.** Cada cliente carga su propia instancia del YouTube IFrame Player API (oficial, gratuito) con el mismo `videoId`, y el administrador controla play/pause/cambio de video mediante eventos de Socket.io que se retransmiten a toda la sala. El audio nunca viaja por el servidor ni por LiveKit.

### Decisión

Se optó por la **reproducción local sincronizada por Socket.io**, reutilizando el gateway de sala ya existente (`src/modules/chat/chat.gateway.ts`, namespace `/rooms`) en vez de introducir el data channel de LiveKit como segundo transporte de tiempo real.

### Justificación

- Es la única opción sin riesgo legal: no depende de scraping ni de extracción de streams, y usa el mecanismo de embebido que YouTube ofrece explícitamente para este fin.
- El rol de "anfitrión" no requirió ningún concepto nuevo: coincide con el rol `administrador` por sala que ya existe en `roomMembers` (quien crea la sala queda como `administrador`, ver `rooms.service.ts`).
- La sincronización es aproximada (margen de ~1 segundo por latencia de red), no a nivel de muestra de audio — aceptado explícitamente para este caso de uso, ya que se trata de música de fondo y no de reproducción que requiera sincronía exacta.
- El chequeo de rol de administrador en los eventos de Socket.io se hace a mano dentro del handler (`roomsService.getMemberRole`), porque `RoomRolesGuard` solo funciona sobre contexto HTTP y no corre sobre gateways WebSocket.

---

## 17. Música ambiental: de una sola canción a playlist, título resuelto por el cliente

**Fecha:** 2026-11-06
**Rama:** `feature/call-ambient-music`

### Contexto

La sección 16 dejó `MusicState` con un solo `videoId`: el admin reemplazaba la canción entera al elegir una nueva. El pedido fue agregar una playlist real (varias canciones encoladas, con sus títulos visibles y navegación anterior/siguiente), con la UI del reproductor rediseñada a un formato tipo tarjeta.

### Decisiones

- **Quién agrega canciones a la cola:** se mantiene admin-only, igual que el resto de los controles de música (decidido explícitamente con el usuario en vez de asumir un modelo de cola colaborativa estilo bot de Discord). Evita el riesgo de que cualquier participante llene la cola sin control.
- **De dónde sale el título de cada canción:** el cliente lo resuelve con el oEmbed público de YouTube (`https://www.youtube.com/oembed?...&format=json`, sin API key, CORS habilitado) antes de emitir `musicAddTrack`. El servidor no vuelve a resolverlo: solo guarda y retransmite `{ videoId, title }` tal como llegan, igual que ya hacía con `videoId` (el id real se sigue extrayendo/validando en el gateway, el título no se valida más allá del largo).
- **Forma del estado compartido:** `MusicState` pasa de `{ videoId, ... }` a `{ tracks: {videoId, title}[], currentIndex, ... }`. Agregar una canción a una lista que ya está sonando no interrumpe la reproducción en curso (`isPlaying`/`positionSeconds` se preservan); solo la primera canción de la sala arranca en `currentIndex 0`, pausada, en el segundo 0.
- **Eventos nuevos:** `musicAddTrack` reemplaza a `musicSetTrack` (semántica distinta: agrega al final en vez de reemplazar). Se suman `musicRemoveTrack` (por índice, reacomoda `currentIndex` si la canción sacada estaba antes de la actual, o reinicia reproducción si era la que sonaba), `musicNext` y `musicPrevious` (no envuelven la lista: se quedan en el primer/último tema).

### Justificación

- Resolver el título en el cliente evita que el backend dependa de la API de YouTube (ni API key, ni llamadas salientes nuevas desde el servidor) para algo que es puramente informativo.
- Mantener el modelo admin-only para agregar canciones es consistente con el resto del feature (play/pause/seek ya eran admin-only desde la sección 16): una sola superficie de permisos para toda la música de la sala, no dos.

---

## 18. `ThrottlerGuard` global rompía los eventos de WebSocket sin `@MessageBody()`

**Fecha:** 2026-11-06
**Rama:** `feature/call-ambient-music`

### Contexto

Al probar `musicNext`/`musicPrevious` manualmente (no están cubiertos por los tests unitarios del gateway, que llaman a los métodos directo y se saltan el pipeline de guards de Nest), el cliente recibía `Internal server error`. El log del backend mostraba `TypeError: Cannot read properties of undefined (reading 'header')` en `ThrottlerGuard.setResponseHeader`.

### Causa

`ThrottlerGuard` está registrado como `APP_GUARD` global (`app.module.ts`), pensado para limitar los endpoints HTTP (60 req/min). Nest corre las guards globales también sobre los handlers de WebSocket de `ChatGateway`, pero `ThrottlerGuard` asume contexto HTTP: llama a `context.switchToHttp().getResponse()` para setear headers `X-RateLimit-*`. En un handler de WS que **no** declara `@MessageBody()` (como `handleMusicNext`/`handleMusicPrevious`, que no reciben payload), Nest arma el array de argumentos del contexto sin un segundo elemento, así que `getResponse()` devuelve `undefined` y `setResponseHeader` explota al leer `.header` de `undefined`. Los demás handlers de música (`musicAddTrack`, `musicPlay`, etc.) no lo sufrían porque, al declarar `@MessageBody() dto: AlgunDto`, ese DTO terminaba ocupando el lugar de "response" — sin los métodos `.header`/`.setHeader`, así que `setResponseHeader` no hacía nada en vez de explotar. Era frágil: cualquier handler de WS sin `@MessageBody()` iba a pisar la misma mina.

### Decisión

Se creó `HttpOnlyThrottlerGuard` (`src/common/http-only-throttler.guard.ts`), que extiende `ThrottlerGuard` y sobreescribe `shouldSkip` para saltar cualquier contexto que no sea `'http'`. Reemplaza a `ThrottlerGuard` como `APP_GUARD` en `app.module.ts`. El límite de 60 req/min sigue aplicando a los endpoints REST igual que antes; los gateways de WebSocket quedan completamente afuera de esta guard (ya tienen su propio control de acceso vía `WsJwtAuthGuard` y el chequeo de rol admin a mano en `ChatGateway`).

### Nota sobre testing

No se pudo agregar un test unitario para `HttpOnlyThrottlerGuard`: cualquier archivo de test que importe `@nestjs/common` y `@nestjs/throttler` en el mismo módulo revienta con `Cannot require() ES Module ... in a cycle`, un bug confirmado de la combinación ts-jest + `--experimental-vm-modules` + esta versión de `@nestjs/throttler` (reproducido de forma aislada, independiente del código del guard). El fix se verificó manualmente contra el servidor real.

---

## 19. Barra de avance (scrub bar) de la música ambiental: sin seek local optimista

**Fecha:** 2026-11-06
**Rama:** `feature/call-ambient-music`

### Contexto

El reproductor de música ambiental solo tenía play/pause/anterior/siguiente; faltaba una línea de tiempo tipo YouTube que muestre el progreso de la canción y permita al admin saltar a un punto específico arrastrándola.

### Alternativas consideradas

- **Seek optimista:** al arrastrar la barra, llamar a `player.seekTo()` directamente en el browser del admin para feedback instantáneo, y además emitir `musicSeek` para el resto de la sala. Da respuesta inmediata a quien arrastra, pero rompe el invariante ya documentado en `reconcilePlayerState` (`ambientMusic.ts`): el player nunca se controla directamente desde la UI, siempre reacciona a `musicState`. El admin podría terminar viendo una posición distinta a la que el servidor termina confirmando (por ejemplo, si el seek se emite pero el evento se pierde o llega fuera de orden).
- **Seek solo por socket:** la barra nunca llama al player; al soltar, solo emite `musicSeek({ positionSeconds })`, y el player local del admin (igual que el de cualquier otro participante) recién se mueve cuando llega el próximo `musicState` y `reconcilePlayerState` lo aplica.

### Decisión

Se eligió **seek solo por socket**, manteniendo el mismo invariante que ya rige play/pause/next/previous.

### Justificación

- Preserva una única fuente de verdad (`musicState` retransmitido por el gateway) para la posición de reproducción de todos los participantes, admin incluido, en vez de abrir una excepción puntual para el seek.
- Evita divergencia entre lo que el admin ve localmente tras arrastrar y lo que el resto de la sala termina viendo si el seek no se aplica exactamente igual en ambos lados.
- El backend (`handleMusicSeek` en `chat.gateway.ts`) ya preserva `isPlaying` al recibir `musicSeek`, por lo que no hace falta lógica adicional en el cliente para mantenerlo.

### Consecuencias

- Hay un pequeño retraso perceptible entre que el admin suelta la barra y la ve moverse a la posición elegida (tiene que esperar el viaje de ida del evento, su aplicación en el servidor, y el `musicState` de vuelta), en vez de salto instantáneo. Es el mismo tradeoff ya aceptado para play/pause desde la sección 16, extendido a seek de forma consistente.

---

## 20. Música ambiental: el admin se une solo, y el volumen es una preferencia local

**Fecha:** 2026-11-06
**Rama:** `feature/call-ambient-music`

### Contexto

El botón "Unirme a la música" se mostraba a todos los participantes por igual, admin incluido. Para el admin es una fricción sin sentido: es quien controla la playlist (agregar, play/pause, seek), así que pedirle que además "solicite permiso" para escuchar su propia música no tiene sentido de producto. Tampoco había ninguna forma de bajar o silenciar el volumen una vez unido.

### Decisiones

- **El admin se une solo.** El botón "Unirme a la música" ahora se oculta para el admin (`!joined && !isAdmin`); en su lugar, un `useEffect` dispara la misma lógica de `handleJoinMusic` (crear el player YouTube + `unMute()`) automáticamente al montar. Para el momento en que este componente es interactivo, el usuario ya hizo un gesto en la página (entrar a la reunión), así que ese `unMute()` disparado desde un efecto no choca con la política de autoplay con sonido del navegador — el mismo razonamiento que ya justificaba el flujo de un solo click para los invitados.
- **El volumen es un estado puramente local, nunca se sincroniza por el socket.** Una alternativa considerada fue incluir el volumen por usuario dentro de `musicState` para que sea visible/debugueable por el resto de la sala. Se rechazó: el volumen es una preferencia de escucha personal, sin ningún motivo para que otros participantes la vean o les importe — a diferencia de la posición/canción actual, que sí tienen que ser idénticas para todos.
- **`muted` y `volume` son dos estados separados, no uno derivado del otro.** La API de YouTube no deshace un `mute()` previo con `setVolume()`: el audio sigue en silencio hasta un `unMute()` explícito. Tocar el slider de volumen estando silenciado también limpia el `muted` local y llama a `unMute()`, replicando el comportamiento estándar del control de volumen nativo de `<video>`/`<audio>`.

### Justificación

- Mantiene consistencia con el resto del feature: el admin ya no interactúa con ningún gate de "pedir unirse" para algo que controla de punta a punta.
- Evita acoplar una preferencia individual (volumen) al estado compartido de la sala, que hasta ahora solo modela lo que tiene que verse igual para todos (`tracks`, `currentIndex`, `isPlaying`, `positionSeconds`).
- Mientras se arrastra, la UI usa un valor local de "preview" (no derivado de `musicState`) para que el drag se sienta fluido; ese valor se descarta al soltar y la barra vuelve a reflejar la posición autoritativa del servidor.

---

## 21. Nombre editable para salas permanentes (al crear y después)

**Fecha:** 2026-11-20
**Rama:** `feature/room-poll-event`

### Contexto

`rooms.name` ya existía como columna `notNull` y `CreateRoomDto.name` ya era obligatorio, pero el cliente nunca dejaba escribirlo: `app/page.tsx` siempre mandaba `Reunión de ${name}`, donde `name` es el nombre de usuario de quien crea la sala, no un nombre de sala. Para una sala efímera (TTL 24h) eso no importa, pero para una permanente — pensada para reusarse en el tiempo, a veces por un grupo entero — quedar pegada para siempre al nombre de quien la creó una vez no tiene sentido de producto.

### Alternativas consideradas

- **Nombrar solo al crear.** Cambio más chico (un input nuevo en el form), pero no resuelve salas permanentes ya existentes ni errores de tipeo.
- **Nombrar al crear + permitir renombrar después (elegida).** Agrega un endpoint de escritura nuevo, pero cubre el caso real: el nombre de una sala de uso recurrente puede necesitar ajustarse con el tiempo.

### Decisión

Se implementaron ambas puntas:

- El nombre de sala es **opcional** en el form de creación (`app/page.tsx`), y solo se muestra cuando `isPermanent` está activo. Si se deja vacío, se mantiene el comportamiento actual (`Reunión de {nombre del usuario}`).
- Nuevo endpoint `PATCH /rooms/:code/name` (`UpdateRoomNameDto`, mismo guard stack que `PATCH /rooms/:code/members/:userId`: `JwtAuthGuard` + `RoomRolesGuard` + `@RoomRoles('administrador')`), y `RoomsService.renameRoom`.
- **El renombre queda restringido a salas permanentes, validado en el servidor** (`renameRoom` lanza `ForbiddenException` si `!room.isPermanent`), no solo ocultando el botón en el cliente — así no se puede saltear llamando al endpoint directo. Las salas temporales se recuperan en 24h (D5); darles un nombre persistente no aporta nada y complica el modelo mental.
- UI de renombre en "Mis salas" (`app/rooms/page.tsx`): un botón ✏️ visible solo en filas `isPermanent`, que abre un input inline con Guardar/Cancelar.

### Resolución aplicada

- Backend: `dto/update-room-name.dto.ts` (nuevo), `rooms.controller.ts` (+`renameRoom`), `rooms.service.ts` (+`renameRoom`).
- Frontend: `lib/api.ts` (+`renameRoom`), `app/page.tsx` (input opcional de nombre de sala), `app/rooms/page.tsx` + `page.module.css` (UI de edición inline), `features/translation/dictionary.ts` (claves nuevas en inglés).
- No se tocó el schema (la columna ya existía) ni la inmutabilidad de `isPermanent`.

### Verificación

Backend: `pnpm vitest run modules/rooms/rooms.controller.spec.ts modules/rooms/rooms.service.spec.ts` — 29/29. Frontend: `pnpm jest` en `client/` — 62 suites / 399 tests, todo verde. `tsc --noEmit` sin errores nuevos en los archivos tocados (los errores preexistentes en `page.spec.tsx` de `room/[code]` y en `calls-webhook.service.spec.ts` son de otro trabajo en esta misma rama, no de este cambio).


---

## 22. Roles globales vs roles por sala

**Fecha:** 2026-11-24
**Rama:** `feature/room-delete-and-global-roles`

### Contexto

Hasta ahora el único concepto de rol era el **rol por sala** (`room_members.role`: `administrador | colaborador | participante`), que solo gobierna lo que una persona puede hacer dentro de una sala concreta. No existía ningún permiso que dependiera de la cuenta en sí, por lo que no había forma de moderar la plataforma (listar cuentas, corregir roles, borrar una sala ajena). El proyecto necesita al menos dos roles **globales** con permisos distintos, donde el backend responda 403 cuando un rol intenta algo que no le corresponde.

### Alternativas consideradas

- **Reusar el rol de sala (`administrador`) como si fuera global.** Descartada: el rol de sala es relativo a una sala (la misma persona es administradora en una y participante en otra); tratarlo como global concedería permisos sobre toda la plataforma a cualquiera que haya creado una sala.
- **Rol global dentro del JWT.** Simple (sin consulta extra por request), pero un descenso de rol no tiene efecto hasta que el access token vence (15 min por defecto) y habría que invalidar refresh tokens.
- **Columna `users.role` leída de la base en cada request protegida (elegida).** Cuesta un `SELECT` por request a `/admin/*`, pero el cambio de rol es inmediato y el JWT no cambia de forma (`{ sub, email }`).
- **Tabla de permisos/roles (RBAC completo).** Sobredimensionada para dos roles.

### Decisión

- Nuevo enum de Postgres `user_role` (`user`, `admin`) y columna `users.role` `NOT NULL DEFAULT 'user'` (migración `0022_user_role`). Todas las cuentas existentes quedan como `user`.
- `RolesGuard` + decorador `@Roles('admin')` (módulo `JwtAuthModule`), **distintos** de `RoomRolesGuard`/`@RoomRoles`. Corre después de `JwtAuthGuard`: sin usuario en la request responde 401; con rol no permitido, 403. El rol se lee de la base en cada request, no del JWT.
- El rol viaja en el objeto público de usuario (`/auth/register`, `/auth/login`, `/auth/me`); nunca el hash de contraseña.
- Módulo `admin` (`AdminController` protegido a nivel de clase con `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`): `GET /admin/users`, `PATCH /admin/users/:id/role` y `DELETE /admin/rooms/:code` (moderación, reusa `RoomsService.deleteRoom`).
- Un admin **no puede quitarse a sí mismo** el rol (400), para no dejar la plataforma sin administradores por accidente.
- El primer admin se crea con `pnpm admin:promote <email>` (`scripts/promote-admin.mjs`), porque los endpoints `/admin/*` exigen ya ser admin.
- Frontend: `/admin` (lista de usuarios y selector de rol) detrás de `RequireAuth`; si la cuenta no es admin muestra "Sin acceso". El link "Admin" del riel solo aparece para admins. Esto es **cosmético**: la seguridad la impone el backend.

### Justificación

- Separar los dos ejes (qué puede hacer en una sala vs. en la plataforma) evita escaladas de privilegio accidentales.
- Leer el rol de la base hace que la revocación sea inmediata, que es la propiedad que más importa en un rol de moderación.
- Dejar el payload del JWT intacto evita tocar `JwtAuthGuard`, el guard de WebSockets y los pases de sala.

### Consecuencias

- Cada request a `/admin/*` hace una consulta adicional a `users` (aceptable: tráfico administrativo bajo).
- Un access token de una cuenta eliminada sigue siendo válido hasta que vence, pero `RolesGuard` responde 401 porque la cuenta ya no existe.
- Sumar un tercer rol global implica ampliar el enum con una migración y usar `@Roles(...)` en los endpoints nuevos.

---

## 23. Borrado de salas (cascade)

**Fecha:** 2026-11-24
**Rama:** `feature/room-delete-and-global-roles`

### Contexto

Las salas se podían crear, listar (`/rooms/mine`) y renombrar, pero no borrar. Se necesita `DELETE /rooms/:code` sin dejar filas huérfanas ni fallar por claves foráneas, y que un admin global pueda hacer el mismo borrado como moderación.

### Alternativas consideradas

- **Borrar a mano cada tabla dependiente dentro de una transacción.** Frágil: cada tabla nueva que referencie `rooms` exigiría acordarse de agregarla.
- **Soft delete (`retired_at`).** Ese campo ya significa "el código volvió al pool" (D2); reusarlo mezclaría dos conceptos y las filas privadas (mensajes, notas) seguirían en la base.
- **`ON DELETE CASCADE` en la base (elegida).** Ya estaba declarado así en todas las tablas que cuelgan de la sala, por lo que no hizo falta migración para esto.

### Decisión

- `DELETE /rooms/:code` (`JwtAuthGuard`; 204). El rol `administrador` **de esa sala** se valida en `RoomsService.deleteRoomAsAdmin`: 404 si el código no existe, 403 si la persona no es miembro o no es administradora. No se usa `RoomRolesGuard` porque ese guard resuelve la sala por "joinable" y devolvería 404 para las salas vencidas que `/rooms/mine` igual lista.
- Una sola sentencia `DELETE FROM rooms` dentro de `db.transaction`. Se borran por cascada: `room_members`, `messages`, `room_notes`, `room_admission_requests`, `room_schedule_slots`, `room_playlists`, `room_emojis`, `transcript_lines`, `call_history` y `call_participant_identities`.
- **Se conserva el historial de sesiones de llamada:** `call_sessions.room_id` es `ON DELETE SET NULL` (la sesión mantiene `room_code`, horarios y participantes agregados) y `call_events` no tiene FK por diseño (log append-only). Es una decisión deliberada del feature de línea de tiempo (D7); no se cambió.
- Llamada o chat en curso: `RoomsService` emite `roomDeleted` por `RoomEventsService` y `ChatGateway` lo reenvía a la sala y desconecta esos sockets (el estado en memoria se limpia con el `handleDisconnect` existente). La llamada de LiveKit no se cierra desde el borrado: termina cuando sus participantes salen, y nadie puede volver a entrar porque `POST /calls/:roomCode` ya responde 404.
- UI: botón "Eliminar sala" en "Mis salas" (todas las salas listadas son de las que la persona es administradora), con un `<dialog>` de confirmación en la página (sin `window.confirm`), estado de carga, mensaje de error y retiro de la fila al terminar.

### Justificación

- La integridad referencial queda en la base, no en código de aplicación que haya que mantener.
- Reusar un único método de borrado para el administrador de la sala y para la moderación evita que las dos rutas diverjan.

### Consecuencias

- El borrado es irreversible (sin papelera). La confirmación en la UI es la única barrera, de ahí el texto explícito del diálogo.
- Los clientes conectados reciben `roomDeleted` pero la pantalla de sala todavía no reacciona a ese evento más allá de perder la conexión; queda como mejora.
- Las sesiones de llamada de una sala borrada siguen apareciendo en la línea de tiempo de quienes participaron, con `roomName: null` (la consulta usa `leftJoin`). Las filas de `call_history` (listado "Historial") sí se borran junto con la sala.

---

## 24. Mini salas: separación `joinPolicy`/`leavePolicy`, señal explícita de motivo de remoción y mitigación de R1 (admin sola trasladándose)

**Fecha:** 2026-11-23
**Rama:** `feature/breakout-rooms`

### Contexto

Después de desplegar las mini salas, aparecieron tres problemas de UX/robustez distintos pero relacionados, todos resueltos en el mismo cambio porque el diseño de uno condicionaba al de los otros (ver `openspec/changes/breakout-rooms-ux-fix/`):

1. **R1 — riesgo de carrera cuando la única administradora conectada se traslada sola a una mini sala.** `moveIn` inserta la asignación nueva y recién después ejecuta `removeParticipant` sobre la identity vieja, lo que dispara `onAdminLeft` → `hasConnectedAdmin` evaluando presencia con la mini sala todavía vacía (la persona no llegó a reconectarse) → se agenda el cierre del grupo a T+15s. Si la reconexión (pedir token nuevo + `switchRoom`) tarda más de 15s — red lenta, cold start del endpoint de token — `claimAndClose` borra la principal y las mini salas sin que nadie haya hecho nada mal.
2. **Expulsión indistinguible.** El cliente recibía `PARTICIPANT_REMOVED` de LiveKit en tres situaciones muy distintas (traslado en curso, vuelta forzada por el admin, expulsión por política `locked`) y las trataba todas igual (`call.failed(...)`), mostrando un error genérico donde no correspondía.
3. **Auto-ingreso a mini salas.** No existía ninguna forma de que alguien se moviera a una mini sala por su cuenta: todo traslado requería que un admin lo ejecutara desde el panel.

### Decisión

- **R1**: en vez de ensanchar la ventana de gracia (retrasa *todo* cierre forzado legítimo) o introducir una supresión en memoria (no sobrevive un restart y crea un ciclo de dependencias entre servicios), `hasConnectedAdmin` ahora consulta `hasAdminAssignmentInFlight(roomId)` **solo** cuando la evaluación de presencia iba a devolver `false` y hay más de una sala en el grupo: un admin con una fila de `call_breakout_occupants` abierta y con `assigned_at` de menos de 30s cuenta como "en tránsito", sin necesitar ninguna columna ni tabla nueva (la fila ya existe, se escribe antes de `removeParticipant`). Cero costo en el camino feliz (llamadas sin mini salas) y cero costo cuando la presencia ya resuelve `true`.
- **Señal de motivo de remoción**: un evento de socket nuevo, `breakout:removal`, viaja **antes** de `removeParticipant` (mismo orden que `breakout:assigned`) con un código cerrado (`BREAKOUT_MOVE_IN` / `BREAKOUT_FORCED_RETURN` / `BREAKOUT_RETURN_LOCKED`) y nada de texto — la traducción vive del lado del cliente. `useRoomSocket.consumeRemovalNotice()` lo guarda en un `useRef` (no en estado) con lectura destructiva y ventana de frescura de 10s, porque `onDisconnected` dispara a milisegundos del evento y un `setState` puede no haber flusheado todavía — leer estado stale ahí clasificaría una expulsión legítima como fallo genérico.
- **`joinPolicy` separado de `leavePolicy`**: columna aditiva nueva (`admin_only` por default) en `call_breakout_rooms`, exclusivamente para gobernar quién puede **entrar** por iniciativa propia; `leavePolicy` sigue gobernando exclusivamente la vuelta a la principal. Son preguntas de producto independientes (una mini sala puede ser fácil de entrar y difícil de dejar, o viceversa) y mezclarlas en una sola columna haría imposible expresar esa combinación.
- **Frontend**: los dos *gates* que antes vivían por separado (`BreakoutPanel` solo-admin, `BreakoutBanner` solo-ocupante) se colapsan en un selector puro de 4 estados (`resolveBreakoutViewState`: `guest-idle` / `guest-occupant` / `host` / `host-occupant`) y un único punto de montaje (`BreakoutView`), estructuralmente incapaz de renderizar dos vistas de mini sala a la vez — el bug que motivó este cambio.

### Consecuencias

- La mitigación de R1 cubre ~30s desde `assigned_at`; una reconexión más lenta todavía no está protegida por este marcador (aunque sigue protegida por la convergencia de `room_finished` de LiveKit, no por un cierre forzado).
- `room_finished` de la sala principal **no** ejecuta la cascada de cierre de mini salas (divergencia respecto del diseño original de breakout-rooms) — eso es lo que protege hoy a la admin sola; fijado como contrato por un test de caracterización (R1-C5) para que un cambio futuro no lo rompa sin darse cuenta.
- `BREAKOUT_FORCED_RETURN` termina la sesión del cliente (no hay reingreso automático a la principal todavía); la persona vuelve a entrar con un clic desde la página de la sala.

### Verificación

Backend: `pnpm vitest run` — 549 tests, 535 pasan (las 14 fallas restantes son integración contra Postgres sin conexión local disponible, preexistentes a este cambio, mismo set antes/después confirmado con `git stash`). Frontend: `pnpm jest` en `client/` — 68 suites / 478 tests, todo verde. `tsc --noEmit` sin errores nuevos en ninguno de los dos paquetes (los únicos preexistentes son los ya documentados en `calls-webhook.service.spec.ts`, dos specs de integración de `rooms`, y el uso de `exact` en `page.spec.tsx` de `room/[code]`, ninguno tocado por este cambio).

---

## 25. Endurecimiento R7: filtro global de excepciones explícito y CORS sin fallback `*`

**Fecha:** 2026-11-25
**Rama:** `fix/r7-exception-filter-and-cors`

### Contexto

El requisito R7 del curso exige que los errores del backend nunca expongan trazas, consultas ni datos internos al cliente, y que CORS apunte al dominio propio del frontend, no a `*`. Antes de este cambio, el primer punto dependía solo del comportamiento por defecto de Nest y el segundo tenía un fallback silencioso: `process.env.CORS_ORIGIN ?? '*'` tanto en `app-setup.ts` como en el decorador de `ChatGateway`.

### Decisión

- **Filtro global explícito (`src/common/all-exceptions.filter.ts`).** Las `HttpException` (validación, 401, 403, 404, throttling) se devuelven con su status y body originales, así que el formato que ya consumen cliente y tests no cambia. Cualquier otro error se registra completo (mensaje, stack, método y URL) con el `Logger` de Nest y el cliente recibe siempre `{ statusCode: 500, message: 'Internal server error' }`. Se registra en `createApp()` para que lo ejerciten también los tests. Solo responde en contexto `http`; los filtros globales de `useGlobalFilters` no alcanzan a los gateways, así que el chat por Socket.IO y el webhook de LiveKit no cambian.
- **Errores 4xx de body-parser y `headersSent`.** Los errores que no son `HttpException` pero traen `status`/`statusCode` 4xx y `expose === true` (p. ej. 413 por body demasiado grande, 415) conservan su status; el body solo lleva la frase estándar (`http.STATUS_CODES`), nunca `err.message`, y se registran como `warn` sin stack. Un 5xx o un `expose` distinto de `true` sigue siendo el 500 genérico. Si `response.headersSent` ya es `true` (handlers con `@Res()`), el filtro no escribe nada: registra el error con método y URL y cierra la respuesta.
- **CORS con falla temprana (`src/common/cors-origin.ts`).** `getCorsOrigin()` lanza un error claro si `CORS_ORIGIN` falta, está vacío, es `*` o no es un origen simple (`new URL(v).origin === v`: sin barra final, path ni esquema faltante; formato esperado `https://app.example.com`). `createApp()` lo llama antes de crear la app, por lo que el servidor no arranca (falla en el boot, no en la primera request). Solo se admite un origen único, que es lo que usan hoy desarrollo, e2e y EC2.
- **CORS del gateway en runtime (`CorsIoAdapter`).** El decorador `@WebSocketGateway` se evalúa al importar el módulo, antes de que `ConfigModule` cargue el `.env`, de modo que leer `process.env` ahí era frágil. El origen se inyecta ahora desde un `IoAdapter` propio registrado en `createApp()`.

### Justificación

- Los errores de Drizzle/pg incluyen el SQL y los parámetros en `error.message`. Confiar en el default de Nest hoy los oculta, pero un filtro explícito con tests que lo prueban es evidencia defendible de R7 y no depende de un detalle de implementación del framework.
- Un fallback a `*` convierte un olvido de configuración en una apertura silenciosa de la API. Es preferible que el despliegue falle de forma visible.

### Consecuencias

- Todo entorno que arranque la app debe definir `CORS_ORIGIN`: `.env` local (ver `.env.example`), Playwright (`playwright.config.ts`) y EC2 (`deploy/ec2/configure.py`) ya lo hacen. Cualquier script o test nuevo que llame a `createApp()` debe definirlo también.
- Los errores 500 pierden el detalle en la respuesta; para diagnosticar hay que mirar los logs del servidor.

---

## 26. Resumen de llamadas con IA: Gemini API (nivel gratuito) llamada solo desde el backend

**Fecha:** 2026-11-25
**Rama:** `feature/ai-call-summary`

### Contexto

El curso pide una funcionalidad de producto que consuma un modelo de IA por API, siempre desde el backend, con la clave en variables de entorno, manejo de errores y límites de uso. La funcionalidad elegida es resumir la transcripción guardada de una llamada del historial.

El proveedor se eligió después de probar Amazon Bedrock el 2026-11-25 en la cuenta AWS del proyecto (plan FREE):

- Todos los modelos Claude respondieron `AccessDenied` ("not available for this account").
- Amazon Nova Lite fue limitado ya en la primera llamada con "Too many tokens per day".
- Los perfiles de inferencia entre Regiones no están permitidos por la cuenta.

### Decisión

- **Proveedor: Google Gemini API, nivel gratuito**, con el SDK oficial `@google/genai`. Modelo por defecto `gemini-3.5-flash-lite`, configurable con `GEMINI_MODEL`. Se verificó en la página de precios de la Gemini API que figura con costo cero en el nivel gratuito y que no está marcado como obsoleto (`gemini-2.5-flash` figura como obsoleto desde el 1 de diciembre de 2026).
- **Clave solo en el backend** (`GEMINI_API_KEY`). Nunca se envía al cliente ni se registra en logs. Si falta, la aplicación arranca igual y el endpoint responde 503 "AI summaries are not configured".
- **Un resumen por sesión.** Tabla `call_summaries` (migración `0031_call_summaries`) con la sesión como clave primaria y borrado en cascada con `call_sessions`. `POST` solo llama al modelo si no existe resumen; `GET` devuelve el guardado, aunque se haya pedido otro idioma después: la respuesta incluye `language` y el cliente avisa cuando difiere del idioma de la interfaz. Esto protege la cuota gratuita y evita pagar o gastar cuota dos veces por la misma llamada. Se eligió una tabla propia y no columnas en `call_sessions` para no ensanchar una tabla que escriben los webhooks de LiveKit y para poder guardar modelo, idioma y autor.
- **Autorización reutilizada.** Los endpoints `GET/POST /calls/sessions/:sessionId/summary` validan `sessionId` como UUID (`ParseUUIDPipe`, 400 si no lo es), usan `JwtAuthGuard` y la misma regla que el acta (`TranscriptHistoryService.requireSession`): solo quien participó de la sesión, con 404 tanto si no existe como si no participó.
- **Límite de tasa más estricto** en el `POST`: 5 por minuto (el global es 60), con `@Throttle` de `@nestjs/throttler`.
- **Prompt seguro.** La instrucción de sistema indica que la transcripción son datos y no instrucciones; la transcripción va entre delimitadores `<transcript>` y se neutraliza cualquier cierre inyectado. Si supera 100 000 caracteres se responde 413 en lugar de truncar en silencio. Sin frases, 422.
- **Errores controlados.** Cuota agotada del proveedor: 429 con `code: "AI_QUOTA"` (el límite propio de 5 por minuto también responde 429, pero sin ese código, y el cliente muestra un mensaje distinto). Red, error del proveedor o respuesta bloqueada o vacía: 503.
- **Solo se guardan generaciones completas.** Se lee `finishReason` del primer candidato: solo `STOP` es válido. `MAX_TOKENS` (o cualquier otro fin distinto de `STOP`) se trata como no disponible (503) y los motivos de seguridad, lista de bloqueo, contenido prohibido, recitación o datos personales sensibles como bloqueo; en ambos casos no se persiste nada. El límite de salida es de 2048 tokens (`MAX_OUTPUT_TOKENS`).
- **Línea única por entrada.** Al armar el prompt, los saltos de línea (CR, LF, NEL, U+2028, U+2029) del nombre y del texto se reemplazan por espacios, para que una frase no pueda falsificar líneas `[hh:mm:ss] Nombre:` de la transcripción.
- **Sesiones en curso.** No se agrega una regla 409: `requireSession` exige filas en `call_session_participants`, que se insertan en la misma transacción que fija `ended_at` (`calls-webhook.service.ts`), por lo que una llamada en curso responde 404 y nunca llega a generar. El cliente solo recibe mensajes genéricos; el detalle del SDK queda en los logs del servidor, sin la clave.
- **Proveedor detrás de una interfaz** (`AiTextGenerator`), de modo que cambiar de modelo o proveedor solo toca una clase.

### Alternativas descartadas

- **API de Anthropic (de pago):** buena calidad, pero exige tarjeta y costo recurrente para un proyecto de curso.
- **Plan de pago de AWS (Bedrock):** habilitaría Claude, pero implica salir del plan gratuito y asumir costos.
- **Amazon Nova Lite en Bedrock:** probado y limitado desde la primera llamada.

### Consecuencias y tradeoffs

- El nivel gratuito tiene límites de solicitudes y tokens por minuto y por día; por eso existen el resumen único por sesión y el límite de 5 por minuto. Una cuota agotada se muestra al usuario como un mensaje claro, sin romper la página.
- Google puede usar el contenido enviado en el nivel gratuito para mejorar sus productos. Es aceptable para datos de demostración, pero debe informarse: no se deben resumir llamadas con datos sensibles reales.
- Se suma un segundo proveedor y una segunda clave para administrar (`GEMINI_API_KEY`, y opcionalmente `GEMINI_MODEL`, en el entorno del backend y en EC2).
- La numeración de la migración (0031) puede colisionar con otras ramas aún sin integrar que usan el mismo número; hay que renumerar la que se integre segunda.

---

## 27. LiveKit autohospedado como proveedor vigente de audio y video (sustituye a Amazon Chime SDK)

**Fecha:** 2026-11-25
**Rama:** `chore/repo-hygiene`
**Estado:** vigente. Sustituye a las secciones 2, 5, 9 y 11, que se conservan solo como historia; la sección 12 describe la implementación inicial.

### Contexto

La sección 2 eligió Chime SDK por ser nativo de AWS. La sección 11 documentó después que el nuevo AWS experience excluye Chime SDK, incluso en el plan pago simplificado, y que el proyecto está en el plan FREE. Sin Chime no había llamadas de voz y video. Esta sección consolida el razonamiento de la decisión vigente para que no haya que reconstruirlo desde varias secciones.

### Alternativas consideradas

- **Amazon Chime SDK (decisión original).** Descartada: no está disponible para este tipo de cuenta, por lo que no se puede ni probar ni desplegar.
- **LiveKit Cloud.** Descartada para esta entrega: añade un servicio comercial externo y un plan que el proyecto no necesita. El servidor de código abierto cubre el caso (ver `deploy/ec2/README.md`, sección "Costos y créditos").
- **LiveKit autohospedado en la EC2 del proyecto (elegida).**
- No se evaluaron otras plataformas de video ni una malla WebRTC directa entre navegadores; no hay un análisis documentado de ellas y no se afirma nada al respecto.

### Decisión

LiveKit de código abierto (`livekit/livekit-server`, versión fijada en `deploy/ec2/compose.yaml`) corre junto con la API, el frontend y Caddy en la misma EC2 de `us-east-2`. El backend emite pases JWT de corta duración con `livekit-server-sdk`; el cliente usa `livekit-client` y los componentes oficiales de React. Cupo predeterminado: 6 participantes por llamada, aplicado por LiveKit al conectar.

### Justificación

- Funciona dentro del plan FREE: solo requiere EC2, un servicio admitido, sin activar funciones avanzadas.
- La licencia del servidor no tiene costo; el único gasto es la infraestructura de AWS, que se descuenta de los créditos elegibles.
- Un único stack de Docker Compose incluye todo, lo que simplifica el despliegue y las pruebas locales (LiveKit también se puede levantar con Docker).
- El SDK abierto permite mantener la identidad y los permisos en el backend: el pase no concede administración y las claves privadas no llegan al navegador.

### Consecuencias y tradeoffs

- Pasamos a operar el servidor de medios: actualizaciones, certificados (Caddy) y TURN son responsabilidad del equipo, no de un servicio administrado.
- Despliegue de un solo host, sin alta disponibilidad. El límite de seis participantes no es una certificación de rendimiento; requiere una prueba real desde varias redes.
- Hay que abrir puertos públicos de medios (TCP 7881; UDP 3478 y 7882) además de 80 y 443.
- Las llamadas activas se interrumpen cuando la EC2 se apaga automáticamente (dos horas después de cada arranque).
- La columna `rooms.chime_meeting_id` y la migración `0003_chime_meeting` se conservan para no reescribir historial de migraciones; LiveKit no las usa.

---

## 28. PostgreSQL como contenedor en la misma EC2, no como servicio administrado (RDS)

**Fecha:** 2026-11-25
**Rama:** `chore/repo-hygiene`

### Contexto

El proyecto necesita una base PostgreSQL alojada en la nube, no en la computadora de un integrante. La cuenta de AWS del proyecto usa el plan FREE del nuevo AWS experience, con una única región (`us-east-2`) y créditos limitados. Los servicios disponibles dependen de ese plan, y los administrados se cobran por separado de la EC2.

### Alternativas consideradas

- **Amazon RDS (u otro PostgreSQL administrado).** Ofrece copias automáticas, recuperación a un punto en el tiempo y parches gestionados. Agrega una instancia de base facturable además de la EC2 y no se verificó contra la lista oficial de servicios admitidos del plan FREE; la plantilla del proyecto declara explícitamente que no crea RDS (`deploy/ec2/README.md`, "Costos y créditos").
- **PostgreSQL en la computadora de un integrante.** Descartada: incumple el requisito de que la base esté en un servicio en la nube.
- **PostgreSQL 16 en un contenedor Docker en la misma EC2 (elegida).**

### Decisión

El servicio `postgres` (`postgres:16-alpine`) está definido en `deploy/ec2/compose.yaml` junto al resto del stack. Escucha solo en `127.0.0.1` (`listen_addresses=127.0.0.1`) y el puerto 5432 no se abre en el Security Group. Los datos viven en el volumen Docker `postgres_data`, dentro del disco raíz de la instancia: gp3 de 30 GiB con cifrado activado y `DeleteOnTermination: false` (`deploy/ec2/cloudformation.json`). Las migraciones se aplican en `deploy/ec2/start.sh` antes de iniciar la API.

Esto cumple el requisito de que la base esté alojada en un servicio en la nube y no en la computadora de un integrante: corre en una instancia EC2 de AWS.

### Justificación

- Costo: no se agrega ningún recurso facturable aparte de la EC2, el disco y la IPv4 que ya existen.
- Simplicidad: un solo `docker compose` levanta aplicación, medios, proxy y base, y una sola plantilla de CloudFormation describe todo.
- Encaja con el alcance de una demostración académica con una llamada a la vez.

### Consecuencias y tradeoffs

- **Sin copias automáticas ni recuperación a un punto en el tiempo.** La única copia prevista es manual con `pg_dump` (`deploy/ec2/README.md`, "Copias, actualización y retiro"), y queda en el mismo disco; hay que copiarla fuera de la instancia si se quiere protección ante la pérdida del host.
- **La base comparte CPU y RAM con la aplicación y LiveKit.** La plantilla admite `t3.small` (2 GiB) y `t3.medium` (4 GiB, valor por defecto); en `t3.small` la construcción de imágenes puede agotar la memoria, por eso el arranque crea 2 GiB de swap.
- **La base se apaga con la instancia.** Un temporizador de systemd apaga la EC2 dos horas después de cada arranque; hasta volver a iniciarla desde la consola, la aplicación y la base no responden. Los datos persisten porque el disco y el volumen se conservan.
- **Parches manuales.** La versión de imagen está fijada; actualizar PostgreSQL o el sistema operativo es una tarea del equipo.
- **Un solo host, sin réplica ni alta disponibilidad.** Aceptable para la demostración; no para producción real.
- Si el proyecto continuara más allá de la entrega, migrar a RDS (o equivalente) sería el primer cambio recomendado: bastaría cambiar `DATABASE_URL` y restaurar un volcado.

---

## 29. IP real del cliente detrás de Caddy (PROXY protocol y `trust proxy`)

**Fecha:** 2026-11-24
**Rama:** `fix/trust-proxy`

### Contexto

El límite global de 60 peticiones por minuto (`ThrottlerModule`) cuenta por `req.ip`. En el despliegue, la capa 4 de Caddy recibe la conexión en `:443` y la reenvía por TCP a su servidor HTTP en `127.0.0.1:8080`, que a su vez la pasa al backend. Ese reenvío no conservaba la dirección del cliente: el servidor HTTP de Caddy veía a todos como `127.0.0.1`, completaba `X-Forwarded-For` con ese valor, y el backend tampoco confiaba en ese encabezado. Resultado: todas las personas compartían un único cupo de 60 peticiones.

Un primer intento solo activó `trust proxy` en el backend. La revisión del cambio detectó que no alcanzaba, porque el encabezado ya llegaba con la IP equivocada; las pruebas unitarias pasaban porque no reproducían la cadena de Caddy.

### Alternativas consideradas

- **Solo `trust proxy` en el backend.** Insuficiente por lo explicado arriba.
- **`trust proxy: true`.** Permitiría que cualquier cliente falsee su IP con `X-Forwarded-For`.
- **Subir o quitar el límite.** Esconde el problema y deja la API sin límite por cliente.
- **PROXY protocol entre la capa 4 y la capa HTTP de Caddy, más `trust proxy: 'loopback'` (elegida).**

### Decisión

- `deploy/ec2/configure.py`: la ruta de la aplicación en la capa 4 envía un encabezado PROXY v2 (`proxy_protocol: 'v2'`), y el servidor HTTP lo lee con el listener `proxy_protocol`, aceptado solo desde `127.0.0.1/32`. Las rutas de TURN y de LiveKit no cambian.
- `src/app-setup.ts`: `app.set('trust proxy', 'loopback')`, de modo que el backend toma la IP del `X-Forwarded-For` que agrega Caddy.

### Justificación

- Se verificó con la imagen fijada en `compose.yaml` (Caddy v2.11.3): `caddy validate` acepta el `caddy.json` generado, y una réplica de la cadena mostró que sin PROXY protocol el backend recibe `127.0.0.1` y con PROXY protocol recibe la IP del cliente, ignorando un `X-Forwarded-For` falso enviado por el cliente.

### Consecuencias

- Para aplicarlo en el EC2 hay que volver a ejecutar `configure.py` (conserva las claves existentes) y reiniciar Caddy. Si la configuración fallara, el sitio entero deja de responder: se debe aplicar con la posibilidad de volver al `caddy.json` anterior.
- Pendiente de comprobar en producción: que dos dispositivos distintos tengan cupos separados.
