# Date2gether — definición del proyecto

Última actualización: 27 de octubre de 2026.

Este documento es la referencia para desarrollar Date2gether: describe qué tiene que hacer el producto terminado, cómo deben comportarse sus funciones y qué decisiones siguen abiertas. El trabajo puede dividirse en entregas, pero eso no reduce el objetivo final.

Las reglas de negocio de este documento prevalecen sobre descripciones anteriores de los README. Los README siguen siendo la guía de instalación y ejecución. Si se cambia una decisión de producto, se actualiza primero esta referencia para que código, pruebas y documentación sigan el mismo criterio.

## Qué queremos construir

Date2gether será una aplicación de reuniones grupales desde el navegador. Las personas podrán verse, escucharse, compartir pantalla y conversar por un chat que admita texto, imágenes, GIFs y stickers. También tendrán grabación local con autorización del anfitrión, subtítulos en español e inglés y fondos con desenfoque o imágenes propias.

La experiencia debe permitir reconocer fácilmente quién participa y quién está hablando. Crear una reunión requiere una cuenta registrada y una sesión válida; quienes reciben una invitación pueden participar con su cuenta o como invitados, según las reglas de acceso de la sala.

Las reuniones grupales forman parte del producto desde su primera versión utilizable. Cada sala admite un máximo de **6 personas en total, incluido el anfitrión**. La cantidad de reuniones simultáneas sigue pendiente y se definirá según la infraestructura y las pruebas de capacidad.

## Cuentas y permisos

El sistema debe permitir registrarse con nombre, correo y contraseña, iniciar sesión, mantenerla cuando se recarga la página y cerrarla. Los datos inválidos, las cuentas duplicadas y las credenciales incorrectas deben tener respuestas claras. Si una sesión vence y no puede renovarse, se vuelve a solicitar el ingreso.

Una cuenta identifica a una persona registrada. Una participación identifica su presencia en una reunión. El nombre visible y la conexión temporal del navegador no reemplazan ninguna de esas identidades.

| Rol                | Qué puede hacer                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Usuario registrado | Crear reuniones con una sesión válida y participar en reuniones a las que tenga acceso.                                                                      |
| Anfitrión          | Administrar su reunión, gestionar el acceso, borrar mensajes, aprobar grabaciones de otros participantes, grabar directamente y finalizar para todos.        |
| Invitado           | Participar, usar sus medios y el chat, borrar sus mensajes, solicitar permiso para grabar y salir. No puede crear reuniones ni asumir permisos de anfitrión. |

### Ninguna sala se crea sin anfitrión registrado

Esta regla es obligatoria y se aplica en el servidor. Para crear una reunión tiene que existir una cuenta registrada, una sesión autenticada válida y una asociación entre esa cuenta y la nueva sala.

El servidor obtiene la identidad del anfitrión a partir de la sesión. No acepta como prueba de identidad un nombre, un correo o un identificador enviado libremente por el cliente.

Si falta autenticación, la sesión es inválida o la cuenta ya no existe, la creación se rechaza sin guardar una sala incompleta. Lo mismo debe ocurrir si alguien intenta crear una reunión directamente contra la API, evitando la interfaz, o atribuírsela a otra cuenta.

**Comprobación:** un invitado no puede crear una sala; una cuenta autenticada sí puede hacerlo y queda registrada como su anfitrión. Modificar el identificador de anfitrión enviado desde el navegador no permite crear reuniones a nombre de otra persona.

Los permisos también se validan al ejecutar acciones de administración. Mostrar u ocultar un botón no reemplaza esa validación.

## Crear una reunión y entrar

Al crear una reunión se generan un código único y un enlace que se puede copiar y compartir. La sala guarda quién la creó, cuándo se creó y si está activa o finalizada.

Antes de entrar, cada persona puede confirmar su nombre visible, probar sus dispositivos y elegir si ingresa con cámara y micrófono encendidos o apagados. Abrir una invitación no debe encenderlos automáticamente.

El acceso contempla tanto cuentas registradas como invitados. Tener el enlace o código de una sala activa y elegir un nombre visible permite ingresar sin crear una cuenta. El nombre es obligatorio, se confirma antes de conectar el chat o los medios y no concede permisos de anfitrión. La sala de espera es una función de moderación opcional, desactivada por defecto, que el anfitrión podrá activar o desactivar. Con la espera activada, quienes quieran entrar deben ser admitidos; con ella desactivada, ingresan directamente si la sala está activa, permite nuevos ingresos y tiene cupo. El anfitrión accede mediante su cuenta sin tener que aprobarse a sí mismo.

- Quien espera aprobación todavía no recibe el chat, las imágenes ni los medios de la reunión.
- El anfitrión puede admitir o rechazar una solicitud y ver el resultado de la acción. Los cambios de configuración se aplican en el servidor: al desactivar la espera, las solicitudes pendientes pueden completar el ingreso si siguen cumpliendo las condiciones de acceso; activarla no retira a quienes ya están dentro.
- Bloquear nuevos ingresos no expulsa a quienes ya estaban dentro.
- Una expulsión termina la participación actual y retira su acceso al chat, los archivos y los medios. No bloquea la cuenta ni la sesión: la persona puede volver a solicitar el ingreso, incluso desde el mismo navegador, y se aplican las condiciones vigentes de la sala. La expulsión no debe provocar un reingreso automático del cliente.
- Una sala inexistente, finalizada, bloqueada o sin cupo debe mostrar el motivo correspondiente.
- El servidor aplica el máximo de **6 participantes por sala**, contando al anfitrión, las cuentas registradas y los invitados. Las personas en espera no ocupan un lugar dentro de la reunión. Al completarse el cupo, se rechazan nuevos ingresos y admisiones hasta que se libere un lugar, incluso si varias personas intentan entrar al mismo tiempo. Tener la cámara apagada no evita ese límite.

