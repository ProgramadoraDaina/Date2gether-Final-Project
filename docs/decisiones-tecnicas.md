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
