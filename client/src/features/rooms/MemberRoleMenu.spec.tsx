import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RoomRole } from '@/lib/api';

jest.mock('@/features/translation/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const onChangeRole = jest.fn<(id: string, role: RoomRole) => Promise<void>>();

async function setup(role: RoomRole = 'participante', isLastAdmin = false) {
  const { MemberRoleMenu } = await import('./MemberRoleMenu');
  render(
    <MemberRoleMenu
      member={{ userId: 'user-1', name: 'Beto', role, isOwner: false }}
      name="Beto"
      isLastAdmin={isLastAdmin}
      onChangeRole={onChangeRole}
    />,
  );
  return screen.getByRole('button', { name: 'Permisos de Beto' });
}

describe('MemberRoleMenu', () => {
  beforeEach(() => {
    onChangeRole.mockReset().mockResolvedValue(undefined);
  });

  it('oculta las opciones hasta abrir los tres puntos y cierra el menú después de elegir', async () => {
    const trigger = await setup();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hacer administrador' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onChangeRole).toHaveBeenCalledWith('user-1', 'administrador');
    expect(trigger).toHaveFocus();
  });

  it.each([
    ['colaborador', 'Quitar colaborador', 'participante'],
    ['administrador', 'Quitar administrador', 'participante'],
    ['administrador', 'Hacer colaborador', 'colaborador'],
  ] as const)('permite pasar de %s usando %s', async (role, action, next) => {
    fireEvent.click(await setup(role));
    fireEvent.click(screen.getByRole('menuitem', { name: action }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onChangeRole).toHaveBeenCalledWith('user-1', next);
  });

  it('no permite quitar ni cambiar a colaborador al último admin', async () => {
    fireEvent.click(await setup('administrador', true));
    const remove = screen.getByRole('menuitem', { name: 'Quitar administrador' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', 'La sala debe conservar al menos un administrador');
    expect(screen.getByRole('menuitem', { name: 'Hacer colaborador' })).toBeDisabled();
    fireEvent.click(remove);
    expect(onChangeRole).not.toHaveBeenCalled();
  });

  it('permite recorrer con flechas, cerrar con Escape y cerrar al hacer clic afuera', async () => {
    const trigger = await setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('evita enviar dos cambios de rol mientras hay uno pendiente', async () => {
    let finish!: () => void;
    onChangeRole.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const trigger = await setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hacer administrador' }));
    expect(trigger).toBeDisabled();
    for (const item of screen.getAllByRole('menuitem')) expect(item).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onChangeRole).toHaveBeenCalledTimes(1);
  });
});
