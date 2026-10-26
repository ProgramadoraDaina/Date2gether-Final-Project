# Date2gether — client

Frontend Next.js 15.5.27, React 19 y TypeScript. Forma parte del workspace pnpm; las dependencias se instalan desde la raíz con `pnpm install --frozen-lockfile`.

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

## Audio con Amazon Chime SDK

El audio usa la misma reunión Chime para toda la sala. Al pulsar Llamar, el frontend obtiene una reunión y un asistente mediante `POST /calls/:roomCode`, con el pase de sala. Las credenciales AWS permanecen en el backend. El perfil local se configura solo en el `.env` raíz; no hay variables AWS ni claves en `client/.env`.

El nuevo AWS experience con plan FREE no admite Chime SDK. El audio queda deshabilitado por defecto (`AWS_CHIME_ENABLED=false` en el backend), con un mensaje claro al pulsar Llamar. Usar Chime requiere una decisión explícita sobre plan pago y funciones avanzadas; los créditos no garantizan seis meses de llamadas gratuitas. La configuración y sus límites están en el [README principal](../README.md#aws-y-llamadas). Los tests simulan AWS; la conexión real requiere credenciales y una prueba entre dos navegadores.

La interfaz espera la confirmación real de Chime, permite cancelar la conexión y silenciar o activar el micrófono. Colgar o abandonar la página libera el dispositivo. Los errores de conexión permiten volver a llamar.

En esta entrega todavía faltan cámara, grilla de video, selección y previsualización de dispositivos, pantalla compartida y moderación de ingresos. El botón Llamar inicia audio; no representa una videollamada completa.

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
