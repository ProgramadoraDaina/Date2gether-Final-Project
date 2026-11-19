import { IsIn } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsIn(['colaborador', 'participante'])
  role: 'colaborador' | 'participante';
}
