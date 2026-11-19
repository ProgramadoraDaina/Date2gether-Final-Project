import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { refreshTokens, users, type NameColor, type User } from '../../db/schema';
import type { AccessTokenPayload, AuthTokens, RefreshTokenPayload } from './auth.types';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const PASSWORD_SALT_ROUNDS = 12;
const REFRESH_TOKEN_HASH_ROUNDS = 10;

type PublicUser = Omit<User, 'passwordHash'>;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens & { user: PublicUser }> {
    const existing = await this.findUserByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    const [user] = await this.db
      .insert(users)
      .values({ email: dto.email.toLowerCase(), passwordHash, name: dto.name })
      .returning();

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async login(dto: LoginDto): Promise<AuthTokens & { user: PublicUser }> {
    const user = await this.findUserByEmail(dto.email);
    const passwordMatches = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: this.toPublicUser(user) };
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(rawRefreshToken);

    const [storedToken] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, payload.jti))
      .limit(1);

    if (!storedToken) {
      throw new UnauthorizedException('Token de refresco inválido');
    }

    if (storedToken.revokedAt) {
      // El token ya se usó o fue revocado: posible robo/reuso. Se revocan todos los
      // tokens activos del usuario para forzar un nuevo inicio de sesión.
      await this.revokeAllUserTokens(storedToken.userId);
      throw new UnauthorizedException(
        'Token de refresco reutilizado, sesión cerrada por seguridad',
      );
    }

    if (storedToken.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Token de refresco expirado');
    }

    const hashMatches = await bcrypt.compare(rawRefreshToken, storedToken.tokenHash);
    if (!hashMatches) {
      throw new UnauthorizedException('Token de refresco inválido');
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    await this.revokeToken(storedToken.id);
    return this.issueTokens(user);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    try {
      const payload = await this.verifyRefreshToken(rawRefreshToken);
      await this.revokeToken(payload.jti);
    } catch {
      // Un token ya inválido/expirado no necesita revocarse: el logout es idempotente.
    }
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return this.toPublicUser(user);
  }

  async updateNameColor(userId: string, nameColor: NameColor): Promise<PublicUser> {
    const [user] = await this.db
      .update(users)
      .set({ nameColor })
      .where(eq(users.id, userId))
      .returning();
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return this.toPublicUser(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  private async generateAccessToken(user: User): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as StringValue,
    });
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const jti = uuidv4();
    const payload: RefreshTokenPayload = { sub: userId, jti };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as StringValue,
    });

    const decoded = this.jwtService.decode<{ exp: number }>(token);
    const expiresAt = new Date(decoded.exp * 1000);
    const tokenHash = await bcrypt.hash(token, REFRESH_TOKEN_HASH_ROUNDS);

    await this.db.insert(refreshTokens).values({ id: jti, userId, tokenHash, expiresAt });
    return token;
  }

  private async verifyRefreshToken(rawRefreshToken: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
  }

  private async revokeToken(id: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, id));
  }

  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
  }

  private async findUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return user;
  }

  private toPublicUser(user: User): PublicUser {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }
}
