import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { RefreshToken, User } from '../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import { AuthService } from './auth.service';

const CONFIG = {
  JWT_ACCESS_SECRET: 'access-secret-de-test-no-usar-en-produccion',
  JWT_REFRESH_SECRET: 'refresh-secret-de-test-no-usar-en-produccion',
};

const signingJwt = new JwtService();
const userId = 'user-1';
const jti = 'refresh-jti-1';

function signRefreshToken(payload: { sub: string; jti: string } = { sub: userId, jti }) {
  return signingJwt.signAsync(payload, { secret: CONFIG.JWT_REFRESH_SECRET, expiresIn: '7d' });
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: userId,
    email: 'ana@example.test',
    passwordHash: 'reemplazado-en-cada-test',
    name: 'Ana',
    createdAt: new Date(),
    ...overrides,
  };
}

function buildStoredToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: jti,
    userId,
    tokenHash: 'reemplazado-en-cada-test',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let db: FakeDb;
  let service: AuthService;

  beforeEach(() => {
    db = createFakeDb();
    service = new AuthService(
      db as unknown as DrizzleDb,
      new JwtService(),
      new ConfigService(CONFIG),
    );
  });

  describe('register', () => {
    it('hashea el password, nunca lo guarda en texto plano, y guarda el email en minúsculas', async () => {
      db.select.mockReturnValueOnce(chain([])); // no existe cuenta previa con ese email
      const created = buildUser();
      const usersInsert = chain([created]);
      const refreshInsert = chain([]);
      db.insert.mockReturnValueOnce(usersInsert).mockReturnValueOnce(refreshInsert);

      const result = await service.register({
        email: 'Ana@Example.test',
        password: 'clave1234',
        name: 'Ana',
      });

      const insertedUser = usersInsert.values.mock.calls[0][0] as {
        email: string;
        passwordHash: string;
      };
      expect(insertedUser.email).toBe('ana@example.test');
      expect(insertedUser.passwordHash).not.toBe('clave1234');
      expect(await bcrypt.compare('clave1234', insertedUser.passwordHash)).toBe(true);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('rechaza el registro si ya existe una cuenta con ese email', async () => {
      db.select.mockReturnValueOnce(chain([buildUser()]));

      await expect(
        service.register({ email: 'ana@example.test', password: 'clave1234', name: 'Ana' }),
      ).rejects.toThrow(ConflictException);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rechaza con el mismo mensaje tanto si el email no existe como si el password es incorrecto', async () => {
      db.select.mockReturnValueOnce(chain([]));
      const noAccountError = await service
        .login({ email: 'nadie@example.test', password: 'clave1234' })
        .catch((e: unknown) => e);

      const hash = await bcrypt.hash('clave-correcta', 12);
      db.select.mockReturnValueOnce(chain([buildUser({ passwordHash: hash })]));
      const wrongPasswordError = await service
        .login({ email: 'ana@example.test', password: 'clave-incorrecta' })
        .catch((e: unknown) => e);

      expect(noAccountError).toBeInstanceOf(UnauthorizedException);
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect((noAccountError as Error).message).toBe((wrongPasswordError as Error).message);
    });

    it('devuelve tokens y el usuario público cuando las credenciales son correctas', async () => {
      const hash = await bcrypt.hash('clave1234', 12);
      db.select.mockReturnValueOnce(chain([buildUser({ passwordHash: hash })]));
      db.insert.mockReturnValueOnce(chain([]));

      const result = await service.login({ email: 'ana@example.test', password: 'clave1234' });

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });
  });

  describe('refresh', () => {
    it('rechaza un token de refresco inválido o inexistente', async () => {
      await expect(service.refresh('token-invalido')).rejects.toThrow(UnauthorizedException);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('rechaza un token que no está en la base (ya fue revocado y eliminado, o nunca existió)', async () => {
      const token = await signRefreshToken();
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException);
    });

    it('si el token ya fue revocado (reuso), revoca todos los tokens del usuario y rechaza', async () => {
      const token = await signRefreshToken();
      const stored = buildStoredToken({
        tokenHash: await bcrypt.hash(token, 10),
        revokedAt: new Date(),
      });
      db.select.mockReturnValueOnce(chain([stored]));
      const revokeAllChain = chain([]);
      db.update.mockReturnValueOnce(revokeAllChain);

      await expect(service.refresh(token)).rejects.toThrow('reutilizado');
      expect(revokeAllChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('rechaza un token de refresco expirado', async () => {
      const token = await signRefreshToken();
      const stored = buildStoredToken({
        tokenHash: await bcrypt.hash(token, 10),
        expiresAt: new Date(Date.now() - 1000),
      });
      db.select.mockReturnValueOnce(chain([stored]));

      await expect(service.refresh(token)).rejects.toThrow('expirado');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('rota el token en éxito: revoca el anterior y emite uno nuevo', async () => {
      const token = await signRefreshToken();
      const stored = buildStoredToken({ tokenHash: await bcrypt.hash(token, 10) });
      db.select.mockReturnValueOnce(chain([stored])); // storedToken
      const revokeChain = chain([]);
      db.update.mockReturnValueOnce(revokeChain); // revokeToken(storedToken.id)
      db.select.mockReturnValueOnce(chain([buildUser()])); // usuario dueño del token
      db.insert.mockReturnValueOnce(chain([])); // nuevo refresh token

      const result = await service.refresh(token);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(revokeChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('logout', () => {
    it('es idempotente: no lanza aunque el token ya sea inválido', async () => {
      await expect(service.logout('token-invalido')).resolves.toBeUndefined();
    });

    it('revoca el token cuando es válido', async () => {
      const token = await signRefreshToken();
      const revokeChain = chain([]);
      db.update.mockReturnValueOnce(revokeChain);

      await service.logout(token);

      expect(revokeChain.where).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('lanza NotFoundException si el usuario no existe', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getProfile('no-existe')).rejects.toThrow(NotFoundException);
    });

    it('nunca devuelve el passwordHash', async () => {
      db.select.mockReturnValueOnce(chain([buildUser()]));

      const profile = await service.getProfile(userId);

      expect(profile).not.toHaveProperty('passwordHash');
    });
  });
});
