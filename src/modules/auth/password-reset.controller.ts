import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth')
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.reset.requestReset(dto.email);
    return { message: 'Si existe una cuenta con ese email, te mandamos un link.' };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.reset.resetPassword(dto.token, dto.password);
    return { message: 'Listo, ya podés entrar con tu contraseña nueva.' };
  }
}
