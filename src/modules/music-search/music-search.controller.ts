import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { SearchMusicDto } from './dto/search-music.dto';
import { MusicSearchService } from './music-search.service';

// Room pass required so outsiders cannot burn the daily YouTube quota.
@Controller('music-search')
@UseGuards(RoomAccessGuard)
export class MusicSearchController {
  constructor(private readonly musicSearchService: MusicSearchService) {}

  @Get(':roomCode')
  search(@Query() dto: SearchMusicDto) {
    return this.musicSearchService.search(dto.q);
  }
}