Expulsar y bloquear nuevos ingresos son acciones distintas. La expulsión solo quita a la persona de la sala. Si vuelve a entrar con la espera activada, necesita admisión; si está desactivada, puede ingresar directamente mientras se cumplan las demás condiciones. No existe una lista de usuarios bloqueados como consecuencia de una expulsión.

### Identidad y presencia

Cada participante tiene un identificador propio, independiente de su nombre y del socket. Dos personas pueden llamarse “Alex” sin compartir presencia, mensajes, indicadores de voz ni permisos.

La lista de participantes se actualiza cuando alguien entra, sale o se desconecta. El sistema guarda las participaciones y sus horarios de ingreso y salida, diferenciando una reconexión de un ingreso nuevo.

Si el anfitrión sale o pierde conexión y todavía quedan participantes, la sala continúa activa durante **15 minutos** desde que el servidor detecta su ausencia. Si vuelve antes de que venza ese plazo, se cancela el cierre; una ausencia posterior inicia un plazo nuevo. Si no vuelve, la reunión se finaliza para todos. El vencimiento se conserva ante un reinicio del servicio y no se extiende porque ingresen otras personas. Su rol no se asigna automáticamente. Si la sala queda vacía, se cierra sin esperar esos 15 minutos.

## La experiencia durante la llamada

### Cámara, micrófono y pantalla

Cada persona puede elegir cámara y micrófono, previsualizar su imagen y activar o desactivar sus propios medios durante la reunión. Si falta un dispositivo o se rechaza un permiso, debe poder continuar con las funciones disponibles y recibir instrucciones para resolver el problema.

La reunión transmite audio y video entre sus participantes en salas de hasta 6 personas. Debe funcionar entre dispositivos y redes diferentes, no solamente entre pestañas de una misma computadora.

Silenciar el micrófono impide que los demás reciban la voz de esa persona. Apagar la cámara interrumpe su imagen en vivo. Ambos estados se reflejan en la interfaz y se conservan al reconectar; una cámara o un micrófono apagados no se reactivan por esa reconexión.

Se puede compartir una pantalla, ventana o pestaña que el navegador permita seleccionar. Habrá una presentación activa por sala. Si otra persona intenta presentar al mismo tiempo, se le informa que ya hay una presentación. Cancelar la selección o detenerla no corta la llamada.

Al terminar la presentación se recupera la vista habitual. El audio de la pestaña o del sistema, las presentaciones simultáneas y el control remoto de otra computadora no están incluidos en esta definición.

### Reconocer a la persona que está hablando

Cuando alguien habla, los demás deben poder ubicarlo de inmediato:

- Se muestra su nombre junto con un indicador de voz.
- Su recuadro se resalta con un borde del mismo color que ese indicador.
- El nombre y el recuadro se corresponden por identidad de participante, aunque haya nombres repetidos.
- La identificación sigue visible cuando está abierto el chat, hay una pantalla compartida o se fijó otro video. Puede usarse una miniatura del hablante sin reemplazar la vista elegida por la persona.
- Si su cámara está apagada, se resaltan su avatar o sus iniciales y su nombre. Hablar nunca activa la cámara.
- Si varias personas hablan a la vez, se identifica a cada una sin atribuir todas las voces a una sola.

El resaltado aparece mientras se detecta voz y desaparece cuando termina la intervención, evitando cambios visuales molestos ante pausas breves. Un micrófono silenciado no debe figurar como una intervención audible.

Cada participante recibe un color elegido al azar entre una paleta definida en el frontend. La asignación se comparte con todos los clientes y se conserva durante su participación y sus reconexiones: una misma persona no debe verse con colores distintos según quién la mire. Se evitan repeticiones mientras queden colores disponibles; si se agota la paleta, los nombres y los indicadores siguen permitiendo distinguir a cada persona.

El indicador de voz y el borde usan ese mismo color. La paleta debe tener contraste suficiente y el color nunca es la única señal de actividad. La sensibilidad del detector se ajustará con las metas de respuesta definidas más abajo.

**Comprobación:** al hablar Ana, los demás ven su nombre y su recuadro con el mismo color de resaltado. Si apaga la cámara y sigue hablando, continúa identificada por nombre y avatar. Si Bruno también interviene, se reconoce a ambos.

### Controles y participación

La interfaz tendrá una grilla de participantes, controles de cámara y micrófono, presentación, salida y paneles de chat y personas. Los controles principales deben seguir siendo accesibles cuando cambia la distribución de la pantalla.

La experiencia también contempla levantar y bajar la mano, enviar reacciones y fijar un participante. Fijar una vista es una preferencia personal: no cambia la vista de los demás ni elimina los indicadores de quién habla. La mano levantada se mantiene hasta que la persona la baja o sale; las reacciones son temporales.

### Fondos y desenfoque

Cada persona puede usar su cámara sin efecto, desenfocar el fondo o reemplazarlo por una imagen propia. Se puede previsualizar el resultado antes de aplicarlo y cambiarlo o quitarlo durante la llamada.

Los fondos propios admiten JPEG, PNG y WebP estático, con los mismos límites de origen que las imágenes del chat. No se admiten fondos animados. La imagen se procesa en el dispositivo de la persona y no se sube como archivo al servidor: los demás reciben el video con el efecto aplicado.

No se exige guardar una biblioteca de fondos en la cuenta. Si el equipo no puede procesar el efecto con fluidez, se informa y se permite continuar con la cámara sin efecto. Aplicar un fondo no enciende una cámara que estaba apagada.

### Subtítulos

La reunión ofrece subtítulos automáticos en **español e inglés**. Cada persona puede activar o desactivar su visualización y ajustar el tamaño y el contraste del texto. Cada participante puede indicar el idioma que habla en su micrófono, para transcribir su voz con el modelo correspondiente e identificar sus intervenciones.

