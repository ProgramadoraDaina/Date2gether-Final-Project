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

## 7. Las salas dejan de ser anónimas: se requiere cuenta para crear/unirse, pero el nombre de display sigue siendo editable

**Fecha:** 2026-10-25
**Rama:** `feature/voice-video-call`

### Contexto

Al diagnosticar por qué "Llamar" devolvía 401 se encontró que `CallsController` ya exigía un JWT de cuenta (`JwtAuthGuard`), pero `RoomsController` y `ChatGateway` no exigían nada: cualquiera entraba a una sala con solo un `userName` de texto libre, sin pasar por `/auth/login`. Dos features del mismo producto asumían modelos de usuario distintos. Había que decidir si las salas pasaban a requerir cuenta (como Meet/Zoom) o si `CallsController` bajaba su exigencia a algo compatible con el modelo anónimo.

### Alternativas consideradas

- **Mantener salas anónimas** y relajar `CallsController` para que confíe solo en el código de sala + un `userName` de texto libre, sin cuenta.
- **Requerir cuenta para crear/unirse a una sala**, manteniendo `JwtAuthGuard` en `CallsController` tal como estaba.

Dentro de la segunda opción, surgió una sub-decisión: si la identidad pasa a ser la cuenta (email + contraseña + id), ¿el nombre que ven los demás en la sala y en el chat debería ser siempre el nombre registrado de la cuenta, o seguir siendo editable por sesión?

### Decisión

Se eligió **requerir cuenta** para crear o unirse a una sala. Las salas anónimas quedan descartadas por el momento.

El nombre de display, sin embargo, **sigue siendo independiente de la cuenta y editable en cualquier momento**, replicando el comportamiento de Google Meet y Zoom: ahí el email/contraseña (y el id interno) solo sirven para diferenciar cuentas; nadie inicia sesión "con su id", y el nombre que ven los demás participantes se puede cambiar antes de entrar a cualquier llamada. El JWT prueba que el socket pertenece a una cuenta logueada; no determina qué nombre se muestra.

### Justificación

- Consistente con el patrón de producto que ya usan Meet/Zoom, que es la referencia explícita del proyecto.
- Evita duplicar la noción de "identidad para autorizar" (cuenta) con la de "identidad para mostrar" (nombre); cada una resuelve un problema distinto y no hay razón para acoplarlas.
- No requiere tocar el payload del JWT (`AccessTokenPayload: { sub, email }`) ni agregar una consulta a la base de datos en `ChatGateway` solo para resolver un nombre — el gateway solo necesita confirmar que el socket es de una cuenta válida.

### Implementación

- **Backend:** nuevo `WsJwtAuthGuard` (`src/modules/auth/guards/ws-jwt-auth.guard.ts`), exportado desde `JwtAuthModule` junto al `JwtAuthGuard` HTTP existente. Verifica el JWT del handshake del socket (`client.handshake.auth.token`) contra `JWT_ACCESS_SECRET`, igual que el guard HTTP pero extrayendo el token de otro lugar. `RoomsController` (`create` y `findOne`) y `ChatGateway.handleJoinRoom` quedan detrás de sus respectivos guards; `RoomsModule` y `ChatModule` importan `JwtAuthModule`.
- **Frontend:** `client/src/lib/socket.ts` manda el access token en `io(url, { auth: { token } })`. `client/src/lib/api.ts` (`createRoom`) también manda el header `Authorization` — se detectó en rojo (401 real en el navegador) que faltaba actualizarlo al guardar `RoomsController.create`, quedó corregido con test (`api.spec.ts`). `client/src/app/page.tsx` redirige a `/login` si se intenta crear o unirse a una sala sin `user` autenticado. `client/src/app/room/[code]/page.tsx` redirige a `/login` antes de conectar el socket si `isLoggedIn()` es `false`. El campo "Tu nombre" del home no se tocó: sigue editable, precargado con el nombre de cuenta pero no forzado a coincidir con él.

### Consecuencias

- Un JWT expirado (vida corta, 15 min) a mitad de una sesión en una sala hará que el próximo intento de `joinRoom` sea rechazado por `WsJwtAuthGuard`; hoy esto no refresca el token automáticamente en el socket ni se distingue de otros errores en el cliente (cae en el mismo listener `socket.on('error', ...)` que ya existía para sala inexistente). Queda pendiente como mejora futura, no se implementó en este cambio.
- `GET /rooms/:code` también quedó detrás de `JwtAuthGuard`: ya no se puede consultar si un código de sala existe sin estar logueado.

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
