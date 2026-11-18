import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';

@Module({
  imports: [JwtAuthModule, RoomResolverModule],
  controllers: [TranscriptsController],
  providers: [TranscriptsService],
})
export class TranscriptsModule {}
