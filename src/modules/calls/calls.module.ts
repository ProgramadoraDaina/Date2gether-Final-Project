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
          region: configService.get<string>('AWS_REGION', 'us-east-1'),
        }),
    },
  ],
  exports: [CallsService],
})
export class CallsModule {}
