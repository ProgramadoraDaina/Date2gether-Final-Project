# Uso de IA en el proyecto

Este documento describe, con evidencia del repositorio, cómo se usó inteligencia artificial durante el desarrollo de Date2gether y qué funcionalidad de IA tiene el producto.

## Herramientas utilizadas

| Herramienta | Uso | Evidencia en el repositorio |
| --- | --- | --- |
| **Claude Code** (Anthropic), agente de línea de comandos | Exploración del código, implementación de cambios, depuración, documentación y pruebas | `AGENTS.md` (instrucciones para el agente), `openspec/` (artefactos del flujo SDD), `.atl/skill-registry.md` (registro de habilidades del agente) |
| **OpenAI Codex** | Generación de código para el rediseño de la sala de espera y del botón de cerrar sesión | Ramas `codex/waiting-room-redesign` (PR #41, commit `b92507a`) y `codex/fix-logout-button` (PR #51), creadas por Alex Sanchez |
| **gentle-ai** sobre Claude Code | Arnés que agrega al agente un flujo de trabajo (ODD), memoria persistente entre sesiones (Engram), un índice del código (CodeGraph) y subagentes para explorar o verificar | Ramas de Jonatan Luque; los documentos de cada funcionalidad se guardaban en `odd/tasks/`, excluido de git |
| **Playwright** manejado por el agente | Pruebas en un navegador real con dos cuentas, cámara y micrófono simulados, contra LiveKit local | Guiones fuera del repositorio; los hallazgos quedaron en los PR #52 y #56 |

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
- **ODD (Organic Driven Development).** Es el flujo que trae el arnés gentle-ai y que usó Jonatan Luque. En vez de fijar todas las fases de antemano como en SDD, el agente sigue siempre los mismos pasos y ajusta su profundidad al tamaño del pedido: (1) confirmar que el pedido autoriza cambiar código, (2) explorar el código existente, (3) preguntar solo lo que es una decisión de producto, (4) clasificar la tarea como chica o grande, (5) en las grandes, escribir antes de tocar código un documento con los requisitos citados textualmente, las tareas y una bitácora, (6) implementar tarea por tarea con prueba primero (rojo y después verde) y (7) cerrar informando qué se verificó, qué quedó pendiente y el riesgo del cambio. Las tareas chicas se hacen directo, sin documento. Hay documentos de tareas de ODD para los avatares, los subtítulos en vivo, los emojis y sonidos de sala, las correcciones generales (PR #27), las mini salas y sus transiciones, el rediseño visual y los ajustes posteriores; las tareas chicas (como los arreglos de los PR #54 a #57) se hicieron directo. Esos documentos quedaron fuera del repositorio porque eran notas de trabajo del agente.

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

**Otro caso (Jonatan Luque): la causa real de "No se pudo crear la mini sala".**

Después de usar y cerrar mini salas, crear una nueva fallaba siempre, aunque no hubiera ninguna abierta. El agente siguió el error hasta la base: `call_breakout_rooms` tenía una restricción única **global** sobre `livekit_room_name`, y los nombres se arman como `<código de sala>::breakout-N` con N de 1 a 3. Las filas cerradas conservan su nombre, así que reutilizar un número ya usado en esa sala chocaba contra la restricción y la creación fallaba. La corrección fue un índice único **parcial**, que solo aplica a las mini salas abiertas (`WHERE closed_at IS NULL`, migración `drizzle/0033_breakout_open_name_unique.sql`), más ordenar por fecha las búsquedas por nombre para que tomen la fila vigente. Se probó contra la base de pruebas y en el navegador: tres creadas, la cuarta rechazada con 409, se cierra una y se puede crear otra, y una segunda ronda completa funciona (commit `08d4c29`, PR #56).

## Un caso en que hubo que corregirla

**El nombre del encabezado de autenticación del webhook de LiveKit.**

Los artefactos de especificación asumían que el webhook se autenticaba con un encabezado llamado `Authorize`: lo afirman la exploración (`openspec/changes/call-participation-timeline/explore.md`, líneas 5 y 19) y el diseño (`design.md`, línea 287). Ese nombre proviene de una constante de `livekit-server-sdk` (`authorizeHeader = "Authorize"`), pero el servidor de LiveKit envía el encabezado HTTP estándar `Authorization`. Al leer un encabezado inexistente, el controlador rechazaba el 100 % de los webhooks, incluso los correctamente firmados. No se detectó con las pruebas unitarias; según el comentario del propio controlador, se confirmó por captura de paquetes contra un despliegue real.

Corrección: commit `df84caa` (`fix(calls): read the real Authorization header, not livekit-server-sdk's misnamed constant`). El controlador deja constancia del error en `src/modules/calls/calls-webhook.controller.ts`, líneas 51 a 58, y lee `req.headers.authorization` (línea 58). Un hallazgo del mismo tipo es el commit `3465d59`: el identificador de evento de LiveKit tiene su propio formato y no es un UUID, por lo que `call_events.id` pasó a `varchar` (`src/db/schema.ts`, línea 415).

**Lección:** una especificación escrita con ayuda de IA parecía coherente y estaba equivocada en un detalle que solo se confirma contra el sistema real. Las suposiciones sobre servicios externos se verifican con una prueba de integración o un despliegue, no solo con pruebas unitarias que repiten esa suposición. Lo mismo ocurrió con la decisión 18: las pruebas del gateway llamaban a los métodos directamente y se saltaban el pipeline de guards, por lo que el error solo apareció al probar a mano.

Autoría: los artefactos de `openspec/changes/call-participation-timeline/` los generó Claude Code en las fases de exploración y diseño del flujo SDD, dirigido y revisado por Daina, autora de la rama (PR #22). El error salió de ese texto generado, y no lo detectó la revisión humana ni las pruebas unitarias; se descubrió recién contra el despliegue real.

**Otro caso (Jonatan Luque): un arreglo que pasaba las pruebas y no funcionaba.**

Al entrar a una mini sala se perdía el estado del micrófono y la cámara. El agente propuso guardar ese estado dentro del componente de la llamada (`MeetingRoom`) y escribió una prueba que lo confirmaba; la prueba pasaba. Al probarlo en un navegador real con Playwright, el micrófono seguía volviendo a encenderse. Con registros temporales se vio la causa: al cambiar de sala se desmonta y se vuelve a montar **todo** `MeetingRoom`, así que el estado guardado ahí se perdía; la prueba solo volvía a renderizar el componente y nunca lo desmontaba. La corrección movió el estado a la página de la sala, que sobrevive al cambio (`devicesRef` en `client/src/app/room/[code]/page.tsx`), y la prueba pasó a desmontar y montar de nuevo para reproducir el caso real (commit `365296a`, PR #56).

**Lección:** una prueba escrita por la misma IA que escribió el arreglo puede repetir su misma suposición. Lo que la desmintió fue probar el recorrido real en el navegador.

## Funcionalidad de IA en el producto

El producto tiene una función de IA: el **resumen de una llamada**. El resto de las funciones de texto y voz no usan modelos propios.

**Modelo y servicio.** API de Gemini de Google, con el modelo `gemini-3.5-flash-lite` por defecto (se puede cambiar con `GEMINI_MODEL`) y el nivel gratuito con clave de API. Código en `src/modules/ai-summary/`; la interfaz `AiTextGenerator` aísla al proveedor, de modo que cambiarlo solo afecta a `gemini-text-generator.ts`.

**Qué hace.** Quien participó en una sesión puede pulsar **Resumir con IA** en su transcripción. El backend lee las frases guardadas en `transcript_lines`, arma un prompt (resumen breve, puntos clave, decisiones y tareas; texto plano, en español o inglés) y guarda el resultado en `call_summaries`. Hay **un solo resumen por sesión**: las siguientes peticiones devuelven el guardado, lo que protege la cuota. Endpoints: `GET` y `POST /calls/sessions/:sessionId/summary` (ver [arquitectura.md](arquitectura.md)).

**Quién puede usarla.** Solo cuentas que participaron en esa sesión; si no, la respuesta es 404, igual que con la transcripción.

**Cómo se protege la clave.** `GEMINI_API_KEY` existe solo en el entorno del backend: en EC2 se agrega una vez a `deploy/ec2/runtime/runtime.env` (ignorado por git; procedimiento en `deploy/ec2/README.md`) y `configure.py` no la imprime. El navegador nunca la ve; los errores del SDK no se devuelven al cliente y en los registros solo queda un motivo.

**Entrada no confiable.** La transcripción es texto de usuarios. Va entre etiquetas `<transcript>`, las instrucciones indican que es dato y no órdenes, las etiquetas de cierre inyectadas se neutralizan y los saltos de línea de nombres y frases se aplanan para que nadie pueda fabricar líneas de otra persona.

**Errores, costos y límites.**

| Situación | Respuesta |
| --- | --- |
| Sin `GEMINI_API_KEY` o servicio de Gemini caído | 503 (la aplicación sigue funcionando) |
| Llamada sin transcripción | 422 |
| Transcripción de más de 100 000 caracteres | 413 (se rechaza en vez de truncar, para no resumir solo una parte) |
| Cuota del proveedor agotada | 429 con `code: AI_QUOTA` |
| Más de 5 generaciones por minuto | 429 del limitador propio (sin ese código) |
| Respuesta bloqueada por políticas del modelo o cortada por longitud | 503; nunca se guarda un resumen incompleto |

Cada petición al modelo tiene un tiempo máximo de 30 s y las generaciones simultáneas de la misma sesión se unifican en una sola llamada. El costo es cero mientras se use el nivel gratuito. Para este modelo, ese nivel permite 15 peticiones por minuto, 250 000 tokens por minuto y 500 peticiones por día (según el panel de uso de Google AI Studio). El backend limita a 5 generaciones por minuto, por debajo de ese tope, y como cada sesión se resume una sola vez, cada resumen consume una única petición diaria.

**Limitaciones.** El texto de la transcripción sale de AWS hacia Google. La calidad del resumen depende de la transcripción de la Web Speech API del navegador. Hay dependencia de un proveedor externo y de su nivel gratuito.

**Alternativa descartada: Amazon Bedrock.** Se probó antes de elegir Gemini. En la cuenta del plan FREE todos los modelos Claude devolvieron `AccessDeniedException` aunque figuraban como ACTIVE; Haiku 4.5 y Nova 2 Lite solo aceptan perfiles de inferencia entre regiones, que la restricción de una sola región del proyecto prohíbe; y `amazon.nova-lite-v1:0` se limitó en la primera llamada ("Too many tokens per day"). Es otro caso de una suposición sobre un servicio externo (que un modelo listado como activo es utilizable) que solo se desmintió llamándolo de verdad.

**Lo que no usa un modelo propio.**

- **Subtítulos y transcripción:** usan la **Web Speech API del navegador** (`client/src/features/calls/transcription/useSpeechRecognition.ts`). Funciona solo en Chrome y Edge; en Chrome el audio pasa por los servidores de Google. Cada persona transcribe únicamente su propio micrófono, el texto viaja por el data channel de LiveKit y las frases finales se guardan en la tabla `transcript_lines`. Es una función del navegador, no un modelo del backend.
- **Traducción ES/EN:** la interfaz usa un diccionario estático (`client/src/features/translation/`); no hay traducción automática de mensajes ni de subtítulos con IA.
- **Integraciones externas** (Giphy, Freesound, YouTube): son servicios de búsqueda de contenido, no de IA.

Posible evolución, no implementada: transcripción en el servidor con un modelo propio, para no depender del navegador.
