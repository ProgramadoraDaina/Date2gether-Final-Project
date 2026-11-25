# Uso de IA en el proyecto

Este documento describe, con evidencia del repositorio, cómo se usó inteligencia artificial durante el desarrollo de Date2gether y qué funcionalidad de IA tiene el producto.

## Herramientas utilizadas

| Herramienta | Uso | Evidencia en el repositorio |
| --- | --- | --- |
| **Claude Code** (Anthropic), agente de línea de comandos | Exploración del código, implementación de cambios, depuración, documentación y pruebas | `AGENTS.md` (instrucciones para el agente), `openspec/` (artefactos del flujo SDD), `.atl/skill-registry.md` (registro de habilidades del agente) |
| **OpenAI Codex** | Generación de código para el rediseño de la sala de espera | Rama `codex/waiting-room-redesign` (PR #41, commit `b92507a`), creada por Alex Sanchez |

El equipo repartía las tareas en un tablero de Trello y cada integrante creaba la rama de la tarea que tenía asignada; por eso el autor de cada rama indica quién hizo esa parte. Con ese criterio, Codex se usó en el rediseño de la sala de espera y el resto del trabajo asistido por IA se hizo con Claude Code.

Cómo se organizó el trabajo con el agente:

- **Desarrollo guiado por especificaciones (SDD).** Los cambios grandes se descomponen en fases con artefactos escritos: exploración, propuesta, especificaciones, diseño, tareas, implementación y verificación. Quedan dos cambios en `openspec/changes/`: `call-participation-timeline` y `permanent-scheduled-rooms`. El archivo `state.yaml` de cada cambio registra qué fases se completaron y qué tareas se implementaron.
- **Pruebas primero.** `openspec/config.yaml` activa `strict_tdd: true` y define los comandos de prueba que el agente debe ejecutar.
- **Una persona dirige y revisa.** El agente propone e implementa; las decisiones de diseño y el código resultante se revisan antes de integrarse, y las decisiones importantes se registran en [decisiones-tecnicas.md](decisiones-tecnicas.md).

**Revisión entre integrantes.** Los cambios entraron a `develop` por pull requests. Según GitHub, de los 37 pull requests integrados, 20 los integró un integrante distinto del autor (Daina integró 9 de otros, Alex 7 y Jonatan 4) y 17 los integró su propio autor (15 de Daina y 2 de Jonatan). La revisión cruzada fue la práctica habitual, aunque no se aplicó en todos los casos. No se midió qué proporción del código fue generada o asistida por IA.

## Metodologías de trabajo con IA

El equipo combinó varias metodologías según el momento:

- **SDD (Spec-Driven Development).** Para cambios grandes se escribió primero la especificación y se avanzó por fases: propuesta, especificaciones, diseño, tareas, implementación y verificación. Evidencia: `openspec/changes/call-participation-timeline/` (`proposal.md`, `specs/`, `design.md`, `tasks.md`, `state.yaml`) y `openspec/changes/permanent-scheduled-rooms/` (con `verify-report.md`).
- **TDD (pruebas primero).** `openspec/config.yaml` define `strict_tdd: true`, y `state.yaml` registra ciclos rojo-verde (por ejemplo `src/app-setup.spec.ts`). Evidencia en pruebas: `src/modules/auth/guards/roles.guard.spec.ts`, `src/modules/auth/guards/ws-jwt-auth.guard.spec.ts`, `src/modules/rooms/guards/room-roles.guard.spec.ts`, `src/modules/auth/auth.service.spec.ts` y recorridos E2E como `e2e/auth.spec.ts` y `e2e/admin-and-room-delete.spec.ts`.
- **ODD (Outcome-Driven Development).** El trabajo se define por el resultado medible que obtiene la persona usuaria, y no por una lista fija de funcionalidades o especificaciones; sirve para priorizar qué construir y para validar que lo construido entregó valor. Según el equipo, Jonatan Luque aplicó ODD en la personalización de avatar, las transiciones y animaciones de la interfaz, los subtítulos en vivo (transcripción) y los emojis y sonidos de sala (junto con funcionalidades similares de interacción). El repositorio contiene código de estas áreas (avatar, subtítulos, emojis y sonidos de sala y hojas de estilo con transiciones y animaciones), pero no deja evidencia escrita de la metodología ni se definieron métricas de resultado.

## Tareas en las que la usamos

**Generación de código**

- Implementación por lotes de tareas definidas en `openspec/changes/*/tasks.md`. Ejemplo documentado: la ingesta de webhooks de LiveKit, la línea de tiempo de participación y el cierre forzado de la llamada cuando sale el último administrador (`openspec/changes/call-participation-timeline/`).
- Funcionalidades de la aplicación como la agenda de salas permanentes (`openspec/changes/permanent-scheduled-rooms/`).

**Depuración** (problemas reales documentados en el repositorio, diagnosticados con Claude Code en las ramas de Daina: `feature/call-participation-timeline` y las de despliegue)

- Diagnóstico de fallas que las pruebas automáticas no detectaban: el rechazo de todos los webhooks de LiveKit, el identificador de evento de LiveKit que no es un UUID y los eventos de WebSocket que fallaban por el límite de peticiones global (decisión 18 en [decisiones-tecnicas.md](decisiones-tecnicas.md)).
- Fallas del primer despliegue en EC2 (decisión 14): ruta del binario compilado, verificación de integridad que no verificaba nada y plugin `buildx` ausente.
- Agotamiento de memoria al construir las imágenes Docker en una instancia pequeña (se añadió swap, `deploy/ec2/cloudformation.json`).

**Documentación, pruebas y diseño**

- Redacción de las decisiones técnicas, la guía de despliegue en EC2 y los artefactos de diseño de `openspec/`.
- Pruebas unitarias y de componentes colocadas junto al código (`*.spec.ts`, `*.spec.tsx`) y pruebas E2E con Playwright (`e2e/`).
- Esta documentación final (README, arquitectura, justificación y este documento) se redactó con Claude Code a partir del contenido del repositorio. El agente dejó marcados los datos que no podía verificar, y el equipo los completó y revisó.

## Un caso en que la IA ayudó bien

**Anticipar el problema del cuerpo crudo en los webhooks de LiveKit.**

Para verificar la firma de un webhook, `WebhookReceiver.receive()` necesita el cuerpo exacto como texto, no un objeto ya interpretado. La fase de exploración documentó esa restricción antes de escribir código (`openspec/changes/call-participation-timeline/explore.md`, línea 18). La fase de diseño agregó un detalle que suele pasar inadvertido: LiveKit envía el webhook con `Content-Type: application/webhook+json`, y el analizador JSON de Express solo procesa `application/json`, por lo que habilitar el cuerpo crudo no alcanzaba (`design.md`, decisión D6, líneas 118 a 127).

Resultado verificable en el código: `src/app-setup.ts` declara `LIVEKIT_WEBHOOK_CONTENT_TYPE` (línea 10) y lo registra junto con `application/json` en `useBodyParser` (línea 33), con una prueba que primero falla y luego pasa (`src/app-setup.spec.ts`; el detalle del ciclo rojo-verde está en `state.yaml`, tareas 2.1 a 2.4). Con ese trabajo previo la verificación de firma no se rompió por una causa invisible.

## Un caso en que hubo que corregirla

**El nombre del encabezado de autenticación del webhook de LiveKit.**

Los artefactos de especificación asumían que el webhook se autenticaba con un encabezado llamado `Authorize`: lo afirman la exploración (`openspec/changes/call-participation-timeline/explore.md`, líneas 5 y 19) y el diseño (`design.md`, línea 287). Ese nombre proviene de una constante de `livekit-server-sdk` (`authorizeHeader = "Authorize"`), pero el servidor de LiveKit envía el encabezado HTTP estándar `Authorization`. Al leer un encabezado inexistente, el controlador rechazaba el 100 % de los webhooks, incluso los correctamente firmados. No se detectó con las pruebas unitarias; según el comentario del propio controlador, se confirmó por captura de paquetes contra un despliegue real.

Corrección: commit `df84caa` (`fix(calls): read the real Authorization header, not livekit-server-sdk's misnamed constant`). El controlador deja constancia del error en `src/modules/calls/calls-webhook.controller.ts`, líneas 51 a 58, y lee `req.headers.authorization` (línea 58). Un hallazgo del mismo tipo es el commit `3465d59`: el identificador de evento de LiveKit tiene su propio formato y no es un UUID, por lo que `call_events.id` pasó a `varchar` (`src/db/schema.ts`, línea 415).

**Lección:** una especificación escrita con ayuda de IA parecía coherente y estaba equivocada en un detalle que solo se confirma contra el sistema real. Las suposiciones sobre servicios externos se verifican con una prueba de integración o un despliegue, no solo con pruebas unitarias que repiten esa suposición. Lo mismo ocurrió con la decisión 18: las pruebas del gateway llamaban a los métodos directamente y se saltaban el pipeline de guards, por lo que el error solo apareció al probar a mano.

Autoría: los artefactos de `openspec/changes/call-participation-timeline/` los generó Claude Code en las fases de exploración y diseño del flujo SDD, dirigido y revisado por Daina, autora de la rama (PR #22). El error salió de ese texto generado, y no lo detectó la revisión humana ni las pruebas unitarias; se descubrió recién contra el despliegue real.

## Funcionalidad de IA en el producto

**Actualmente el producto no llama a ningún modelo de IA desde el backend.**

- **Subtítulos y transcripción:** usan la **Web Speech API del navegador** (`client/src/features/calls/transcription/useSpeechRecognition.ts`). Funciona solo en Chrome y Edge; en Chrome el audio pasa por los servidores de Google. Cada persona transcribe únicamente su propio micrófono, el texto viaja por el data channel de LiveKit y las frases finales se guardan en la tabla `transcript_lines`. Es una función del navegador, no un componente de IA propio del sistema.
- **Traducción ES/EN:** la interfaz usa un diccionario estático (`client/src/features/translation/`); no hay traducción automática de mensajes ni de subtítulos con IA.
- **Integraciones externas** (Giphy, Freesound, YouTube): son servicios de búsqueda de contenido, no de IA.

Posibles evoluciones, no implementadas: resumen automático del acta de una llamada y transcripción en el servidor con un modelo propio, para no depender del navegador.
