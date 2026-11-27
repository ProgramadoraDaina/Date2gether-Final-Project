import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { refreshTokens, users, type User } from '../../db/schema';
import { MailService } from './mail.service';

const PURPOSE = 'password-reset';
const PASSWORD_SALT_ROUNDS = 12;
const INVALID_LINK = 'El link para cambiar la contraseña venció o ya se usó';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async requestReset(email: string): Promise<void> {
    if (!this.mail.isConfigured()) {
      throw new ServiceUnavailableException('El envío de emails no está configurado');
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    if (!user) return;

    const token = await this.jwt.signAsync(
      { sub: user.id, purpose: PURPOSE },
      { secret: this.secretFor(user), expiresIn: '30m' },
    );
    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:3002').replace(
      /\/$/,
      '',
    );
    const link = `${appUrl}/reset-password?token=${token}`;
    const text = [
      `Hola ${user.name}:`,
      '',
      'Pediste cambiar tu contraseña de Date2gether. Entrá a este link para elegir una nueva:',
      link,
      '',
      'El link vence en 30 minutos y sirve una sola vez. Si no lo pediste, ignorá este email.',
    ].join('\n');
    const html = `<p>Hola ${escapeHtml(user.name)}:</p><p>Pediste cambiar tu contraseña de Date2gether.</p><p><a href="${link}">Elegir una contraseña nueva</a></p><p>El link vence en 30 minutos y sirve una sola vez. Si no lo pediste, ignorá este email.</p>`;
    try {
      await this.mail.send(user.email, 'Cambiá tu contraseña de Date2gether', text, html);
    } catch {
      this.logger.warn('No se pudo enviar el email de recuperación');
      throw new ServiceUnavailableException(
        'No se pudo enviar el email. Probá de nuevo más tarde.',
      );
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const decoded = this.jwt.decode<{ sub?: string } | null>(token);
    if (!decoded?.sub) throw new BadRequestException(INVALID_LINK);
    const [user] = await this.db.select().from(users).where(eq(users.id, decoded.sub)).limit(1);
    if (!user) throw new BadRequestException(INVALID_LINK);
    try {
      const payload = await this.jwt.verifyAsync<{ purpose?: string }>(token, {
        secret: this.secretFor(user),
      });
      if (payload.purpose !== PURPOSE) throw new Error('purpose');
    } catch {
      throw new BadRequestException(INVALID_LINK);
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, user.id));
  }

  // Signing with the current hash makes the link single-use: changing the password invalidates it.
  private secretFor(user: User): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET') + user.passwordHash;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
