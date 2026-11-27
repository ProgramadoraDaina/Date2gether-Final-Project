import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { TranscriptHistoryController } from '../transcripts/transcript-history.controller';
import { TranscriptHistoryService } from '../transcripts/transcript-history.service';
import { BreakoutRoomsController } from './breakout-rooms.controller';
import { BreakoutRoomsService } from './breakout-rooms.service';
import { CallTimelineController } from './call-timeline.controller';
import { CallTimelineService } from './call-timeline.service';

const VALID_ID = '7b0e2f4c-1d3a-4c5b-9e6f-0a1b2c3d4e5f';

const timeline = { getSessionTimeline: vi.fn(() => Promise.resolve([])) };
const transcripts = { getForSession: vi.fn(() => Promise.resolve([])) };
const breakouts = {
  updatePolicy: vi.fn(() => Promise.resolve({})),
  moveIn: vi.fn(() => Promise.resolve({})),
  issueBreakoutToken: vi.fn(() => Promise.resolve({})),
  selfReturn: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
};

type HttpContext = { switchToHttp: () => { getRequest: () => Record<string, unknown> } };

const signedIn = {
  canActivate: (context: HttpContext) => {
    context.switchToHttp().getRequest().user = { sub: 'u1' };
    return true;
  },
};

const roomAccess = {
  canActivate: (context: HttpContext) => {
    const request = context.switchToHttp().getRequest();
    request.room = { id: 'room-id', code: 'abc-defg-hij' };
    request.participant = { sub: 'p1', name: 'Ana' };
    return true;
  },
};

let app: INestApplication | undefined;

async function startApp(): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    controllers: [CallTimelineController, TranscriptHistoryController, BreakoutRoomsController],
    providers: [
      { provide: CallTimelineService, useValue: timeline },
      { provide: TranscriptHistoryService, useValue: transcripts },
      { provide: BreakoutRoomsService, useValue: breakouts },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(signedIn)
    .overrideGuard(RoomAccessGuard)
    .useValue(roomAccess)
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  return app.getUrl();
}

async function status(url: string, method = 'GET'): Promise<number> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ livekitIdentity: 'p1' }),
  });
  return res.status;
}

describe('IDs mal formados en la URL', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await app?.close();
    app = undefined;
  });

  it('las rutas de sesión responden 400 sin llegar a la base', async () => {
    const base = await startApp();

    expect(await status(`${base}/calls/sessions/no-es-uuid/timeline`)).toBe(400);
    expect(await status(`${base}/calls/sessions/no-es-uuid/transcript`)).toBe(400);
    expect(timeline.getSessionTimeline).not.toHaveBeenCalled();
    expect(transcripts.getForSession).not.toHaveBeenCalled();
  });

  it('las rutas de una mini sala responden 400 sin llegar a la base', async () => {
    const base = await startApp();
    const prefix = `${base}/calls/abc-defg-hij/breakouts/no-es-uuid`;

    expect(await status(prefix, 'PATCH')).toBe(400);
    expect(await status(`${prefix}/participants`, 'POST')).toBe(400);
    expect(await status(`${prefix}/token`, 'POST')).toBe(400);
    expect(await status(`${prefix}/return`, 'POST')).toBe(400);
    expect(await status(prefix, 'DELETE')).toBe(400);
    expect(breakouts.close).not.toHaveBeenCalled();
  });

  it('un ID válido sigue llegando al servicio', async () => {
    const base = await startApp();

    expect(await status(`${base}/calls/sessions/${VALID_ID}/timeline`)).toBe(200);
    expect(await status(`${base}/calls/sessions/${VALID_ID}/transcript`)).toBe(200);
    expect(await status(`${base}/calls/abc-defg-hij/breakouts/${VALID_ID}`, 'DELETE')).toBe(204);
    expect(timeline.getSessionTimeline).toHaveBeenCalledWith(VALID_ID, 'u1');
    expect(breakouts.close).toHaveBeenCalledTimes(1);
  });
});
