import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { RoleTag } from './RoleTag';

describe('RoleTag', () => {
  it.each([
    ['administrador', 'admin', 'Administrador'],
    ['colaborador', 'colab', 'Colaborador'],
    ['participante', 'part', 'Participante'],
  ] as const)('muestra "%s" como "%s", con "%s" como título completo', (role, short, full) => {
    render(<RoleTag role={role} />);
    expect(screen.getByText(short)).toHaveAttribute('title', full);
  });

  it('si llega un rol que el cliente todavía no conoce, lo muestra tal cual en vez de romper el render', () => {
    // @ts-expect-error -- simula un rol que el backend podría agregar antes de que el cliente lo conozca
    render(<RoleTag role="moderador" />);
    expect(screen.getByText('moderador')).toHaveAttribute('title', 'moderador');
  });
});
