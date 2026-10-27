# Date2gether — client

Frontend Next.js 15.5.28, React 19 y TypeScript. Forma parte del workspace pnpm; las dependencias se instalan desde la raíz con `pnpm install --frozen-lockfile`.

## Desarrollo

Copiá `client/.env.example` a `client/.env`. Por defecto usa `NEXT_PUBLIC_API_URL=http://localhost:3001`.

Desde la raíz ejecutá `pnpm dev:client`, o desde `client/` ejecutá `pnpm dev`. El frontend escucha en http://localhost:3002. El backend se inicia en otra terminal con `pnpm start:dev`; ambos necesitan PostgreSQL y las migraciones aplicadas. La [guía principal](../README.md) detalla la configuración.

## Crear y entrar a reuniones

- Crear una reunión requiere una cuenta y una sesión válida. Su creador queda como administrador.
- Cualquier persona con el enlace `/room/<código>` puede entrar sin cuenta, eligiendo y confirmando un nombre de 1 a 60 caracteres. También se acepta el código desde el inicio.
- Abrir el enlace muestra primero el formulario de nombre; no conecta el chat ni solicita el micrófono automáticamente.
- La API entrega un pase de participante limitado a esa sala. Ese pase se usa para el socket y para Llamar; no reemplaza el JWT de una cuenta ni habilita permisos de administrador.
- Dos personas pueden usar el mismo nombre: sus identificadores de participante son distintos.
- Copiar enlace permite invitar a otra persona. Salir cierra el socket y la sesión de audio del navegador.

La interfaz conserva ES/EN y tema claro/oscuro. Los usuarios registrados mantienen sus roles por sala. Los invitados participan sin tener que registrarse.

## Audio y video con LiveKit

Al pulsar Llamar, el backend entrega `{ url, token, roomName, participantLimit }` a quien presenta el pase de esa sala. El cliente conecta con `LiveKitRoom`, muestra la grilla y reproduce audio remoto. Cámara y micrófono empiezan apagados; se activan y se eligen desde los controles. También se puede escuchar y usar el chat sin otorgar permisos de dispositivos. Al colgar o salir se liberan los tracks. Los nombres se toman de los tokens firmados; repetir un nombre no mezcla identidades.

El cupo predeterminado es de seis conexiones de medios. El backend prepara la sala y LiveKit aplica ese máximo; las claves privadas del servidor no llegan al navegador. Ya no se usa Chime SDK ni se necesita habilitar funciones avanzadas de AWS.

El desarrollo local utiliza `ws://localhost:7880` con el servicio LiveKit del Compose raíz. La [guía EC2](../deploy/ec2/README.md) prepara la aplicación completa por HTTPS en `us-east-2`. En ese despliegue `NEXT_PUBLIC_API_URL=/api` se fija durante el build; REST y Socket.io comparten el dominio de la aplicación. Para cambiarlo hay que reconstruir el frontend.

La configuración privada está solo en el backend. `client/.env` contiene la URL pública de la API. No poner claves de LiveKit ni credenciales AWS allí. Las pruebas simulan los SDK; la aceptación final requiere dispositivos y redes reales.

Quedan pendientes previsualización antes del ingreso, compartir pantalla, admisión y otras funciones detalladas en los requisitos.

## Scripts

Desde `client/`:

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm test --runInBand
```

Los requisitos del producto están en [requirements.md](../docs/requirements.md). Los planes y estados anteriores de los README no sustituyen esa referencia.
