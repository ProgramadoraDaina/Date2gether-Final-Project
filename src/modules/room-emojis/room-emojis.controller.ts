import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomRoles } from '../rooms/decorators/room-roles.decorator';
import { RoomRolesGuard } from '../rooms/guards/room-roles.guard';
import { CreateRoomEmojiDto, RoomEmojiFieldsDto } from './dto/create-room-emoji.dto';
import { UpdateRoomEmojiDto } from './dto/update-room-emoji.dto';
import { SearchSoundsDto } from './dto/search-sounds.dto';
import { MAX_UPLOAD_BYTES, type ProcessedMedia } from './emoji-media';
import { FreesoundService } from './freesound.service';
import {
  RoomEmojisService,
  type EmojiCallOptions,
  type NewEmojiContent,
} from './room-emojis.service';

interface UploadedFile {
  buffer: Buffer;
}

interface EmojiUploads {
  image?: UploadedFile[];
  sound?: UploadedFile[];
}

// Lectura abierta: <img> y <audio> no pueden mandar el header Authorization.
// Los archivos se piden por uuid y no contienen datos personales.
@Controller('rooms/:code/emojis')
export class RoomEmojisController {
  constructor(
    private readonly roomEmojis: RoomEmojisService,
    private readonly freesound: FreesoundService,
  ) {}

  @Get()
  list(@Param('code') code: string) {
    return this.roomEmojis.list(code);
  }

  // Protegido: solo quien puede crear emojis gasta la cuota de la API key de Freesound.
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @Get('sounds')
  searchSounds(@Query() dto: SearchSoundsDto) {
    return this.freesound.search(dto.q);
  }

  @Get(':id/image')
  async image(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    send(res, await this.roomEmojis.getImage(code, id));
  }

  @Get(':id/sound')
  async sound(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    send(res, await this.roomEmojis.getSound(code, id));
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @UseInterceptors(emojiUploads())
  @Post()
  create(
    @Param('code') code: string,
    @Body() dto: CreateRoomEmojiDto,
    @UploadedFiles() files: EmojiUploads,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roomEmojis.create(
      code,
      user.sub,
      dto.name,
      contentOf(dto, files),
      callOptionsOf(dto),
    );
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @UseInterceptors(emojiUploads())
  @Patch(':id')
  update(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomEmojiDto,
    @UploadedFiles() files: EmojiUploads,
  ) {
    return this.roomEmojis.update(code, id, {
      name: dto.name,
      removeSound: dto.removeSound,
      ...contentOf(dto, files),
      ...callOptionsOf(dto),
    });
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador', 'colaborador')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('code') code: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.roomEmojis.remove(code, id);
  }
}

function emojiUploads() {
  return FileFieldsInterceptor(
    [
      { name: 'image', maxCount: 1 },
      { name: 'sound', maxCount: 1 },
    ],
    { limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 10 } },
  );
}

function contentOf(dto: RoomEmojiFieldsDto, files: EmojiUploads): NewEmojiContent {
  return {
    image: files.image?.[0]?.buffer,
    emoji: dto.emoji,
    freesoundId: dto.freesoundId,
    sound: files.sound?.[0]?.buffer,
  };
}

function callOptionsOf(dto: RoomEmojiFieldsDto): EmojiCallOptions {
  return {
    callMode: dto.callMode,
    sticker: {
      duration: dto.stickerDuration,
      position: dto.stickerPosition,
      size: dto.stickerSize,
      animation: dto.stickerAnimation,
    },
  };
}

function send(res: Response, media: ProcessedMedia) {
  // El cliente pide `?v=<version>`: al editar cambia la URL, nunca el archivo bajo la misma URL.
  res.set({
    'Content-Type': media.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(media.data);
}
