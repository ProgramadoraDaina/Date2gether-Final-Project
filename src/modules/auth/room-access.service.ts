import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AccessTokenPayload } from './auth.types';

export interface RoomParticipant {
  kind: 'room-participant';
  sub: string;
  // La identidad estable (D4). roomCode es una etiqueta de conveniencia:
  // puede reciclarse a otra sala, roomId nunca.
  roomId: string;
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

  async authenticateAccount(authorization?: string) {
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
    return userId;
  }

  async create(roomId: string, roomCode: string, name: string, authorization?: string) {
    const userId = await this.authenticateAccount(authorization);
    const participant: RoomParticipant = {
      kind: 'room-participant',
      sub: randomUUID(),
      roomId,
      roomCode,
      name,
      ...(userId ? { userId } : {}),
    };
    return this.issueParticipant(participant);
  }

  async issueParticipant(participant: RoomParticipant) {
    const token = await this.jwt.signAsync(participant, {
      secret: this.secret,
      audience: ROOM_AUDIENCE,
      expiresIn: '24h',
    });
    return { token, participant };
  }

  // D7: el ticket de una sala permanente vive 365d -- sin esto, el DB-side
  // expiresAt=NULL no basta: a hora 24 el JWT mismo vencería y el cliente
  // mapearía el 401 a "la solicitud venció" aunque la fila siga pending.
  async createAdmissionTicket(roomId: string, requestId: string, opts?: { permanent?: boolean }) {
    return this.jwt.signAsync(
      { kind: 'room-admission', sub: requestId, roomId },
      {
        secret: this.secret,
        audience: 'date2gether:admission',
        expiresIn: opts?.permanent ? '365d' : '24h',
      },
    );
  }

  async verifyAdmissionTicket(token: string, roomId: string, requestId: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ kind: string; sub: string; roomId: string }>(
        token,
        {
          secret: this.secret,
          audience: 'date2gether:admission',
        },
      );
      if (
        payload.kind !== 'room-admission' ||
        payload.sub !== requestId ||
        payload.roomId !== roomId
      )
        throw new Error('Invalid admission ticket');
    } catch {
      throw new UnauthorizedException('La solicitud de ingreso es inválida o venció');
    }
  }

  // In memory on purpose: one API instance, and a pass lives 24h at most (365 days only in permanent rooms).
  private readonly revoked = new Map<string, { subs: Set<string>; userIds: Set<string> }>();

  revoke(roomId: string, target: { sub: string; userId?: string }): void {
    const entry = this.revoked.get(roomId) ?? { subs: new Set(), userIds: new Set() };
    entry.subs.add(target.sub);
    if (target.userId) entry.userIds.add(target.userId);
    this.revoked.set(roomId, entry);
  }

  isRevoked(roomId: string, target: { sub?: string; userId?: string }): boolean {
    const entry = this.revoked.get(roomId);
    if (!entry) return false;
    return (
      (!!target.sub && entry.subs.has(target.sub)) ||
      (!!target.userId && entry.userIds.has(target.userId))
    );
  }

  async verify(token: string): Promise<RoomParticipant> {
    const participant = await this.verifySignature(token);
    if (this.isRevoked(participant.roomId, participant)) {
      throw new ForbiddenException('Te expulsaron de esta sala');
    }
    return participant;
  }

  private async verifySignature(token: string): Promise<RoomParticipant> {
    try {
      const participant = await this.jwt.verifyAsync<RoomParticipant>(token, {
        secret: this.secret,
        audience: ROOM_AUDIENCE,
      });
      // D4: un token sin roomId (firmado antes de este cambio) se rechaza,
      // deliberadamente, sin camino dual que lo acepte -- ver design.md.
      if (
        participant.kind !== 'room-participant' ||
        !participant.sub ||
        !participant.roomId ||
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
