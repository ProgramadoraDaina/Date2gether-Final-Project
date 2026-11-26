import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OwnedRoom } from '@/lib/api';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  clearRoomArchive: jest.fn(),
  setMyRoomVisibility: jest.fn(),
}));

function ownedRoom(overrides: Partial<OwnedRoom> = {}): OwnedRoom {
  return {
    hiddenFromMyRooms: false,
    id: 'room-1',
    code: 'abc-defg-hij',
    name: 'Sala temporal',
    isPermanent: false,
    isJoinable: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    lastEnteredAt: '2026-11-17T10:00:00.000Z',
    slots: [],
    nextOccurrenceAt: null,
    ...overrides,
  };
}

describe('MyRoomMenu - hacer permanente', () => {
  it('ofrece la acción en una sala temporal vigente y avisa con la sala elegida', async () => {
    const { MyRoomMenu } = await import('./MyRoomMenu');
    const onPromote = jest.fn();
    render(<MyRoomMenu room={ownedRoom()} onVisibilityChange={jest.fn()} onPromote={onPromote} />);

    fireEvent.click(screen.getByRole('button', { name: /Hacer permanente/ }));

    expect(onPromote).toHaveBeenCalledWith(expect.objectContaining({ id: 'room-1' }));
  });

  it.each([
    ['ya es permanente', { isPermanent: true }],
    ['está vencida', { isJoinable: false }],
  ])('no ofrece la acción si la sala %s', async (_label, overrides) => {
    const { MyRoomMenu } = await import('./MyRoomMenu');
    render(
      <MyRoomMenu
        room={ownedRoom(overrides)}
        onVisibilityChange={jest.fn()}
        onPromote={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Hacer permanente/ })).not.toBeInTheDocument();
  });
});
