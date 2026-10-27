import { describe, expect, it } from '@jest/globals';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway', () => {
  it('requiere un socket autenticado para unirse a una sala', () => {
    const handler = Object.getOwnPropertyDescriptor(ChatGateway.prototype, 'handleJoinRoom')!
      .value as object;
    const guards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
    expect(guards).toContain(WsJwtAuthGuard);
  });
});
