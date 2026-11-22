import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import type { LeavePolicy } from '../breakout-rooms.service';

export class CreateBreakoutRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsIn(['locked', 'free_return'])
  leavePolicy?: LeavePolicy;

  @IsOptional()
  @IsInt()
  @Min(1)
  autoCloseInMinutes?: number;
}
