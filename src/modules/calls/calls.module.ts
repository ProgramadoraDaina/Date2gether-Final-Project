import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { RoomsModule } from '../rooms/rooms.module';
import { BreakoutRoomsController } from './breakout-rooms.controller';
import { BreakoutRoomsService } from './breakout-rooms.service';
import { CallGroupResolverService } from './call-group-resolver.service';
import { CallHistoryController } from './call-history.controller';
import { CallSessionCloseService } from './call-session-close.service';
import { CallTimelineController } from './call-timeline.controller';
import { CallTimelineService } from './call-timeline.service';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsWebhookController } from './calls-webhook.controller';
import { CallsWebhookService } from './calls-webhook.service';
import { TestSupportController } from './test-support.controller';

@Module({
  imports: [ConfigModule, JwtAuthModule, RoomsModule, RoomResolverModule],
  controllers: [
    CallsController,
    CallHistoryController,
    CallsWebhookController,
    CallTimelineController,
    BreakoutRoomsController,
    TestSupportController,
  ],
  providers: [
    CallsService,
    CallsWebhookService,
    CallTimelineService,
    CallSessionCloseService,
    CallGroupResolverService,
    BreakoutRoomsService,
  ],
})
export class CallsModule {}
