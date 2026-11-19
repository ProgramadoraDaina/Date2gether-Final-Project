import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { TEST_DATABASE_URL } from '../test-support/test-database';

const here = dirname(fileURLToPath(import.meta.url));
const DOWN_MIGRATION_PATH = join(
  here,
  '../../drizzle/rollback/0016_permanent_scheduled_rooms.down.sql',
);
const DOWN_MIGRATION_SQL = readFileSync(DOWN_MIGRATION_PATH, 'utf8');

// Task 6.2 (design.md D3): the proposal's own checklist item -- "run the
// duplicate query before trusting the down path" -- made into an
// executable assertion. Runs the actual rollback SQL file against the real
// test Postgres; mocked Drizzle cannot exercise a raw multi-statement
// script with DO blocks.
describe('0016 down-migration self-gating (real Postgres)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(TEST_DATABASE_URL, { max: 1 });
  });

  afterAll(async () => {
    await sql.end();
  });

  async function columnsStillExist(): Promise<boolean> {
    const [row] = await sql<{ count: string }[]>`
      select count(*)::text as count
        from information_schema.columns
       where table_name = 'rooms'
         and column_name in ('is_permanent', 'last_entered_at', 'retired_at')
    `;
    return Number(row.count) === 3;
  }

  async function slotsTableStillExists(): Promise<boolean> {
    const [row] = await sql<{ exists: boolean }[]>`
      select exists(
        select 1 from information_schema.tables where table_name = 'room_schedule_slots'
      ) as exists
    `;
    return row.exists;
  }

  // The down-migration's own BEGIN never reaches a COMMIT or ROLLBACK when
  // a gate aborts it -- the connection is left in "aborted transaction,
  // commands ignored" state. Running it on a throwaway connection and
  // closing that connection immediately afterward (instead of trying to
  // recover the shared one with an explicit ROLLBACK) is the simplest way
  // to avoid leaking that state into the next query on `sql`.
  async function runDownMigrationExpectingFailure(): Promise<unknown> {
    const scoped = postgres(TEST_DATABASE_URL, { max: 1 });
    try {
      await scoped.unsafe(DOWN_MIGRATION_SQL);
      throw new Error('Expected the down migration to abort, but it succeeded');
    } catch (error) {
      return error;
    } finally {
      await scoped.end();
    }
  }

  describe('Gate 1 — duplicated code', () => {
    const roomIds: string[] = [];
    const duplicatedCode = `g1-${randomUUID().slice(0, 8)}`;

    afterEach(async () => {
      while (roomIds.length > 0) {
        await sql`delete from rooms where id = ${roomIds.pop()!}`;
      }
    });

    it('aborts the whole transaction and leaves the schema untouched', async () => {
      // Simulates pre-existing corrupt data via raw SQL, bypassing the
      // app-level resolver (D4) that would normally prevent this: one
      // retired room and one active room sharing a code -- exactly what
      // code recycling produces, and exactly what Gate 1 must catch before
      // trying to restore the global UNIQUE(code) constraint.
      const [retired] = await sql<{ id: string }[]>`
        insert into rooms (code, name, retired_at)
        values (${duplicatedCode}, 'Retired room', now())
        returning id
      `;
      const [active] = await sql<{ id: string }[]>`
        insert into rooms (code, name) values (${duplicatedCode}, 'Active room') returning id
      `;
      roomIds.push(retired.id, active.id);

      const error = await runDownMigrationExpectingFailure();
      expect(error).toMatchObject({ message: expect.stringMatching(/duplicated/i) });
      expect(await columnsStillExist()).toBe(true);
      expect(await slotsTableStillExists()).toBe(true);
    });
  });

  describe('Gate 2 — TTL-free admission request', () => {
    const roomIds: string[] = [];
    const requestIds: string[] = [];

    afterEach(async () => {
      while (requestIds.length > 0) {
        await sql`delete from room_admission_requests where id = ${requestIds.pop()!}`;
      }
      while (roomIds.length > 0) {
        await sql`delete from rooms where id = ${roomIds.pop()!}`;
      }
    });

    it('aborts before reaching the destructive statements when a TTL-free request exists', async () => {
      const [room] = await sql<{ id: string }[]>`
        insert into rooms (code, name, is_permanent, waiting_room_enabled)
        values (${`g2-${randomUUID().slice(0, 8)}`}, 'Permanent room', true, true)
        returning id
      `;
      roomIds.push(room.id);
      const requestId = randomUUID();
      await sql`
        insert into room_admission_requests (id, room_id, name, expires_at)
        values (${requestId}, ${room.id}, 'Ana', null)
      `;
      requestIds.push(requestId);

      const error = await runDownMigrationExpectingFailure();
      expect(error).toMatchObject({ message: expect.stringMatching(/no TTL/i) });
      expect(await columnsStillExist()).toBe(true);
      expect(await slotsTableStillExists()).toBe(true);
    });
  });
});
