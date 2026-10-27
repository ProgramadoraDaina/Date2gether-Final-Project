import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AccessTokenPayload } from './auth.types';

export interface RoomParticipant {
  kind: 'room-participant';
  sub: string;
  roomCode: string;
  name: string;
  userId?: string;
}

const ROOM_AUDIENCE = 'date2gether:rooms';

@Injectable()
export class RoomAccessService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async create(roomCode: string, name: string, authorization?: string) {
    let userId: string | undefined;
    if (authorization) {
      const token = this.bearer(authorization);
      const account = await this.jwt
        .verifyAsync<AccessTokenPayload & { kind?: string }>(token, {
          secret: this.secret,
        })
        .catch(() => {
          throw new UnauthorizedException('Sesión inválida o expirada');
        });
      if (account.kind || !account.sub || typeof account.email !== 'string') {
        throw new UnauthorizedException('Se requiere una sesión de cuenta válida');
      }
      userId = account.sub;
    }
    const participant: RoomParticipant = {
      kind: 'room-participant',
      sub: randomUUID(),
      roomCode,
      name,
      ...(userId ? { userId } : {}),
    };
    const token = await this.jwt.signAsync(participant, {
      secret: this.secret,
      audience: ROOM_AUDIENCE,
      expiresIn: '24h',
    });
    return { token, participant };
  }

  async verify(token: string): Promise<RoomParticipant> {
    try {
      const participant = await this.jwt.verifyAsync<RoomParticipant>(token, {
        secret: this.secret,
        audience: ROOM_AUDIENCE,
      });
      if (
        participant.kind !== 'room-participant' ||
        !participant.sub ||
        !participant.roomCode ||
        !participant.name?.trim()
      )
        throw new Error('Invalid participant');
      return participant;
    } catch {
      throw new UnauthorizedException('Acceso a la sala inválido o expirado');
    }
  }

  bearer(authorization?: string): string {
    const [scheme, token] = (authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException('Acceso a la sala requerido');
    return token;
  }

  private get secret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }
}
