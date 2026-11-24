import { IsIn } from 'class-validator';
import { roomRoleEnum, type RoomRole } from '../../../db/schema';

export class UpdateMemberRoleDto {
  @IsIn(roomRoleEnum.enumValues)
  role: RoomRole;
}
