import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import type { JoinPolicy, LeavePolicy } from '../breakout-rooms.service';

export class CreateBreakoutRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsIn(['locked', 'free_return'])
  leavePolicy?: LeavePolicy;

  // Decisión 3 (design.md "joinPolicy: esquema, migración y autorización"):
  // mismo patrón que leavePolicy -- control separado, propio validador.
  @IsOptional()
  @IsIn(['admin_only', 'open'])
  joinPolicy?: JoinPolicy;

  @IsOptional()
  @IsInt()
  @Min(1)
  autoCloseInMinutes?: number;
}
