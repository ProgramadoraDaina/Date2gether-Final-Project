import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallSummaryService } from './call-summary.service';
import { GenerateSummaryDto } from './dto/generate-summary.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH } from '../../swagger';

// Same route family and the same participation rule as the session transcript.
@ApiTags('Call summaries')
@ApiBearerAuth(ACCESS_TOKEN_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
@ApiForbiddenResponse({ description: 'The account did not participate in that session' })
@ApiNotFoundResponse({ description: 'Session not found' })
@Controller('calls/sessions')
@UseGuards(JwtAuthGuard)
export class CallSummaryController {
  constructor(private readonly summaries: CallSummaryService) {}

  @ApiOperation({ summary: 'Get the saved AI summary of a call session' })
  @ApiBadRequestResponse({ description: 'Invalid sessionId' })
  @Get(':sessionId/summary')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.summaries.get(sessionId, user.sub);
  }

  // Stricter than the global 60/min: each call may reach a quota-limited external API.
  @ApiOperation({
    summary: 'Generate the AI summary of a call session',
    description:
      'Throttled to 5 requests per minute because it can reach a quota-limited external API.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiServiceUnavailableResponse({ description: 'AI summary provider unavailable' })
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
