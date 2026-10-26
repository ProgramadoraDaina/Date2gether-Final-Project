# Tests end-to-end (Playwright)

Prueban la app completa como la usaría una persona real: abren un navegador,
hacen click, completan formularios. Para eso levantan el backend (NestJS) y
el frontend (Next.js) juntos, contra una base de datos de Postgres separada
y descartable (no la de desarrollo).

La explicación de **qué** verifica cada test puntual está en un comentario
arriba de cada `test(...)`, en `auth.spec.ts` y `rooms.spec.ts`. Este README
es solo la guía para correrlos.

## Antes de la primera vez

```bash
pnpm install
pnpm exec playwright install chromium
```

## Correr los tests

```bash
# 1. Levanta Postgres de prueba (puerto 5433) y le aplica las migraciones
pnpm test:e2e:setup

# 2. Corre la suite completa (Playwright prende el backend y el frontend solo)
pnpm test:e2e

# Modo interactivo, útil mientras se escribe un test nuevo
pnpm test:e2e:ui

# Ver el último reporte HTML
pnpm test:e2e:report
```

Cuando termines por el día, podés tirar la base de prueba:

```bash
pnpm test:e2e:db:down
```

## Qué pasa detrás de escena

- `docker-compose.test.yml` levanta un Postgres vacío en el puerto **5433**
  (el de desarrollo usa 5432, no se pisan).
- `playwright.config.ts` prende el backend en el puerto 3001 apuntando a esa
  base de prueba, y el frontend en el puerto 3002 apuntando a ese backend.
  La configuración tiene `reuseExistingServer: false`: los servidores de desarrollo
  deben estar detenidos y los puertos 3001 y 3002 libres. Playwright no reutiliza
  procesos existentes, para evitar escribir en la base de desarrollo.
- Cada test que necesita un usuario genera un email único (ver
  `support/test-data.ts`), así corridas repetidas no chocan entre sí con
  "ya existe esa cuenta".

## Carpeta

- `auth.spec.ts` — registro, login, persistencia de sesión, logout.
- `rooms.spec.ts` — crear sala, unirse con código, dos personas en la misma
  sala, código inexistente.
- `support/` — helpers compartidos (puertos/URLs, datos de prueba, llamadas
  directas a la API para preparar datos sin pasar por el formulario).

## Cuentas, invitados y llamadas

Crear una sala exige una cuenta autenticada. Los invitados pueden abrir su enlace
sin cuenta y deben confirmar un nombre antes de conectarse; el nombre no otorga
permisos de administrador. Los escenarios de salas confirman ese paso tanto para
cuentas registradas como para invitados.

La suite de navegador comprueba ingreso y chat sin iniciar llamadas reales a AWS.
Los tests unitarios de backend y cliente simulan Amazon Chime SDK. Para validar
el audio real se necesita acceso autorizado a Chime SDK, habilitar explícitamente
`AWS_CHIME_ENABLED=true` y una prueba manual entre dos navegadores con el mismo
enlace, según el README principal. El plan FREE del nuevo AWS experience no
habilita este servicio; instalar Agent Toolkit no modifica esa condición.
