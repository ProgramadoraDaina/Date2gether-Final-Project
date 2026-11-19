// Cada corrida de tests necesita emails "nuevos": si dos tests (o dos corridas
// seguidas) usaran el mismo email, el segundo registro fallaría con "ya existe
// esa cuenta" y el test se volvería intermitente. Por eso generamos uno único
// cada vez, combinando la hora actual con un sufijo random.
export function uniqueEmail(prefix = 'e2e'): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}+${Date.now()}-${suffix}@example.com`;
}

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

// Usuario de prueba "de molde": cumple los requisitos del formulario de
// registro (mínimo 8 caracteres, al menos una letra y un número).
export function buildTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    email: uniqueEmail(),
    password: 'Password123',
    name: 'Usuaria de Prueba',
    ...overrides,
  };
}
