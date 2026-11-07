import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { CallHistoryController } from './call-history.controller';
import { CallSessionCloseService } from './call-session-close.service';
import { CallTimelineController } from './call-timeline.controller';
import { CallTimelineService } from './call-timeline.service';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsWebhookController } from './calls-webhook.controller';
import { CallsWebhookService } from './calls-webhook.service';

@Module({
  imports: [ConfigModule, JwtAuthModule, RoomsModule],
  controllers: [
    CallsController,
    CallHistoryController,
    CallsWebhookController,
    CallTimelineController,
  ],
  providers: [CallsService, CallsWebhookService, CallTimelineService, CallSessionCloseService],
})
export class CallsModule {}
