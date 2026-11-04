import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { GifsController } from './gifs.controller';
import { GifsService } from './gifs.service';

@Module({
  imports: [ConfigModule, JwtAuthModule],
  controllers: [GifsController],
  providers: [GifsService],
})
export class GifsModule {}
