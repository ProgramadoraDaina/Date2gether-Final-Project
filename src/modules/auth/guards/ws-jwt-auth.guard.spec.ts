import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { WsException } from '@nestjs/websockets';
import type { ExecutionContext } from '@nestjs/common';
import { WsJwtAuthGuard } from './ws-jwt-auth.guard';

function contextWithToken(token: string | undefined): ExecutionContext {
  const client = { handshake: { auth: { token } } };
  return {
    switchToWs: () => ({ getClient: () => client }),
  } as unknown as ExecutionContext;
}

describe('WsJwtAuthGuard', () => {
  let jwtService: { verifyAsync: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
  let configService: { getOrThrow: jest.Mock<(...args: unknown[]) => string> };
  let guard: WsJwtAuthGuard;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    configService = {
      getOrThrow: jest.fn<(...args: unknown[]) => string>().mockReturnValue('access-secret'),
    };
    guard = new WsJwtAuthGuard(jwtService as never, configService as never);
  });

  it('rechaza la conexión si el handshake no trae token', async () => {
    const context = contextWithToken(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(WsException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rechaza la conexión si el token es inválido o expiró', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
    const context = contextWithToken('token-invalido');

    await expect(guard.canActivate(context)).rejects.toThrow(WsException);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token-invalido', {
      secret: 'access-secret',
    });
  });

  it('permite la conexión y adjunta el payload al socket si el token es válido', async () => {
    const payload = { sub: 'user-1', email: 'user@example.com' };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const client: { handshake: { auth: { token: string } }; user?: unknown } = {
      handshake: { auth: { token: 'token-valido' } },
      user: undefined,
    };
    const context = {
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(client.user).toEqual(payload);
  });
});
