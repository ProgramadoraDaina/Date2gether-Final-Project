import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { RoomsModule } from '../rooms/rooms.module';
import { ChatGateway } from './chat.gateway';
import { ChatHistoryController } from './chat-history.controller';
import { ChatService } from './chat.service';
import { RoomPlaylistsService } from './room-playlists.service';

@Module({
  imports: [RoomsModule, JwtAuthModule, RoomResolverModule],
  controllers: [ChatHistoryController],
  providers: [ChatGateway, ChatService, RoomPlaylistsService],
})
export class ChatModule {}
