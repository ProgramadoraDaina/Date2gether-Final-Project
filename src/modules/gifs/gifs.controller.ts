import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { SearchGifsDto } from './dto/search-gifs.dto';
import { GifsService } from './gifs.service';

// Requiere el pase de la sala para que nadie de afuera gaste el cupo de la API key.
@Controller('gifs')
@UseGuards(RoomAccessGuard)
export class GifsController {
  constructor(private readonly gifsService: GifsService) {}

  @Get(':roomCode')
  search(@Query() dto: SearchGifsDto) {
    return this.gifsService.search(dto.q, dto.offset);
  }
}