Se transcribe lo dicho en el idioma original; la traducción entre idiomas no forma parte de esta función. Los subtítulos no se guardan como transcripción, no se agregan al chat ni se incluyen en su historial de 24 horas.

El audio necesario se procesa de forma transitoria con software gratuito en el servidor propio o en el dispositivo, dentro de los servicios y créditos autorizados para el proyecto. Solo se transcriben los medios de participantes autorizados y los fragmentos de audio se descartan después de procesarlos. Si el reconocimiento falla, se informa sin cortar la llamada. La calidad se comprobará con conversaciones en ambos idiomas, incluyendo distintas voces y acentos.

## Grabación local de la reunión

Cualquier participante, con cuenta o invitado, puede solicitar permiso para grabar. El anfitrión puede aprobar o rechazar cada solicitud y puede iniciar su propia grabación sin pedir autorización.

La aprobación corresponde a una grabación de esa participación dentro de esa reunión. No habilita grabaciones futuras ni otras cuentas. Si la persona detiene la grabación y quiere iniciar otra, vuelve a solicitar aprobación. Si el anfitrión está ausente, las nuevas solicitudes esperan su regreso; una grabación ya autorizada puede continuar mientras la sala siga activa.

El flujo es el siguiente:

1. La persona solicita grabar y el anfitrión aprueba.
2. La persona pulsa “Elegir archivo e iniciar” y selecciona nombre y ubicación mediante el selector del navegador.
3. Se comprueba el permiso de escritura y comienza la grabación. Cancelar el selector no inicia nada.
4. Al detenerla se completa la escritura y se confirma el guardado con el nombre de archivo elegido. El anfitrión sigue este mismo flujo sin el paso de aprobación.

La grabación contiene la vista de reunión, con los videos, la presentación cuando exista y la mezcla del audio de quienes participan. El archivo se escribe progresivamente en la computadora de quien graba, evitando acumular toda la reunión en memoria. El servidor no guarda una copia, no recibe la ruta local ni ofrece un repositorio de grabaciones. El formato y la extensión se informan antes de elegir el archivo, según lo que soporte el navegador.

Todos ven un aviso de grabación activa y quién está grabando. Puede haber más de una persona grabando si cada una tiene autorización y un dispositivo compatible. El anfitrión puede retirar un permiso y detener esa grabación. También se detiene al salir o ser expulsado quien graba, al finalizar la reunión o si falla la escritura del archivo. En un fallo se informa lo ocurrido y se intenta cerrar el archivo parcial; no se promete recuperar una grabación después de un cierre abrupto del navegador.

La autorización controla la función integrada de Date2gether. No controla programas de grabación externos ni permite borrar archivos que otra persona ya guardó en su computadora.

**Compatibilidad de esta función:** Chrome y Edge de escritorio son los navegadores de referencia para elegir la ubicación antes de empezar. Si un navegador no permite ese flujo, la función se informa como no disponible; no se reemplaza silenciosamente por una descarga al terminar. La limitación no impide participar de la reunión.

