import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { JoinPolicy, LeavePolicy } from '../breakout-rooms.service';

export class UpdateBreakoutRoomDto {
  @IsOptional()
  @IsIn(['locked', 'free_return'])
  leavePolicy?: LeavePolicy;

  // Decisión 3 (design.md "joinPolicy: esquema, migración y autorización"):
  // mismo patrón que leavePolicy -- control separado, propio validador.
  @IsOptional()
  @IsIn(['admin_only', 'open'])
  joinPolicy?: JoinPolicy;

  // Clearing an existing timer (null) is a service-level capability
  // (UpdateBreakoutRoomInput.autoCloseInMinutes: number | null); the HTTP
  // DTO only exposes setting a new positive value in this phase.
  @IsOptional()
  @IsInt()
  @Min(1)
  autoCloseInMinutes?: number;
}
