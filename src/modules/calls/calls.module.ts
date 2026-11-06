import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { CallHistoryController } from './call-history.controller';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsWebhookController } from './calls-webhook.controller';
import { CallsWebhookService } from './calls-webhook.service';

@Module({
  imports: [ConfigModule, JwtAuthModule, RoomsModule],
  controllers: [CallsController, CallHistoryController, CallsWebhookController],
  providers: [CallsService, CallsWebhookService],
})
export class CallsModule {}
