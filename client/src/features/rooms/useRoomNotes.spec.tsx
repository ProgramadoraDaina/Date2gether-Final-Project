import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import type { getRoomNotes, saveRoomNotes, RoomNotes } from '@/lib/api';

const mockGetNotes = jest.fn<typeof getRoomNotes>();
const mockSaveNotes = jest.fn<typeof saveRoomNotes>();
const mockConflictError = class extends Error {};
let useRoomNotes: typeof import('./useRoomNotes').useRoomNotes;

jest.mock('@/lib/api', () => ({
  getRoomNotes: mockGetNotes,
  saveRoomNotes: mockSaveNotes,
  RoomNotesConflictError: mockConflictError,
}));

const getNotes = mockGetNotes;
const saveNotes = mockSaveNotes;
const code = 'abc-defg-hij';
const storageKey = 'notes:test:shared-draft';
const original: RoomNotes = {
  roomId: 'room-1',
  content: 'Nota original',
  revision: 3,
  updatedAt: '2026-11-04T00:00:00Z',
};
async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}
async function setup() {
  const hook = renderHook(() => useRoomNotes(code, 'token', storageKey));
  await act(async () => {});
  return hook;
}

describe('useRoomNotes: guardado seguro', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    localStorage.clear();
    getNotes.mockResolvedValue(original);
    saveNotes.mockResolvedValue({ ...original, content: 'Edición local', revision: 4 });
    useRoomNotes = (await import('./useRoomNotes')).useRoomNotes;
  });
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('cargar y volver a renderizar no escribe una copia antigua en el servidor', async () => {
    const { result, rerender } = await setup();
    expect(result.current.content).toBe(original.content);
    getNotes.mockResolvedValue({ ...original, content: 'Edición de otra persona', revision: 4 });
    rerender();
    await tick();
    expect(saveNotes).not.toHaveBeenCalled();
    expect(getNotes).toHaveBeenCalledTimes(1);
  });

  it('una carga fallida bloquea las escrituras hasta que el reintento obtiene la revisión', async () => {
    getNotes.mockRejectedValueOnce(new Error('Sin red'));
    const { result } = await setup();
    expect(result.current.status).toBe('load-error');
    act(() => result.current.edit('No debe borrar la nota existente'));
    await tick();
    expect(saveNotes).not.toHaveBeenCalled();

    await act(async () => {
      result.current.retry();
    });
    expect(result.current.content).toBe(original.content);
    expect(result.current.status).toBe('ready');
    act(() => result.current.edit('Edición local'));
    await tick();
    expect(saveNotes).toHaveBeenCalledWith(code, 'token', 'Edición local', 3, false);
  });

  it('cambiar a notas personales no cancela la última edición compartida', async () => {
    function Panel() {
      const notes = useRoomNotes(code, 'token', storageKey);
      const [shared, setShared] = useState(true);
      return (
        <>
          <button onClick={() => setShared(false)}>Personales</button>
          {shared && (
            <textarea
              aria-label="Compartidas"
              value={notes.content}
              onChange={(e) => notes.edit(e.target.value)}
            />
          )}
        </>
      );
    }
    render(<Panel />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Compartidas'), { target: { value: 'Edición local' } });
    fireEvent.click(screen.getByText('Personales'));
    await tick();
    expect(saveNotes).toHaveBeenCalledWith(code, 'token', 'Edición local', 3, false);
  });

  it('al desmontar envía inmediatamente la edición pendiente con keepalive', async () => {
    const { result, unmount } = await setup();
    act(() => result.current.edit('Edición local'));
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      content: 'Edición local',
      revision: 3,
    });
    unmount();
    expect(saveNotes).toHaveBeenCalledWith(code, 'token', 'Edición local', 3, true);
    await act(async () => {});
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('mantiene el borrador ante un conflicto y solo reemplaza tras una elección explícita', async () => {
    const { result } = await setup();
    saveNotes.mockRejectedValueOnce(new mockConflictError());
    getNotes.mockResolvedValue({ ...original, content: 'Edición remota', revision: 4 });
    act(() => result.current.edit('Edición local'));
    await tick();
    expect(result.current.status).toBe('conflict');
    expect(result.current.content).toBe('Edición local');
    expect(result.current.remote?.content).toBe('Edición remota');
    act(() => result.current.edit('Borrador revisado'));
    await tick();
    expect(saveNotes).toHaveBeenCalledTimes(1);
    saveNotes.mockResolvedValue({ ...original, content: 'Borrador revisado', revision: 5 });
    await act(async () => {
      result.current.resolveConflict(true);
    });
    expect(saveNotes).toHaveBeenLastCalledWith(code, 'token', 'Borrador revisado', 4, false);
    expect(result.current.status).toBe('saved');
  });

  it('recupera el borrador tras salir sin red y no pisa una versión más nueva al volver', async () => {
    saveNotes.mockRejectedValue(new Error('Sin red'));
    const first = await setup();
    act(() => first.result.current.edit('Edición local'));
    await tick();
    expect(first.result.current.status).toBe('save-error');
    first.unmount();
    await act(async () => {});
    const callsBeforeReload = saveNotes.mock.calls.length;
    getNotes.mockResolvedValue({ ...original, content: 'Edición remota', revision: 4 });
    const second = await setup();
    expect(second.result.current.content).toBe('Edición local');
    expect(second.result.current.status).toBe('conflict');
    act(() => second.result.current.edit('Borrador revisado'));
    await tick();
    expect(saveNotes).toHaveBeenCalledTimes(callsBeforeReload);
    // Incluso otro cierre conserva la revisión antigua hasta resolver el conflicto.
    expect(JSON.parse(localStorage.getItem(storageKey)!).revision).toBe(3);
    act(() => second.result.current.resolveConflict(false));
    expect(second.result.current.content).toBe('Edición remota');
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('serializa las escrituras y usa la revisión nueva para cambios hechos durante el guardado', async () => {
    let complete!: (note: RoomNotes) => void;
    saveNotes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { result } = await setup();
    act(() => result.current.edit('Primera edición'));
    await tick();
    act(() => result.current.edit('Edición final'));
    await tick();
    expect(saveNotes).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete({ ...original, content: 'Primera edición', revision: 4 });
    });
    expect(result.current.content).toBe('Edición final');
    expect(result.current.status).toBe('pending');
    saveNotes.mockResolvedValue({ ...original, content: 'Edición final', revision: 5 });
    await tick();
    expect(saveNotes).toHaveBeenLastCalledWith(code, 'token', 'Edición final', 4, false);
    expect(result.current.status).toBe('saved');
  });
});
