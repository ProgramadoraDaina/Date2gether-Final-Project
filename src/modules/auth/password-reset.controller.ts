import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';
import {
  ApiBadRequestResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always answers 200 with the same message so it never reveals whether the email exists. Throttled to 5 requests per minute.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiServiceUnavailableResponse({ description: 'Email delivery is not configured' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.reset.requestReset(dto.email);
    return { message: 'Si existe una cuenta con ese email, te mandamos un link.' };
  }

  @ApiOperation({
    summary: 'Set a new password using a reset token',
    description: 'Throttled to 10 requests per minute.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, or the reset link is invalid or expired',
  })
  @ApiServiceUnavailableResponse({ description: 'Email delivery is not configured' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.reset.resetPassword(dto.token, dto.password);
    return { message: 'Listo, ya podés entrar con tu contraseña nueva.' };
  }
}
