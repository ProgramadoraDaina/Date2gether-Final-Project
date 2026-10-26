import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { RoomAccessService } from '../room-access.service';
import { WsJwtAuthGuard } from './ws-jwt-auth.guard';

const access = new RoomAccessService(
  new JwtService(),
  new ConfigService({ JWT_ACCESS_SECRET: 'ws-test-secret' }),
);
const guard = new WsJwtAuthGuard(access);
function context(token?: string, code = 'abc-defg-hij') {
  const client = { handshake: { auth: { token } }, data: {} };
  return {
    client,
    ctx: {
      switchToWs: () => ({ getClient: () => client, getData: () => ({ code }) }),
    } as unknown as ExecutionContext,
  };
}

describe('WsJwtAuthGuard', () => {
  it('permite un invitado con nombre y conserva la identidad verificada', async () => {
    const issued = await access.create('abc-defg-hij', 'Invitado');
    const { client, ctx } = context(issued.token);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(client.data).toMatchObject({ participant: issued.participant });
  });
  it('rechaza sockets sin pase, con pase inválido o de otra sala', async () => {
    await expect(guard.canActivate(context().ctx)).rejects.toThrow();
    await expect(guard.canActivate(context('invalid').ctx)).rejects.toThrow();
    const issued = await access.create('abc-defg-hij', 'Invitado');
    await expect(guard.canActivate(context(issued.token, 'xyz-abcd-efg').ctx)).rejects.toThrow();
  });
});
