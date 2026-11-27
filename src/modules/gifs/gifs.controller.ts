import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { SearchGifsDto } from './dto/search-gifs.dto';
import { GifsService } from './gifs.service';
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

// Requiere el pase de la sala para que nadie de afuera gaste el cupo de la API key.
@ApiTags('Media search')
@ApiBearerAuth(ROOM_PASS_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired room pass' })
@ApiForbiddenResponse({
  description: 'Room pass was issued for a different room, or the participant was kicked',
})
@ApiNotFoundResponse({ description: 'Room not found or expired' })
@Controller('gifs')
@UseGuards(RoomAccessGuard)
export class GifsController {
  constructor(private readonly gifsService: GifsService) {}

  @ApiOperation({
    summary: 'Search GIFs',
    description: 'Requires a room pass so outsiders cannot spend the API quota.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Get(':roomCode')
  search(@Query() dto: SearchGifsDto) {
    return this.gifsService.search(dto.q, dto.offset);
  }
}
