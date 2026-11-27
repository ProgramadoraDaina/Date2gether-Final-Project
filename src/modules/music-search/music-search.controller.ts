import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { SearchMusicDto } from './dto/search-music.dto';
import { MusicSearchService } from './music-search.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROOM_PASS_AUTH } from '../../swagger';

// Room pass required so outsiders cannot burn the daily YouTube quota.
@ApiTags('Media search')
@ApiBearerAuth(ROOM_PASS_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
@ApiForbiddenResponse({
  description: 'Room pass was issued for a different room, or the participant was kicked',
})
@ApiNotFoundResponse({ description: 'Room not found or expired' })
@Controller('music-search')
@UseGuards(RoomAccessGuard)
export class MusicSearchController {
  constructor(private readonly musicSearchService: MusicSearchService) {}

  @ApiOperation({
    summary: 'Search music on YouTube',
    description: 'Requires a room pass so outsiders cannot spend the API quota.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Get(':roomCode')
  search(@Query() dto: SearchMusicDto) {
    return this.musicSearchService.search(dto.q);
  }
}
