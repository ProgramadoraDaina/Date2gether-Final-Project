import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';
import { TranscriptDialog } from './TranscriptDialog';

const mockFetch = jest.fn<typeof fetch>();

function renderDialog(callEnded = false) {
  render(
    <TranscriptDialog
      open
      onClose={jest.fn()}
      roomCode="abc-defg-hij"
      roomToken="guest-room-token"
      callSid="RM_call1"
      callEnded={callEnded}
    />,
  );
}

describe('TranscriptDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
    global.fetch = mockFetch;
    // jsdom no implementa showModal.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('pide el acta de esa llamada con el pase de la sala y la muestra en orden con quién habló', async () => {
    mockFetch.mockResolvedValue(
      Response.json([
        {
          id: '1',
          speakerName: 'Ana',
          content: 'Hola, ¿me escuchás?',
          spokenAt: '2026-11-06T20:01:05Z',
        },
        { id: '2', speakerName: 'Juan', content: 'Sí, perfecto', spokenAt: '2026-11-06T20:01:08Z' },
      ]),
    );
    renderDialog();

    expect(await screen.findByText('Hola, ¿me escuchás?')).toBeInTheDocument();
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/transcripts\/abc-defg-hij\?callSid=RM_call1$/);
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer guest-room-token' } });
    const items = screen.getAllByRole('listitem', { hidden: true });
    expect(items[0]).toHaveTextContent('Ana');
    expect(items[1]).toHaveTextContent('JuanSí, perfecto');
    expect(screen.getByText('2 frases')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Volver al inicio' })).not.toBeInTheDocument();
  });

  it('sin frases explica cómo generarlas; al terminar la llamada ofrece volver al inicio', async () => {
    mockFetch.mockResolvedValue(Response.json([]));
    renderDialog(true);
    expect(await screen.findByText(/Todavía no hay frases/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  });

  it('si el backend falla muestra el error', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 500 }));
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la transcripción',
    );
  });
});
