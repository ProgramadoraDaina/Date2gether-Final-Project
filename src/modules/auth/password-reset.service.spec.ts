import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { User } from '../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import type { MailService } from './mail.service';
import { PasswordResetService } from './password-reset.service';

const CONFIG = {
  JWT_ACCESS_SECRET: 'access-secret-de-test-no-usar-en-produccion',
  APP_URL: 'https://app.example.test',
};

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ana@example.test',
    passwordHash: '$2b$12$hash-original-de-la-cuenta-de-ana',
    name: 'Ana',
    nameColor: null,
    avatar: null,
    role: 'user',
    callHistoryDeletedBefore: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function linkToken(text: string): string {
  const match = /reset-password\?token=([\w.-]+)/.exec(text);
  if (!match) throw new Error('sin link en el email');
  return match[1];
}

describe('PasswordResetService', () => {
  let db: FakeDb;
  let send: ReturnType<typeof vi.fn>;
  let configured: boolean;
  let service: PasswordResetService;

  beforeEach(() => {
    db = createFakeDb();
    send = vi.fn().mockResolvedValue(undefined);
    configured = true;
    const mail = { send, isConfigured: () => configured } as unknown as MailService;
    service = new PasswordResetService(
      db as unknown as DrizzleDb,
      new JwtService(),
      new ConfigService(CONFIG),
      mail,
    );
  });

  it('manda un email con un link a /reset-password a la cuenta que lo pide', async () => {
    db.select.mockReturnValueOnce(chain([buildUser()]));

    await service.requestReset('Ana@Example.test');

    expect(send).toHaveBeenCalledTimes(1);
    const [to, subject, text] = send.mock.calls[0] as [string, string, string];
    expect(to).toBe('ana@example.test');
    expect(subject).toBe('Cambiá tu contraseña de Date2gether');
    expect(text).toContain('https://app.example.test/reset-password?token=');
  });

  it('si el email no tiene cuenta no manda nada ni avisa (no revela qué cuentas existen)', async () => {
    db.select.mockReturnValueOnce(chain([]));

    await expect(service.requestReset('nadie@example.test')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('sin SMTP configurado responde 503 antes de buscar la cuenta', async () => {
    configured = false;

    await expect(service.requestReset('ana@example.test')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it('el link cambia la contraseña, la guarda con hash y cierra las sesiones abiertas', async () => {
    const user = buildUser();
    db.select.mockReturnValueOnce(chain([user]));
    await service.requestReset(user.email);
    const token = linkToken(send.mock.calls[0][2] as string);
    db.select.mockReturnValueOnce(chain([user]));
    const usersUpdate = chain([]);
    const tokensUpdate = chain([]);
    db.update.mockReturnValueOnce(usersUpdate).mockReturnValueOnce(tokensUpdate);

    await service.resetPassword(token, 'NuevaClave123');

    const saved = usersUpdate.set.mock.calls[0][0] as { passwordHash: string };
    expect(saved.passwordHash).not.toBe('NuevaClave123');
    expect(await bcrypt.compare('NuevaClave123', saved.passwordHash)).toBe(true);
    const revoked = tokensUpdate.set.mock.calls[0][0] as { revokedAt: Date };
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it('el link sirve una sola vez: después de cambiar la contraseña ya no vale', async () => {
    const user = buildUser();
    db.select.mockReturnValueOnce(chain([user]));
    await service.requestReset(user.email);
    const token = linkToken(send.mock.calls[0][2] as string);
    db.select.mockReturnValueOnce(chain([{ ...user, passwordHash: '$2b$12$hash-nuevo' }]));

    await expect(service.resetPassword(token, 'OtraClave456')).rejects.toThrow(
      'El link para cambiar la contraseña venció o ya se usó',
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rechaza un link inventado o vencido', async () => {
    const expired = await new JwtService().signAsync(
      { sub: 'user-1', purpose: 'password-reset' },
      { secret: CONFIG.JWT_ACCESS_SECRET + buildUser().passwordHash, expiresIn: -10 },
    );
    db.select.mockReturnValue(chain([buildUser()]));

    await expect(service.resetPassword('no-es-un-token', 'Clave1234')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.resetPassword(expired, 'Clave1234')).rejects.toThrow(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('un token de sesión normal no sirve para cambiar la contraseña', async () => {
    const user = buildUser();
    const accessLike = await new JwtService().signAsync(
      { sub: user.id, email: user.email },
      { secret: CONFIG.JWT_ACCESS_SECRET + user.passwordHash },
    );
    db.select.mockReturnValueOnce(chain([user]));

    await expect(service.resetPassword(accessLike, 'Clave1234')).rejects.toThrow(
      BadRequestException,
    );
  });
});
