import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from './auth-throttle';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { sanitizeAvatar } from './avatar';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateNameColorDto } from './dto/update-name-color.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AccessTokenPayload } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Sesión cerrada' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload) {
    return this.authService.getProfile(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/color')
  updateNameColor(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateNameColorDto) {
    return this.authService.updateNameColor(user.sub, dto.nameColor);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/avatar')
  updateAvatar(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateAvatarDto) {
    return this.authService.updateAvatar(user.sub, sanitizeAvatar(dto) ?? { sticker: true });
  }
}
