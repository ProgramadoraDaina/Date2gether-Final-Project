import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomResolverModule } from '../rooms/room-resolver.module';
import { RoomsModule } from '../rooms/rooms.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [RoomsModule, JwtAuthModule, RoomResolverModule],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}
