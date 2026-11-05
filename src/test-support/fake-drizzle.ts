import { jest } from '@jest/globals';

const CHAIN_METHODS = [
  'from',
  'where',
  'limit',
  'orderBy',
  'innerJoin',
  'values',
  'set',
  'returning',
  'onConflictDoNothing',
] as const;

type ChainMethodName = (typeof CHAIN_METHODS)[number];
type AnyMock = ReturnType<typeof jest.fn>;

// Cadena fake de Drizzle: cada método encadenable devuelve la misma cadena, y
// awaitearla en cualquier punto (el código de producción no siempre llama a
// los mismos métodos al final) resuelve siempre al resultado configurado.
export function chain<T>(result: T) {
  const self = {} as Record<ChainMethodName, AnyMock> & {
    then: Promise<T>['then'];
  };
  for (const method of CHAIN_METHODS) {
    self[method] = jest.fn(() => self);
  }
  self.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
  return self;
}

export function createFakeDb() {
  return {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
