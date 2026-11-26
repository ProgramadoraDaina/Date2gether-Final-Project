import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { TranscriptHistoryController } from './transcript-history.controller';
import { TranscriptHistoryService } from './transcript-history.service';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';

@Module({
  imports: [JwtAuthModule, RoomResolverModule],
  controllers: [TranscriptsController, TranscriptHistoryController],
  providers: [TranscriptsService, TranscriptHistoryService],
  exports: [TranscriptsService, TranscriptHistoryService],
})
export class TranscriptsModule {}
