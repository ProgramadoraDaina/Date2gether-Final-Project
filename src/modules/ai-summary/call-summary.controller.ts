import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallSummaryService } from './call-summary.service';
import { GenerateSummaryDto } from './dto/generate-summary.dto';

// Same route family and the same participation rule as the session transcript.
@Controller('calls/sessions')
@UseGuards(JwtAuthGuard)
export class CallSummaryController {
  constructor(private readonly summaries: CallSummaryService) {}

  @Get(':sessionId/summary')
  @Header('Cache-Control', 'no-store')
  get(@Param('sessionId', ParseUUIDPipe) sessionId: string, @CurrentUser() user: AccessTokenPayload) {
    return this.summaries.get(sessionId, user.sub);
  }

  // Stricter than the global 60/min: each call may reach a quota-limited external API.
  @Post(':sessionId/summary')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  generate(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: GenerateSummaryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.summaries.generate(sessionId, user.sub, dto.language ?? 'es');
  }
}
