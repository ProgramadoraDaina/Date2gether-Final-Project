import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';

jest.mock('@/lib/api', () => ({
  ApiError: Error,
  getSessionTranscript: jest.fn(),
  getCallSummary: jest.fn(() => Promise.resolve(null)),
  generateCallSummary: jest.fn(),
}));

async function renderTranscript() {
  const { SessionTranscript } = await import('./SessionTranscript');
  render(<SessionTranscript sessionId="session-1" roomCode="abc-defg-hij" />);
}

describe('Acta en el historial', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
  });

  it('muestra las frases de la sesión con quién habló y permite descargarlas', async () => {
    const { getSessionTranscript } = await import('@/lib/api');
    jest.mocked(getSessionTranscript).mockResolvedValue([
      {
        id: '1',
        speakerName: 'Ana',
        content: 'me encanta esta aplicacion',
        spokenAt: '2026-11-18T20:01:05Z',
      },
    ]);
    await renderTranscript();

    expect(await screen.findByText('me encanta esta aplicacion')).toBeInTheDocument();
    expect(getSessionTranscript).toHaveBeenCalledWith('session-1');
    expect(screen.getByRole('heading', { name: 'Transcripción' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar TXT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resumir con IA' })).toBeInTheDocument();
  });

  it('si nadie activó los subtítulos lo dice, sin botones de descarga', async () => {
    const { getSessionTranscript } = await import('@/lib/api');
    jest.mocked(getSessionTranscript).mockResolvedValue([]);
    await renderTranscript();
    expect(await screen.findByText('Esta llamada no tiene transcripción.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descargar TXT' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resumir con IA' })).not.toBeInTheDocument();
  });

  it('si falla la carga muestra el error', async () => {
    const { getSessionTranscript } = await import('@/lib/api');
    jest.mocked(getSessionTranscript).mockRejectedValue(new Error('boom'));
    await renderTranscript();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la transcripción',
    );
  });
});
