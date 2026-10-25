import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [JwtAuthGuard, WsJwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard, WsJwtAuthGuard],
})
export class JwtAuthModule {}
