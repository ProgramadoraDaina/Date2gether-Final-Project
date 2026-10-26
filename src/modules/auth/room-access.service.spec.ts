import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { RoomAccessService } from './room-access.service';
import { RoomAccessGuard } from './guards/room-access.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const config = new ConfigService({ JWT_ACCESS_SECRET: 'room-access-test-secret' });
const jwt = new JwtService();
const access = new RoomAccessService(jwt, config);
const httpContext = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('Acceso de invitados con enlace', () => {
  it('emite un pase verificable sin cuenta y distingue nombres repetidos', async () => {
    const first = await access.create('abc-defg-hij', 'Alex');
    const second = await access.create('abc-defg-hij', 'Alex');
    expect((await access.verify(first.token)).name).toBe('Alex');
    expect(first.participant.userId).toBeUndefined();
    expect(first.participant.sub).not.toBe(second.participant.sub);
  });

  it('obtiene la cuenta del JWT y no del nombre elegido', async () => {
    const token = await jwt.signAsync(
      { sub: 'account-123', email: 'a@example.test' },
      { secret: 'room-access-test-secret' },
    );
    const result = await access.create('abc-defg-hij', 'Otro nombre', `Bearer ${token}`);
    expect(result.participant.userId).toBe('account-123');
    expect(result.participant.name).toBe('Otro nombre');
  });

  it('impide usar el pase de una sala para llamar en otra', async () => {
    const { token } = await access.create('abc-defg-hij', 'Alex');
    const request = {
      headers: { authorization: `Bearer ${token}` },
      params: { roomCode: 'xyz-abcd-efg' },
    };
    await expect(new RoomAccessGuard(access).canActivate(httpContext(request))).rejects.toThrow(
      ForbiddenException,
    );
    request.params.roomCode = 'abc-defg-hij';
    await expect(new RoomAccessGuard(access).canActivate(httpContext(request))).resolves.toBe(true);
  });

  it('no permite que un pase de sala cree reuniones o se convierta en una cuenta', async () => {
    const { token } = await access.create('abc-defg-hij', 'Administrador');
    const request = { headers: { authorization: `Bearer ${token}` } };
    await expect(new JwtAuthGuard(jwt, config).canActivate(httpContext(request))).rejects.toThrow();
    await expect(access.create('xyz-abcd-efg', 'Alex', `Bearer ${token}`)).rejects.toThrow();
  });

  it('rechaza tokens manipulados, de cuenta y expirados como pases de sala', async () => {
    await expect(access.verify('invalid')).rejects.toThrow();
    const account = await jwt.signAsync(
      { sub: 'user', email: 'a@example.test' },
      { secret: 'room-access-test-secret' },
    );
    await expect(access.verify(account)).rejects.toThrow();
    const expired = await jwt.signAsync(
      { kind: 'room-participant', sub: 'guest', roomCode: 'abc-defg-hij', name: 'Alex' },
      {
        secret: 'room-access-test-secret',
        audience: 'date2gether:rooms',
        expiresIn: -1,
      },
    );
    await expect(access.verify(expired)).rejects.toThrow();
  });
});
