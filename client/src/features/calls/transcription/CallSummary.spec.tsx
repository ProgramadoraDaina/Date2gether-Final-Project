import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';

class FakeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

jest.mock('@/lib/api', () => ({
  ApiError: FakeApiError,
  getCallSummary: jest.fn(),
  generateCallSummary: jest.fn(),
}));

const summary = { text: 'Resumen de la reunión', model: 'm', language: 'es' as const, createdAt: '2026-11-19T10:00:00.000Z' };

describe('Resumen con IA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
  });

  it('sin resumen guardado ofrece el botón y al usarlo muestra el resultado', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    jest.mocked(api.generateCallSummary).mockResolvedValue(summary);
    render(<CallSummary sessionId="session-1" hasTranscript />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resumir con IA' }));

    expect(await screen.findByText('Resumen de la reunión')).toBeInTheDocument();
    expect(api.generateCallSummary).toHaveBeenCalledWith('session-1', 'es');
  });

  it('envía el idioma actual de la interfaz', async () => {
    useLanguageStore.setState({ language: 'en' });
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    jest.mocked(api.generateCallSummary).mockResolvedValue(summary);
    render(<CallSummary sessionId="session-1" hasTranscript />);

    fireEvent.click(await screen.findByRole('button', { name: 'Summarize with AI' }));
    await waitFor(() => expect(api.generateCallSummary).toHaveBeenCalledWith('session-1', 'en'));
  });

  it('muestra un resumen ya guardado sin botón de generar', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(summary);
    render(<CallSummary sessionId="session-1" hasTranscript />);

    expect(await screen.findByText('Resumen de la reunión')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resumir con IA' })).not.toBeInTheDocument();
  });

  it('durante la generación deshabilita el botón e informa el progreso', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    jest.mocked(api.generateCallSummary).mockReturnValue(new Promise(() => {}));
    render(<CallSummary sessionId="session-1" hasTranscript />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resumir con IA' }));
    expect(screen.getByRole('button', { name: 'Generando resumen…' })).toBeDisabled();
  });

  it.each([
    [429, 'AI_QUOTA', 'Se alcanzó el límite de uso de la IA. Probá de nuevo más tarde.'],
    [429, undefined, 'Demasiadas solicitudes. Probá de nuevo en un minuto.'],
    [503, undefined, 'El resumen con IA no está disponible por ahora. Probá de nuevo más tarde.'],
    [422, undefined, 'Esta llamada no tiene transcripción para resumir.'],
    [413, undefined, 'La transcripción es demasiado larga para resumirla con IA.'],
    [500, undefined, 'No se pudo generar el resumen'],
  ])('si el backend responde %i muestra un mensaje claro en un alert', async (status, code, message) => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    jest.mocked(api.generateCallSummary).mockRejectedValue(new FakeApiError('raw backend text', status, code));
    render(<CallSummary sessionId="session-1" hasTranscript />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resumir con IA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).not.toHaveTextContent('raw backend text');
  });

  it('sin transcripción no consulta ni ofrece el botón', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    render(<CallSummary sessionId="session-1" hasTranscript={false} />);
    // Flush pending effects and promise callbacks before asserting the absence of a call.
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getCallSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Resumir con IA' })).not.toBeInTheDocument();
  });

  it('un doble clic dispara una sola solicitud', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    jest.mocked(api.generateCallSummary).mockReturnValue(new Promise(() => {}));
    render(<CallSummary sessionId="session-1" hasTranscript />);

    const button = await screen.findByRole('button', { name: 'Resumir con IA' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.generateCallSummary).toHaveBeenCalledTimes(1);
  });

  it('al cambiar de sesión descarta el resumen y el error de la anterior', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockImplementation((id) =>
      Promise.resolve(id === 'session-1' ? summary : null),
    );
    const { rerender } = render(<CallSummary sessionId="session-1" hasTranscript />);
    expect(await screen.findByText('Resumen de la reunión')).toBeInTheDocument();

    rerender(<CallSummary sessionId="session-2" hasTranscript />);

    expect(await screen.findByRole('button', { name: 'Resumir con IA' })).toBeInTheDocument();
    expect(screen.queryByText('Resumen de la reunión')).not.toBeInTheDocument();
  });

  it('ignora la respuesta tardía de una sesión que ya no está visible', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(null);
    let resolveLate: (value: typeof summary) => void = () => undefined;
    jest.mocked(api.generateCallSummary).mockReturnValue(
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
    );
    const { rerender } = render(<CallSummary sessionId="session-1" hasTranscript />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resumir con IA' }));

    rerender(<CallSummary sessionId="session-2" hasTranscript />);
    await act(async () => {
      resolveLate(summary);
    });

    expect(screen.queryByText('Resumen de la reunión')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resumir con IA' })).toBeEnabled();
  });

  it('avisa cuando el resumen guardado está en otro idioma que la interfaz', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue({ ...summary, language: 'en' });
    render(<CallSummary sessionId="session-1" hasTranscript />);
    expect(await screen.findByText('Resumen generado en inglés.')).toBeInTheDocument();
  });

  it('no avisa cuando el idioma coincide', async () => {
    const { CallSummary } = await import('./CallSummary');
    const api = await import('@/lib/api');
    jest.mocked(api.getCallSummary).mockResolvedValue(summary);
    render(<CallSummary sessionId="session-1" hasTranscript />);
    await screen.findByText('Resumen de la reunión');
    expect(screen.queryByText(/Resumen generado en/)).not.toBeInTheDocument();
  });
});
