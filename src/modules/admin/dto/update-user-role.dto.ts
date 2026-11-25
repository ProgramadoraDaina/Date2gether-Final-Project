import { IsIn } from 'class-validator';
import { USER_ROLES, type UserRole } from '../../../db/schema';

export class UpdateUserRoleDto {
  @IsIn(USER_ROLES)
  role!: UserRole;
}
