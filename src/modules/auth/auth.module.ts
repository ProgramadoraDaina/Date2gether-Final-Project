import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthModule } from './jwt-auth.module';
import { MailService } from './mail.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [AuthController, PasswordResetController],
  providers: [AuthService, MailService, PasswordResetService],
  exports: [AuthService, JwtAuthModule],
})
export class AuthModule {}
