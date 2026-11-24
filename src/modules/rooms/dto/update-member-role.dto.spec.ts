import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMemberRoleDto } from './update-member-role.dto';

describe('UpdateMemberRoleDto', () => {
  it.each(['administrador', 'colaborador', 'participante'])('acepta el rol %s', async (role) => {
    expect(await validate(plainToInstance(UpdateMemberRoleDto, { role }))).toHaveLength(0);
  });

  it.each(['owner', 'admin', '', undefined, null])('rechaza el rol inválido %s', async (role) => {
    expect(await validate(plainToInstance(UpdateMemberRoleDto, { role }))).not.toHaveLength(0);
  });
});
