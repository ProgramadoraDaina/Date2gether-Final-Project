import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH } from '../../swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account and get tokens' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'An account with that email already exists' })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Log in with email and password and get tokens' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Wrong email or password' })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Refresh token invalid, expired or revoked' })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Sesión cerrada' };
  }

  @ApiOperation({ summary: 'Get the profile of the authenticated account' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload) {
    return this.authService.getProfile(user.sub);
  }

  @ApiOperation({ summary: 'Update the display-name color of the authenticated account' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @UseGuards(JwtAuthGuard)
  @Patch('me/color')
  updateNameColor(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateNameColorDto) {
    return this.authService.updateNameColor(user.sub, dto.nameColor);
  }

  @ApiOperation({ summary: 'Update the avatar of the authenticated account' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @UseGuards(JwtAuthGuard)
  @Patch('me/avatar')
  updateAvatar(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateAvatarDto) {
    return this.authService.updateAvatar(user.sub, sanitizeAvatar(dto) ?? { sticker: true });
  }
}