El [selector de guardado de archivos](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker) requiere un navegador compatible, contexto seguro y una acción de la persona. Por eso la aprobación del anfitrión no abre el selector automáticamente. La escritura progresiva se apoya en las capacidades de [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) y el formato se consulta mediante [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

## Chat con texto, imágenes, GIFs y stickers

El chat pertenece a la reunión y está disponible para quienes ya tienen acceso a ella. Cada mensaje identifica a su autor, su tipo de contenido y el momento en que se envió.

Se mantiene el envío de texto, con un máximo de 2000 caracteres después de quitar espacios exteriores. No se aceptan mensajes de texto vacíos. También se podrán enviar imágenes, GIFs y stickers sin tener que acompañarlos con texto.

### Enviar imágenes y GIFs

La persona puede seleccionar una imagen o un GIF, revisar una vista previa y decidir si lo envía o cancela. Una vez enviado, los participantes conectados a la sala reciben el contenido dentro del chat. Las imágenes, GIFs y stickers de mensajes son transitorios: se muestran en vivo, pero no se incorporan al historial que se recupera al ingresar o reconectar.

Los GIFs conservan su animación. Las imágenes se muestran sin deformarse y pueden abrirse en una vista ampliada dentro de la aplicación.

La carga y el envío deben mostrar su estado. Si el archivo es inválido, excede un límite o falla la conexión, se explica el problema y se permite corregirlo o reintentar. Cancelar una carga no publica un mensaje; reintentar un envío ya aceptado no debe duplicarlo.

Los formatos, el peso y las dimensiones por archivo se fijan en la sección siguiente. El servidor los valida al recibir y procesar el contenido, y vuelve a comprobar la autorización antes de publicarlo en la sala.

No se presupone una integración con un catálogo externo de GIFs: enviar un archivo GIF propio forma parte de la función.

### Formatos y límites por archivo

Se adoptan estos límites para equilibrar calidad, transferencia y procesamiento durante una videollamada. Son decisiones del proyecto tomadas a partir de la investigación técnica; se verificarán con la infraestructura definitiva. No son límites del navegador ni una capacidad ya medida de Date2gether.

El archivo que se selecciona puede ser mayor que la versión que se distribuye en vivo o se guarda explícitamente en una colección personal:

| Archivo de origen    | Formatos admitidos                                  | Peso máximo        | Otros límites                                                   |
| -------------------- | --------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| Imagen estática      | JPEG/JPG, PNG y WebP estático                       | 10 MiB             | Hasta 8192 px por lado y 25 megapíxeles en total.               |
| Animación            | GIF y WebP animado                                  | 10 MiB             | Hasta 1280 px por lado, 10 segundos por ciclo y 300 fotogramas. |
| Origen de un sticker | Cualquiera de las imágenes o animaciones anteriores | El de su categoría | Se aplican los mismos límites del archivo de origen.            |

Todos los límites se cumplen a la vez. Además, una animación no puede superar 60 millones de píxeles acumulados, calculados como `ancho del lienzo × alto del lienzo × cantidad de fotogramas`, antes de redimensionarla. El límite de duración corresponde a un ciclo, aunque se reproduzca en bucle.

Para publicar el contenido se genera una versión optimizada:

| Contenido publicado      | Formato       | Dimensiones máximas                           | Peso máximo |
| ------------------------ | ------------- | --------------------------------------------- | ----------- |
| Imagen del chat          | WebP estático | 2560 px en el lado mayor                      | 2 MiB       |
| GIF o animación del chat | WebP animado  | 800 px en el lado mayor                       | 3 MiB       |
| Sticker estático         | WebP estático | Contenido proporcional dentro de 512 × 512 px | 200 KiB     |
| Sticker animado          | WebP animado  | Contenido proporcional dentro de 512 × 512 px | 512 KiB     |

Las animaciones publicadas conservan su duración y se limitan a 20 fotogramas por segundo, sin aumentar la frecuencia del original. Si se reducen fotogramas, se ajustan sus tiempos de presentación sin acelerar la animación. Un sticker animado mantiene el máximo de 10 segundos por ciclo. MiB y KiB significan, respectivamente, 1 048 576 y 1024 bytes.

La aplicación hace la conversión: la persona no necesita preparar un sticker de 512 px. Se conservan proporción, orientación, transparencia y contenido; no se estiran imágenes, no se recortan bordes ni se truncan animaciones para hacerlas entrar en el límite. No se amplían imágenes pequeñas: 512 × 512 px es una caja máxima para stickers, no una obligación de agrandar el contenido. Si se necesita un lienzo cuadrado, se completa con transparencia. En capturas con texto se prioriza su legibilidad. La vista previa debe representar el resultado que se enviará o guardará.

Si no se puede obtener un resultado válido dentro de los límites, se explica el motivo y se solicita otro archivo; no se publica una versión fuera del máximo ni se transforma silenciosamente una animación en una imagen fija. En la interfaz puede seguir llamándose “GIF”, aunque se distribuya como WebP animado.

El servidor comprueba el formato real, que el archivo pueda decodificarse y que cumpla peso, dimensiones, duración y fotogramas. La extensión o el tipo declarado por el navegador no bastan. Se aplican los controles tanto a los mensajes como a la creación de stickers. PNG animado y otros formatos no enumerados, como SVG, HEIC, AVIF o video, se rechazan con una indicación clara.

Antes de publicar se reprocesa el archivo, se aplica su orientación y se retiran metadatos privados, como ubicación y datos del dispositivo. La lectura y conversión deben tener límites de memoria, tiempo y concurrencia para no interrumpir la llamada; esos parámetros se ajustarán a la infraestructura. El acceso al archivo publicado sigue los permisos de la sala o de la colección personal.

La colección de stickers tiene la cuota por cuenta indicada más abajo. Los archivos originales, las cargas de imágenes del chat y las conversiones que no se guardan explícitamente en una colección se procesan en memoria transitoria: no se conservan en archivos del servidor, bases de datos, registros ni copias de seguridad. Los buffers se liberan al completar la transferencia, cancelar, fallar o cerrar la reunión. Las reservas de memoria y la concurrencia se dimensionarán según el servidor.

La elección de WebP se apoya en su soporte de transparencia y animación, documentado por [MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) y [Google](https://developers.google.com/speed/webp/faq). Google también señala que una menor transferencia no garantiza menor consumo de CPU. Los controles sobre cargas se basan en [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html); la documentación de [Sharp](https://sharp.pixelplumbing.com/api-constructor/) ilustra por qué también deben limitarse píxeles y fotogramas, sin obligar a usar esa biblioteca. Ninguna de estas fuentes prescribe los valores numéricos elegidos para este proyecto.

### Crear y guardar stickers

Un sticker se crea a partir de una imagen o de un GIF. El flujo permite elegir el archivo, ver cómo quedará y confirmar la creación antes de enviarlo o guardarlo.

Una imagen produce un sticker estático. Un GIF permite crear un sticker animado y conservar su animación. Crear un sticker no implica enviarlo automáticamente al chat.

Cada cuenta dispone de una colección personal desde la que se pueden reutilizar stickers. Guardar un sticker propio o recibido es una acción explícita; recibirlo no lo agrega automáticamente a esa colección. También se puede quitar un sticker guardado.

Los stickers guardados se asocian a la cuenta y se conservan después de cerrar sesión. Al volver a iniciar sesión, incluso desde otro dispositivo, la persona recupera su colección. No dependen de una sala, una pestaña ni de la duración de una conexión.

Cada cuenta dispone de **50 MiB (52 428 800 bytes)** para stickers. Se contabiliza el tamaño del archivo final optimizado, no el original, y no se agrega un máximo de cantidad. La interfaz muestra espacio usado y disponible. Guardar nuevamente el mismo recurso no duplica la entrada ni consume más cuota.

Si un guardado supera el espacio disponible, se rechaza sin afectar la colección existente y se permite liberar espacio quitando stickers. La comprobación se realiza en el servidor también ante guardados simultáneos. Quitar un sticker libera su cuota; el recurso físico se elimina cuando ninguna otra colección lo conserva ni queda una transferencia en curso. Solo se conserva la versión final, nunca el archivo de origen.

Guardar en la colección requiere una cuenta autenticada. Un invitado puede crear y enviar stickers dentro de la reunión, pero debe iniciar sesión o registrarse para conservarlos en una colección personal. Al cambiar de cuenta, se muestra únicamente la colección de la cuenta activa; el servidor comprueba su propietario al guardarla, consultarla o modificarla.

La colección personal no se comparte con los demás participantes. Al enviar un sticker se comparte ese contenido dentro de la reunión, no el acceso a toda la colección.

Guardar un sticker incorpora ese contenido a la colección de la cuenta. Sigue disponible aunque la sala de origen se cierre o su historial caduque, sin depender del acceso futuro al mensaje original. Esto no concede acceso al resto de los mensajes o archivos de esa sala.

Quitar un sticker de la colección no borra mensajes ya enviados ni los stickers guardados por otras cuentas. Los mensajes con stickers no forman parte del historial conservado: únicamente las colecciones guardadas expresamente conservan esos recursos.

Recortar imágenes, quitar fondos, dibujar sobre ellas o generar stickers con inteligencia artificial no son requisitos de esta función. Podrían incorporarse más adelante mediante una decisión de alcance.

**Comprobación:** se crea un sticker desde una imagen y otro desde un GIF. El primero se ve estático y el segundo animado; ambos pueden enviarse, guardarse y reutilizarse sin perder su relación con el autor del mensaje.

### Historial, enlaces y conservación

El historial recuperable contiene **únicamente texto y enlaces enviados por las personas**. Quien ingresa o reconecta a una reunión activa puede recuperar ese contenido anterior de la misma sala, siempre que no haya sido eliminado.

“Enlaces” significa las direcciones HTTP o HTTPS compartidas como contenido de un mensaje. No incluye URLs internas de adjuntos, miniaturas, imágenes incrustadas, archivos originales ni referencias a stickers que permitan reconstruir mensajes multimedia. Si un mensaje combina texto y una imagen, solo su parte textual y sus enlaces forman parte del historial.

Las imágenes, GIFs y stickers enviados al chat se distribuyen en vivo. No se guardan en el historial ni en almacenamiento persistente del servidor o de la aplicación cliente. Al salir o cerrar la reunión se liberan los recursos transitorios. Recargar o reconectar no los recupera. Una persona puede guardar expresamente un sticker en su cuenta mientras tenga acceso a él; esa colección es independiente del historial.

El texto y los enlaces se conservan durante **24 horas exactas desde el cierre de la reunión**, usando la fecha de cierre registrada por el servidor. El plazo no se cuenta desde cada mensaje ni cambia por consultar el historial. Al vencer, se elimina automáticamente su contenido y deja de estar disponible. Cerrar una sala por vacío o por ausencia del anfitrión inicia el mismo plazo.

La eliminación comprende la base de datos y las copias o cachés gestionadas por la aplicación. Los mensajes no se copian a registros ni a respaldos que prolonguen esa conservación. Si el servicio estuvo detenido al vencer el plazo, debe purgar lo vencido antes de volver a ofrecer consultas.

Todavía falta confirmar si, durante esas 24 horas, quienes participaron podrán consultar el historial después del cierre o si solo se conservará internamente hasta su eliminación. Esa decisión no modifica el plazo de borrado ni permite reabrir la llamada.

La biblioteca personal de stickers y los archivos de grabación elegidos por las personas no se eliminan con el historial del chat. La conservación de los registros de ingreso y salida de participantes es una decisión separada que todavía debe definirse.

### Borrar mensajes

Cada persona puede borrar sus propios mensajes y el anfitrión puede borrar cualquier mensaje de su reunión. Esto incluye texto, enlaces y los mensajes multimedia que todavía estén visibles durante la llamada. La autorización se comprueba por identidad, nunca por nombre visible.

El borrado retira el contenido de la aplicación y se comunica a los demás clientes. Puede quedar un aviso de “Mensaje eliminado”, sin el texto, enlace o adjunto anterior. Una reconexión no debe recuperar el contenido eliminado. Para un invitado, reconocer la autoría requiere conservar la credencial de su participación; indicar el mismo nombre no permite borrar mensajes ajenos.

Borrar un mensaje con un sticker no borra la colección personal de quien ya lo guardó expresamente. Tampoco retira copias que una persona haya guardado fuera de la aplicación.

### Envíos y errores

Un mensaje enviado aparece una sola vez. La interfaz distingue entre un envío pendiente, uno confirmado y uno fallido. Si falla, se conserva el texto o se permite volver a seleccionar el adjunto para reintentar; no se presenta como enviado algo que el servidor no aceptó.

Otra sala no recibe esos mensajes ni puede consultar su historial. Una persona en espera o que sigue fuera tras una expulsión no tiene acceso. Si vuelve a ingresar correctamente, recupera el historial textual autorizado, no los adjuntos transitorios anteriores.

La confirmación de un mensaje multimedia acredita su distribución en vivo, no su almacenamiento. Un participante desconectado puede perder ese contenido y no se debe prometer recuperarlo desde el historial.

## Reconexión, salida y cierre

Una pérdida temporal de red debe mostrarse como tal. El sistema intenta recuperar la participación, los medios y el chat sin duplicar personas o mensajes ni cambiar las preferencias de cámara y micrófono.

La recuperación vuelve a comprobar permisos, estado de la sala y cupo. Una reunión finalizada no se reabre. La participación terminada por una expulsión no se restaura automáticamente: la persona puede iniciar un nuevo ingreso con la misma cuenta o sesión y seguir la política de acceso vigente. El tiempo durante el cual se reserva un lugar a quien perdió conexión queda por definir.

**Salir y finalizar son acciones distintas.** Cualquier participante puede salir. Finalizar para todos es una acción del anfitrión y requiere confirmación.

Al salir se detienen cámara, micrófono y presentación propios, se cierran las conexiones y se actualiza la lista de participantes. Los demás continúan en la reunión, sujeto al plazo de tolerancia si quien salió era el anfitrión.

**Una sala que queda vacía se cierra automáticamente.** Cuando sale el último participante de una reunión iniciada, el servidor guarda su cierre sin esperar una acción del anfitrión. Las personas en la sala de espera no cuentan como participantes de la reunión ni la mantienen abierta. Ante un corte de red, la confirmación de que la sala quedó vacía debe respetar la política de detección y reserva de reconexión, cuyo plazo todavía falta definir.

La creación y el primer ingreso deben coordinarse para no cerrar la sala en el intervalo entre ambas acciones. La caducidad de una sala creada que nunca llegó a utilizarse sigue pendiente; es un caso distinto de una reunión iniciada que se quedó sin participantes.

Cuando el anfitrión finaliza, el servidor guarda el cierre y retira a todos. Desde ese momento se rechazan nuevos ingresos, mensajes, cargas y conexiones a los medios. Una operación que empezó antes del cierre no debe publicar contenido después de él.

Las mismas restricciones de cierre se aplican cuando la sala queda vacía o vence el plazo sin anfitrión. El mismo enlace informa que la reunión terminó y reiniciar el backend no la vuelve a abrir. No se admiten nuevas participaciones ni mensajes. El tratamiento del historial textual durante las 24 horas posteriores sigue las reglas de su sección; el cierre no conserva adjuntos. Los datos o grabaciones que una persona haya guardado fuera de la aplicación no pueden retirarse de ese dispositivo.

## Calidad que debe cumplir el producto

El alcance funcional también incluye estas condiciones:

- **Accesibilidad.** Se puede navegar por las acciones principales con teclado, reconocer el foco y comprender controles y errores. La identificación del hablante no depende solo del color.
- **Uso en distintas pantallas.** La interfaz se adapta a escritorio y móvil. Las funciones que dependen del navegador, como compartir pantalla, deben tener su compatibilidad documentada y un mensaje claro cuando no estén disponibles.
- **Aislamiento y permisos.** El servidor valida identidad y autorización para crear salas, administrar participantes, usar el chat y acceder a medios, adjuntos y colecciones personales.
- **Datos protegidos.** Las conexiones del despliegue están protegidas. Las contraseñas y credenciales no se exponen en respuestas ni registros. Los archivos se validan antes de distribuirse y las cargas transitorias se liberan al terminar, cancelar o fallar.
- **Persistencia.** Cuentas, anfitriones, estado de las reuniones, participaciones, historial textual no vencido y colecciones personales sobreviven al reinicio. Las imágenes, GIFs y stickers de mensajes no se persisten. El historial vence a las 24 horas del cierre y los stickers guardados respetan su cuota por cuenta.
- **Recuperación.** Los errores de permisos, dispositivos, conexión, carga y envío muestran una explicación y una acción posible. El sistema no oculta fallos como si la operación hubiera terminado bien.
- **Rendimiento verificable.** Las funciones se prueban contra las metas definidas más abajo, en la infraestructura AWS del proyecto y con hasta 6 participantes por sala. Esas metas son requisitos a validar, no resultados medidos del código actual.
- **Instalación y pruebas reproducibles.** El proyecto se instala y ejecuta siguiendo los README, con pnpm y migraciones documentadas. Las pruebas usan datos y una base separados del desarrollo.

### Navegadores y dispositivos

Se soportan las dos versiones estables principales más recientes de los navegadores incluidos, sobre sistemas operativos que esos navegadores mantengan soportados. En cada entrega se registran las versiones exactas verificadas; no se exige compatibilidad con navegadores antiguos ni con navegadores embebidos en otras aplicaciones.

| Entorno                                                | Participación, chat, stickers y subtítulos | Presentar pantalla                                                 | Grabación con ubicación elegida al inicio                               |
| ------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Chrome y Edge de escritorio, en Windows, Linux y macOS | Incluido                                   | Incluido con permiso del navegador                                 | Incluido; entorno de referencia                                         |
| Firefox de escritorio                                  | Incluido                                   | Incluido con permiso del navegador                                 | No se ofrece mientras no permita elegir y escribir el archivo al inicio |
| Safari en macOS                                        | Incluido                                   | Incluido con permiso del navegador                                 | No se ofrece mientras no permita elegir y escribir el archivo al inicio |
| Chrome en Android                                      | Incluido                                   | No se exige emitir pantalla desde móvil; sí recibir presentaciones | Solo se habilita en dispositivos con el flujo completo comprobado       |
| Safari en iPhone y iPad                                | Incluido                                   | No se exige emitir pantalla desde móvil; sí recibir presentaciones | No se ofrece mientras no permita elegir y escribir el archivo al inicio |

El desenfoque y los fondos propios se verifican en escritorio. En móviles se habilitan al comprobar capacidad y fluidez en el dispositivo; si no están disponibles, el resto de la reunión sigue funcionando con cámara normal.

La tabla define el soporte objetivo de Date2gether, no una certificación del código actual. El selector de guardado tiene diferencias entre motores; los [datos de compatibilidad mantenidos por MDN](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json) permiten verificarlas. La aplicación detecta las capacidades reales antes de ofrecer grabación o presentación, sin asumirlas solo por el nombre del navegador.

### Tiempos de respuesta y estabilidad

Se adoptan estas metas para el **percentil 95**, es decir, para al menos el 95 % de las operaciones medidas dentro del entorno de prueba. No son garantías sobre cualquier conexión de Internet.

| Operación                                         | Meta             | Desde dónde se mide                                                                                                   |
| ------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Entrar a una reunión                              | 5 segundos       | Desde la admisión y los permisos resueltos hasta tener sala, chat y conexión de medios disponibles.                   |
| Entregar texto o enlaces                          | 1 segundo        | Desde pulsar enviar hasta recibir el mensaje en los demás clientes conectados.                                        |
| Propagar un borrado                               | 1 segundo        | Desde la confirmación del servidor hasta retirar el mensaje de los demás clientes conectados.                         |
| Identificar a quien habla                         | 500 milisegundos | Desde el comienzo de la voz hasta mostrar su indicador y borde a los demás.                                           |
| Publicar una imagen o crear un sticker estático   | 20 segundos      | Desde iniciar la carga de un archivo válido de hasta 10 MiB, incluyendo validación y procesamiento.                   |
| Publicar una animación o crear un sticker animado | 30 segundos      | Desde iniciar la carga de un archivo válido de hasta 10 MiB, dentro de los límites de duración y píxeles.             |
| Recuperar una conexión                            | 10 segundos      | Desde que vuelve una conexión estable, si la sala y la participación siguen habilitadas.                              |
| Mostrar un segmento de subtítulos                 | 5 segundos       | Desde el final de un segmento hablado de hasta 5 segundos hasta mostrar su transcripción.                             |
| Iniciar una grabación autorizada                  | 3 segundos       | Desde confirmar el archivo y el permiso de escritura, sin contar la espera de aprobación ni la elección de ubicación. |

La validación usa al menos 30 mediciones por operación, RTT hacia el servidor de hasta 100 ms y pérdida de paquetes de hasta 1 %. Para las cargas se requiere un mínimo de 10 Mbit/s efectivos de subida disponibles además del tráfico de la llamada. Se registran equipos, navegadores y recursos del servidor.

También debe sostenerse una reunión de **60 minutos con 6 participantes, incluido el anfitrión**, con cámaras, micrófonos, chat y una presentación en uso, sin caídas de la aplicación ni pérdida de mensajes textuales confirmados. Se repite con subtítulos y con grabación y efectos activos en los dispositivos compatibles para medir su impacto.

El cupo por sala queda fijado en 6 personas. La cantidad de salas simultáneas y los recursos del servidor siguen pendientes; el cumplimiento de las metas requiere pruebas con ese cupo en la infraestructura elegida. La meta de reconectar en 10 segundos no define cuánto tiempo se reserva un lugar, ni modifica los 15 minutos de tolerancia sin anfitrión.

## Infraestructura y recursos

Para la entrega académica, el equipo utilizará **AWS EC2 con LiveKit autohospedado** en `us-east-2`, con un máximo objetivo de seis personas por sala. Esta decisión reemplaza la integración de Chime SDK y el objetivo anterior de 100 participantes. Esta decisión autoriza servicios administrados y reemplaza la restricción anterior de alojamiento propio sin APIs comerciales. La aplicación y la base de datos se despliegan en la infraestructura del proyecto; LiveKit gestiona la señalización y distribución de audio y video; NestJS conserva la identidad y las reglas de acceso. El reconocimiento de voz puede resolverse en el dispositivo o mediante la infraestructura aprobada.

La comunicación entre distintas redes debe funcionar usando los servicios de medios de AWS configurados para el proyecto. La grabación permanece en el equipo de quien graba; los efectos de fondo se procesan en el cliente.

El plan gratuito de AWS termina a los seis meses o al agotar sus créditos, lo que ocurra primero. EC2 está entre los servicios admitidos del nuevo AWS experience y aloja el servidor abierto de LiveKit. No se utiliza Chime SDK ni se requiere activar funciones avanzadas o contratar LiveKit Cloud. El costo de cómputo, almacenamiento, IPv4 y transferencia se cubre con créditos elegibles según sus condiciones; no se promete infraestructura ilimitada ni seis meses de uso continuo sin costo. Antes de desplegar se confirma el plan, el saldo y el vencimiento en AWS Settings > Billing. No se cambia el plan de AWS automáticamente. El motor de transcripción sigue pendiente.

Para la demostración se prepara una sola EC2 con la aplicación completa, HTTPS y respaldo de conectividad mediante TURN. La configuración predeterminada limita las llamadas a seis conexiones de medios y apaga la instancia a las dos horas de cada arranque; se puede ajustar para la presentación. El apagado interrumpe reuniones activas y no elimina los cargos de disco o IPv4 reservada. El cupo de admisión al chat sigue siendo una función pendiente; el cupo de medios lo aplica LiveKit.

No se supone capacidad ilimitada: el almacenamiento de cuentas y stickers, la memoria de las transferencias y el procesamiento de medios deben dimensionarse según ese servidor. Para dimensionar el despliegue para salas de hasta 6 personas y definir cuántas podrán funcionar simultáneamente, se documentarán CPU, RAM, almacenamiento, conexión y, si existe, aceleración disponible.

## Lo que todavía hay que decidir

Las reglas anteriores ya forman parte de la especificación. Quedan abiertos estos puntos:

| Tema                        | Decisión pendiente                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Salas simultáneas           | Cantidad de reuniones que podrán funcionar al mismo tiempo, con un máximo ya definido de 6 personas por sala.                        |
| Infraestructura AWS         | Servicios, regiones, recursos, créditos disponibles y fecha de vencimiento; permiten dimensionar y validar las metas de rendimiento.   |
| Medios y transcripción      | Medios con LiveKit autohospedado en EC2; falta seleccionar el motor de transcripción y validar su cobertura y consumo.                             |
| Salas sin utilizar          | Caducidad de una sala creada cuyo primer ingreso nunca se completó.                                                                    |
| Reconexión                  | Plazo de reserva de cupo y momento de confirmar que una sala quedó vacía tras un corte de red.                                         |
| Registros de participación  | Plazo de conservación y eliminación de ingresos y salidas; no confundirlos con el historial del chat, que ya vence a las 24 horas.     |
| Consulta después del cierre | Si quienes participaron pueden consultar el historial textual durante sus 24 horas de conservación o si se conserva solo internamente. |

La paleta concreta se define en el frontend y se valida por contraste. Los límites internos de memoria y concurrencia se ajustarán a la infraestructura sin cambiar por su cuenta las funciones del producto.

## Fuera del alcance

No forman parte del producto las aplicaciones nativas, el acceso telefónico, los pagos, la transmisión pública masiva, la integración con calendarios o plataformas externas, los mensajes privados ni las pizarras. Tampoco el envío de documentos o ejecutables, la traducción automática, un archivo de transcripciones, las grabaciones en la nube ni un catálogo de fondos animados. Imágenes y GIFs en vivo, stickers personales, grabación local, subtítulos y fondos propios sí están incluidos.

## Cómo vamos a comprobar que funciona

Las pruebas de cada función deben complementarse con recorridos completos. Como mínimo, deben cubrir:

1. Crear una cuenta e iniciar sesión; comprobar que la creación de una sala sin cuenta, con sesión inválida o atribuyéndola a otra persona se rechaza sin guardar la sala.
2. Crear una reunión y comprobar el ingreso directo por defecto y que invitados con enlace puedan entrar tras elegir un nombre; activar la espera. Admitir participantes, desactivarla y verificar el ingreso directo; volver a activarla sin expulsar a quienes ya están dentro. Mantener los controles de bloqueo y comprobar el cupo de 6 personas, incluido el anfitrión: rechazar el ingreso número 7 tanto directo como por admisión. Con 5 participantes y dos ingresos simultáneos, aceptar como máximo uno; al liberarse un lugar, permitir un nuevo ingreso.
3. Reunir a varias personas desde dispositivos y redes diferentes, incluyendo invitados y participantes con el mismo nombre.
4. Usar cámara y micrófono, entrar con permisos rechazados y reconocer a quien habla por nombre, indicador y borde del mismo color, incluso con cámara apagada. Comprobar que el color aleatorio asignado sea el mismo para todos y se mantenga al reconectar.
5. Compartir pantalla, fijar otro video y abrir el chat sin perder la identificación del hablante. Probar también voces simultáneas.
6. Enviar texto, imágenes y GIFs; comprobar animación, vista previa, cancelación, errores y reintentos sin duplicados. Probar archivos al límite y por encima de peso, dimensiones, duración, fotogramas y píxeles acumulados; rechazar formatos no admitidos y verificar los límites de la versión publicada.
7. Crear stickers estáticos y animados, guardarlos y cerrar sesión. Comprobar aislamiento entre cuentas, recuperación desde otro dispositivo y disponibilidad después de cerrar la sala de origen. Probar la cuota de 50 MiB, guardados simultáneos, duplicados y liberación de espacio.
8. Recuperar únicamente texto y enlaces tras una reconexión autorizada, sin imágenes, GIFs, stickers ni URLs internas de adjuntos. Verificar la eliminación del historial al cumplirse 24 horas desde el cierre y que las colecciones personales sigan disponibles.
9. Comprobar que otra sala, una persona en espera o una participación expulsada que sigue fuera no acceden al chat, los archivos ni los medios. Tras una expulsión, permitir un nuevo ingreso con la misma cuenta o sesión: directo si la espera está desactivada y con admisión si está activada.
10. Salir y reconectar sin duplicar participantes, confundir nombres o encender dispositivos que estaban apagados.
11. Finalizar como anfitrión y rechazar esa acción desde otra cuenta. En otra reunión, comprobar el cierre automático al salir el último participante. Con participantes presentes pero sin anfitrión, comprobar el cierre al cumplirse 15 minutos, su cancelación si vuelve antes y que reiniciar el servidor no extienda el plazo. En todos los casos, verificar que el enlace siga cerrado después de reiniciar el backend.
12. Borrar mensajes propios y mensajes ajenos como anfitrión; rechazar el intento de una tercera persona sin permisos. Comprobar que el contenido eliminado no reaparezca al reconectar.
13. Solicitar, aprobar y rechazar grabaciones; verificar que el anfitrión pueda iniciar directamente. Elegir el archivo antes de comenzar, cancelar el selector, revocar un permiso y cerrar la reunión. Comprobar que se guarde localmente y que no exista copia en el servidor.
14. Activar subtítulos en español e inglés, cambiar su presentación y comprobar que no se conserven como transcripción. Aplicar desenfoque y una imagen propia sin encender una cámara apagada ni almacenar el fondo en el servidor.
15. Repetir los recorridos principales en la matriz de navegadores y dispositivos definida, incluyendo teclado y pantallas pequeñas. Medir las metas de respuesta y la sesión de 60 minutos con 6 participantes.

La evidencia de aceptación debe indicar qué se probó, con cuántos participantes y en qué entorno. Una prueba escrita o una función presente en el código no demuestran por sí solas que el recorrido funciona.

## Estado de la entrega de llamadas e invitados

Esta rama integra la base de `develop`: registro, login, renovación y cierre de sesión; creación de salas con administrador registrado; roles por sala; chat textual persistente; tema claro/oscuro y traducciones ES/EN.

El ingreso mediante enlace requiere confirmar un nombre. La API emite un pase firmado limitado a esa sala, separado de una sesión de cuenta. Los invitados pueden usar chat y solicitar audio y video LiveKit sin registrarse; no pueden crear salas ni administrar roles. Los participantes reciben un ID independiente de su nombre y del socket. La misma credencial se conserva durante una reconexión automática; al recargar se confirma el nombre y se crea una participación nueva.

El PR incorpora audio y video con LiveKit, grilla con nombres, cámara y micrófono apagados al conectar, controles y selección de dispositivos durante la llamada, reproducción de audio remoto y liberación de tracks al colgar. El servidor firma pases temporales limitados a la sala e identidad; LiveKit aplica seis conexiones de medios por defecto. Los participantes sin cuenta usan el mismo flujo después de confirmar su nombre.

La configuración EC2 y las imágenes de la aplicación se preparan con HTTPS y TURN. La aceptación en AWS queda pendiente hasta desplegar con una sesión vigente y probar entre dispositivos/redes. Previsualización previa al ingreso, pantalla compartida, espera, cupo de admisión al chat, cierre automático de salas de la aplicación, borrado y vencimiento del chat, adjuntos, stickers, grabación, subtítulos y fondos siguen pendientes. Las pruebas automáticas no acreditan por sí solas la capacidad de seis personas en la infraestructura real.

Las migraciones conservan roles en `0002_panoramic_nebula` y agregan Chime en `0003_chime_meeting`. Las instrucciones operativas están en el [README principal](../README.md), el [README del cliente](../client/README.md) y la [guía E2E](../e2e/README.md).
