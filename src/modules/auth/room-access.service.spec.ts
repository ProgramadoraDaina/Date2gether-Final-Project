import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { RoomAccessService } from './room-access.service';
import { RoomAccessGuard } from './guards/room-access.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const config = new ConfigService({ JWT_ACCESS_SECRET: 'room-access-test-secret' });
const jwt = new JwtService();
const access = new RoomAccessService(jwt, config);
const httpContext = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

// Resolver mínimo: una sola sala "room-1"/"abc-defg-hij" existe y es
// joinable; cualquier otro código es 404. assertBound replica la lógica
// real (403 si el roomId del participante no coincide con el de la sala).
const resolver = {
  resolveJoinable: vi.fn((code: string) => {
    if (code === 'abc-defg-hij') return { id: 'room-1', code };
    if (code === 'xyz-abcd-efg') return { id: 'room-2', code };
    throw new NotFoundException(`No existe una sala con el código "${code}"`);
  }),
  assertBound: vi.fn((participant: { roomId: string }, room: { id: string }) => {
    if (participant.roomId !== room.id) {
      throw new ForbiddenException('El acceso pertenece a otra sala');
    }
  }),
};

describe('Acceso de invitados con enlace', () => {
  it('emite un pase verificable sin cuenta y distingue nombres repetidos', async () => {
    const first = await access.create('room-1', 'abc-defg-hij', 'Alex');
    const second = await access.create('room-1', 'abc-defg-hij', 'Alex');
    const verified = await access.verify(first.token);
    expect(verified.name).toBe('Alex');
    expect(verified.roomId).toBe('room-1');
    expect(first.participant.userId).toBeUndefined();
    expect(first.participant.sub).not.toBe(second.participant.sub);
  });

  it('obtiene la cuenta del JWT y no del nombre elegido', async () => {
    const token = await jwt.signAsync(
      { sub: 'account-123', email: 'a@example.test' },
      { secret: 'room-access-test-secret' },
    );
    const result = await access.create('room-1', 'abc-defg-hij', 'Otro nombre', `Bearer ${token}`);
    expect(result.participant.userId).toBe('account-123');
    expect(result.participant.name).toBe('Otro nombre');
  });

  it('impide usar el pase de una sala para entrar a otra (D4: por roomId, no por código)', async () => {
    const { token } = await access.create('room-1', 'abc-defg-hij', 'Alex');
    const request = {
      headers: { authorization: `Bearer ${token}` },
      params: { roomCode: 'xyz-abcd-efg' },
    };
    await expect(
      new RoomAccessGuard(access, resolver as never).canActivate(httpContext(request)),
    ).rejects.toThrow(ForbiddenException);
    request.params.roomCode = 'abc-defg-hij';
    await expect(
      new RoomAccessGuard(access, resolver as never).canActivate(httpContext(request)),
    ).resolves.toBe(true);
  });

  it('un pase de sala no sirve como token de cuenta: ni pasa el JwtAuthGuard ni emite un nuevo pase de invitado', async () => {
    const { token } = await access.create('room-1', 'abc-defg-hij', 'Administrador');
    const request = { headers: { authorization: `Bearer ${token}` } };
    await expect(new JwtAuthGuard(jwt, config).canActivate(httpContext(request))).rejects.toThrow();
    await expect(
      access.create('room-2', 'xyz-abcd-efg', 'Alex', `Bearer ${token}`),
    ).rejects.toThrow();
  });

  it('rechaza tokens manipulados, de cuenta y expirados como pases de sala', async () => {
    await expect(access.verify('invalid')).rejects.toThrow();
    const account = await jwt.signAsync(
      { sub: 'user', email: 'a@example.test' },
      { secret: 'room-access-test-secret' },
    );
    await expect(access.verify(account)).rejects.toThrow();
    const expired = await jwt.signAsync(
      {
        kind: 'room-participant',
        sub: 'guest',
        roomId: 'room-1',
        roomCode: 'abc-defg-hij',
        name: 'Alex',
      },
      {
        secret: 'room-access-test-secret',
        audience: 'date2gether:rooms',
        expiresIn: -1,
      },
    );
    await expect(access.verify(expired)).rejects.toThrow();
  });

  it('[D4] rechaza un token legado sin roomId, deliberadamente -- no hay camino dual que lo acepte', async () => {
    const legacyToken = await jwt.signAsync(
      { kind: 'room-participant', sub: 'guest', roomCode: 'abc-defg-hij', name: 'Alex' },
      { secret: 'room-access-test-secret', audience: 'date2gether:rooms', expiresIn: '24h' },
    );
    await expect(access.verify(legacyToken)).rejects.toThrow();
  });

  it('un ticket de espera no habilita chat, llamadas ni acciones de cuenta y se limita a su solicitud', async () => {
    const ticket = await access.createAdmissionTicket('room-1', 'request-1');
    await expect(
      access.verifyAdmissionTicket(ticket, 'room-1', 'request-1'),
    ).resolves.toBeUndefined();
    await expect(access.verify(ticket)).rejects.toThrow();
    await expect(access.authenticateAccount('Bearer ' + ticket)).rejects.toThrow();
    await expect(access.verifyAdmissionTicket(ticket, 'room-2', 'request-1')).rejects.toThrow();
    await expect(access.verifyAdmissionTicket(ticket, 'room-1', 'request-2')).rejects.toThrow();
    await expect(
      new RoomAccessGuard(access, resolver as never).canActivate(
        httpContext({
          headers: { authorization: 'Bearer ' + ticket },
          params: { roomCode: 'abc-defg-hij' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('[D7] el ticket de una sala permanente vive 365d; el de una no permanente, 24h', async () => {
    const permanentTicket = await access.createAdmissionTicket('room-1', 'request-1', {
      permanent: true,
    });
    const decoded = jwt.decode<{ exp: number; iat: number }>(permanentTicket);
    const lifetimeDays = (decoded.exp - decoded.iat) / (60 * 60 * 24);
    expect(lifetimeDays).toBeCloseTo(365, 0);

    const temporaryTicket = await access.createAdmissionTicket('room-1', 'request-2', {
      permanent: false,
    });
    const decodedTemp = jwt.decode<{ exp: number; iat: number }>(temporaryTicket);
    const lifetimeHours = (decodedTemp.exp - decodedTemp.iat) / (60 * 60);
    expect(lifetimeHours).toBeCloseTo(24, 0);
  });
});
