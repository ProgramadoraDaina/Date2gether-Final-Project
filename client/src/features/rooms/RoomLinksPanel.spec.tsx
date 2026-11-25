import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { RoomLink } from '@/lib/api';

jest.mock('../translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  getRoomLinks: jest.fn(),
  addRoomLink: jest.fn(),
  deleteRoomLink: jest.fn(),
}));

const LINK: RoomLink = {
  id: 'link-1',
  roomId: 'room-1',
  url: 'https://docs.example.com/clase-1',
  title: 'Apunte clase 1',
  addedByName: 'Santi',
  createdAt: '2026-11-24T10:00:00.000Z',
};

function fakeSocket() {
  const handlers = new Map<string, () => void>();
  const socket = {
    on: jest.fn((event: string, handler: () => void) => handlers.set(event, handler)),
    off: jest.fn((event: string) => handlers.delete(event)),
  } as unknown as Socket;
  return { socket, emit: (event: string) => handlers.get(event)?.() };
}

async function renderPanel(canManage: boolean, socket: Socket | null = null) {
  const { RoomLinksPanel } = await import('./RoomLinksPanel');
  render(
    <RoomLinksPanel code="abc-defg-hij" token="room-token" socket={socket} canManage={canManage} />,
  );
}

describe('RoomLinksPanel', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('cualquiera ve la lista con links que abren en otra pestaña, sin poder editarla', async () => {
    const { getRoomLinks } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValue([LINK]);
    await renderPanel(false);

    const link = await screen.findByRole('link', { name: 'Apunte clase 1' });
    expect(link).toHaveAttribute('href', LINK.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/Santi/)).toBeInTheDocument();
    expect(getRoomLinks).toHaveBeenCalledWith('abc-defg-hij', 'room-token');
    expect(screen.queryByRole('button', { name: 'Guardar link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });

  it('sin links muestra el estado vacío', async () => {
    const { getRoomLinks } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValue([]);
    await renderPanel(false);
    expect(await screen.findByText('Todavía no hay links guardados')).toBeInTheDocument();
  });

  it('profesor/ayudante agrega un link y la lista se recarga', async () => {
    const { getRoomLinks, addRoomLink } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValueOnce([]).mockResolvedValueOnce([LINK]);
    jest.mocked(addRoomLink).mockResolvedValue(LINK);
    await renderPanel(true);
    await screen.findByText('Todavía no hay links guardados');

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: LINK.url } });
    fireEvent.change(screen.getByLabelText('Título (opcional)'), {
      target: { value: 'Apunte clase 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar link' }));

    expect(await screen.findByRole('link', { name: 'Apunte clase 1' })).toBeInTheDocument();
    expect(addRoomLink).toHaveBeenCalledWith('abc-defg-hij', {
      url: LINK.url,
      title: 'Apunte clase 1',
    });
    expect(screen.getByLabelText('URL')).toHaveValue('');
  });

  it('muestra el error del backend al agregar (p. ej. link repetido)', async () => {
    const { getRoomLinks, addRoomLink, ApiError } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValue([LINK]);
    jest.mocked(addRoomLink).mockRejectedValue(new ApiError('Ese link ya está en la biblioteca'));
    await renderPanel(true);
    await screen.findByRole('link', { name: 'Apunte clase 1' });

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: LINK.url } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese link ya está en la biblioteca');
  });

  it('profesor/ayudante quita un link', async () => {
    const { getRoomLinks, deleteRoomLink } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValueOnce([LINK]).mockResolvedValueOnce([]);
    jest.mocked(deleteRoomLink).mockResolvedValue(undefined);
    await renderPanel(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }));

    expect(await screen.findByText('Todavía no hay links guardados')).toBeInTheDocument();
    expect(deleteRoomLink).toHaveBeenCalledWith('abc-defg-hij', 'link-1');
  });

  it('se actualiza en vivo cuando otro cambia la biblioteca', async () => {
    const { getRoomLinks } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValueOnce([]).mockResolvedValueOnce([LINK]);
    const { socket, emit } = fakeSocket();
    await renderPanel(false, socket);
    await screen.findByText('Todavía no hay links guardados');

    act(() => emit('roomLinksChanged'));

    await waitFor(() => expect(getRoomLinks).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('link', { name: 'Apunte clase 1' })).toBeInTheDocument();
  });

  it('un link sin título muestra la URL como texto', async () => {
    const { getRoomLinks } = await import('@/lib/api');
    jest.mocked(getRoomLinks).mockResolvedValue([{ ...LINK, title: null }]);
    await renderPanel(false);
    expect(await screen.findByRole('link', { name: LINK.url })).toBeInTheDocument();
  });
});
