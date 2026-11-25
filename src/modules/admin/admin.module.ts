import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [JwtAuthModule, RoomsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
