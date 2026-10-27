import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [ConfigModule, JwtAuthModule, RoomsModule],
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
