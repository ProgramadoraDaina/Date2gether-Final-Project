import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { MusicSearchController } from './music-search.controller';
import { MusicSearchService } from './music-search.service';

@Module({
  imports: [ConfigModule, JwtAuthModule, RoomResolverModule],
  controllers: [MusicSearchController],
  providers: [MusicSearchService],
})
export class MusicSearchModule {}
