import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { RoomAccessGuard } from './guards/room-access.guard';
import { RoomAccessService } from './room-access.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [JwtAuthGuard, WsJwtAuthGuard, RoomAccessGuard, RoomAccessService],
  exports: [JwtModule, JwtAuthGuard, WsJwtAuthGuard, RoomAccessGuard, RoomAccessService],
})
export class JwtAuthModule {}
