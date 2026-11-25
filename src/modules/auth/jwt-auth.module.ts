import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { RoomAccessGuard } from './guards/room-access.guard';
import { RoomAccessService } from './room-access.service';

@Module({
  imports: [JwtModule.register({}), RoomResolverModule],
  providers: [JwtAuthGuard, WsJwtAuthGuard, RolesGuard, RoomAccessGuard, RoomAccessService],
  exports: [
    JwtModule,
    JwtAuthGuard,
    WsJwtAuthGuard,
    RolesGuard,
    RoomAccessGuard,
    RoomAccessService,
  ],
})
export class JwtAuthModule {}
