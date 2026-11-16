import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema';

// Same disposable Postgres used by the Playwright e2e suite (see
// docker-compose.test.yml + e2e/support/env.ts). Duplicated here rather than
// imported because e2e/ sits outside Jest's rootDir ("src") — not a secret,
// just a local-only test value (same reasoning as e2e/support/env.ts).
export const TEST_DATABASE_URL = 'postgresql://test:test@localhost:5433/date2gether_test';

/**
 * Real Drizzle connection to the disposable test Postgres (design.md's
 * "Testing notes for sdd-tasks": the partial unique index and the
 * retirement sweep are half the correctness mechanism and mocked Drizzle
 * cannot exercise either). Requires `pnpm test:e2e:setup` to have run.
 */
export function connectTestDb(): {
  db: PostgresJsDatabase<typeof schema>;
  close: () => Promise<void>;
} {
  const client = postgres(TEST_DATABASE_URL, { max: 1 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
