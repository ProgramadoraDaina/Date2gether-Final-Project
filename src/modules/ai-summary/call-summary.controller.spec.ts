import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ParseUUIDPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallSummaryController } from './call-summary.controller';
import type { CallSummaryService } from './call-summary.service';
import { GenerateSummaryDto } from './dto/generate-summary.dto';

const user = { sub: 'user-1' } as AccessTokenPayload;

describe('CallSummaryController', () => {
  const service = {
    get: vi.fn().mockResolvedValue({ summary: null }),
    generate: vi.fn().mockResolvedValue({ summary: null }),
  };
  const controller = new CallSummaryController(service as unknown as CallSummaryService);

  it('requires an authenticated account', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CallSummaryController)).toEqual([JwtAuthGuard]);
  });

  it('uses the user id from the token, never from the request', async () => {
    await controller.get('session-1', user);
    expect(service.get).toHaveBeenCalledWith('session-1', 'user-1');
    await controller.generate('session-1', Object.assign(new GenerateSummaryDto(), { language: 'en' }), user);
    expect(service.generate).toHaveBeenCalledWith('session-1', 'user-1', 'en');
  });

  it('defaults the language to es', async () => {
    await controller.generate('session-1', new GenerateSummaryDto(), user);
    expect(service.generate).toHaveBeenLastCalledWith('session-1', 'user-1', 'es');
  });

  it('applies a stricter throttle (5 per minute) to the generate endpoint only', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', CallSummaryController.prototype.generate)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', CallSummaryController.prototype.generate)).toBe(60_000);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', CallSummaryController.prototype.get)).toBeUndefined();
  });

  it.each(['get', 'generate'] as const)('validates the sessionId as a UUID on %s', async (method) => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, CallSummaryController, method) as Record<
      string,
      { data: string; pipes: unknown[] }
    >;
    const param = Object.values(args).find((arg) => arg.data === 'sessionId');
    expect(param?.pipes).toContain(ParseUUIDPipe);
    await expect(
      new ParseUUIDPipe().transform('not-a-uuid', { type: 'param', data: 'sessionId' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('validates the language: only es or en', async () => {
    const ok = await validate(plainToInstance(GenerateSummaryDto, { language: 'en' }));
    const empty = await validate(plainToInstance(GenerateSummaryDto, {}));
    const bad = await validate(plainToInstance(GenerateSummaryDto, { language: 'fr' }));
    expect(ok).toHaveLength(0);
    expect(empty).toHaveLength(0);
    expect(bad).toHaveLength(1);
  });
});
