import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { AI_TEXT_GENERATOR } from './ai-text-generator';
import { CallSummaryController } from './call-summary.controller';
import { CallSummaryService } from './call-summary.service';
import { GeminiTextGenerator } from './gemini-text-generator';

@Module({
  imports: [JwtAuthModule, TranscriptsModule],
  controllers: [CallSummaryController],
  providers: [
    CallSummaryService,
    GeminiTextGenerator,
    { provide: AI_TEXT_GENERATOR, useExisting: GeminiTextGenerator },
  ],
})
export class AiSummaryModule {}
