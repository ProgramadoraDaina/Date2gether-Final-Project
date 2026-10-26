import { ChimeSDKMeetingsClient } from '@aws-sdk/client-chime-sdk-meetings';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [ConfigModule, JwtAuthModule, RoomsModule],
  controllers: [CallsController],
  providers: [
    CallsService,
    {
      provide: ChimeSDKMeetingsClient,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new ChimeSDKMeetingsClient({
          // Ohio admite medios, pero no el endpoint de Meetings.
          region: configService.get<string>('AWS_CHIME_REGION', 'us-east-1'),
          profile: configService.get<string>('AWS_PROFILE'),
        }),
    },
  ],
  exports: [CallsService],
})
export class CallsModule {}
