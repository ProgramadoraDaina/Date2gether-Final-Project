import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { LeavePolicy } from '../breakout-rooms.service';

export class UpdateBreakoutRoomDto {
  @IsOptional()
  @IsIn(['locked', 'free_return'])
  leavePolicy?: LeavePolicy;

  // Clearing an existing timer (null) is a service-level capability
  // (UpdateBreakoutRoomInput.autoCloseInMinutes: number | null); the HTTP
  // DTO only exposes setting a new positive value in this phase.
  @IsOptional()
  @IsInt()
  @Min(1)
  autoCloseInMinutes?: number;
}
