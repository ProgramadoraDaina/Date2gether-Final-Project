// Import estático (no require): así TypeScript toma la ampliación de tipos
// de jest-dom para los matchers (toBeInTheDocument, etc). Se usa el entrypoint
// `/jest-globals`, no el genérico: los specs importan `expect` desde
// `@jest/globals` (no el global implícito de Jest), y solo ese entrypoint
// amplía el tipo `Matchers` de ese módulo. El orden respecto a los polyfills
// de abajo no importa.
import '@testing-library/jest-dom/jest-globals';

// jest-environment-jsdom no implementa TextEncoder/TextDecoder ni la Fetch API.
// Se usa require() (no import) para garantizar que estos polyfills corren
// en orden, antes de que cualquier otro módulo los necesite al cargarse.
const { TextDecoder, TextEncoder } = require('node:util');
const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
const { MessagePort } = require('node:worker_threads');
Object.assign(globalThis, {
  TextDecoder,
  TextEncoder,
  ReadableStream,
  WritableStream,
  TransformStream,
  // Solo MessagePort (undici lo necesita para sus checks de webidl).
  // OJO: no se toca MessageChannel. React usa MessageChannel internamente
  // para su scheduler, y la implementación real de Node (basada en
  // worker_threads) no está integrada con el event loop simulado de
  // jsdom/Jest. Sobreescribirla cuelga renderHook()/act() indefinidamente.
  MessagePort,
});

const { fetch, Headers, Request, Response } = require('undici');
Object.assign(globalThis, { fetch, Headers, Request, Response });

// jsdom no implementa Element.scrollTo (no hay layout real que scrollear).
Element.prototype.scrollTo = jest.fn();
