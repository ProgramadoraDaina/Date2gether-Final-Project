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
  Si ya tenés esos puertos corriendo localmente (tu `pnpm start:dev` /
  `pnpm dev:client` de siempre), Playwright los reutiliza en vez de levantar
  los suyos — asegurate de que esos procesos también apunten a la base de
  prueba si vas a correr los tests así, o vas a terminar probando contra tu
  base de desarrollo sin querer.
- Cada test que necesita un usuario genera un email único (ver
  `support/test-data.ts`), así corridas repetidas no chocan entre sí con
  "ya existe esa cuenta".

## Carpeta

- `auth.spec.ts` — registro, login, persistencia de sesión, logout.
- `rooms.spec.ts` — crear sala, unirse con código, dos personas en la misma
  sala, código inexistente.
- `support/` — helpers compartidos (puertos/URLs, datos de prueba, llamadas
  directas a la API para preparar datos sin pasar por el formulario).
