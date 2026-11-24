import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ sid: 'RM_call1' }),
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/history/call/RM_call1',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/features/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn(), onAuthChange: () => () => {} }));
jest.mock('@/lib/api', () => ({
  resolveCallSessionBySid: jest.fn(),
  ApiError: class extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

async function renderPage(loggedIn: boolean) {
  const { isLoggedIn } = await import('@/lib/auth');
  jest.mocked(isLoggedIn).mockReturnValue(loggedIn);
  const Page = (await import('./page')).default;
  render(<Page />);
}

describe('Link al acta desde el final de la llamada', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('si la sesión ya está en el historial, lleva directo a ella', async () => {
    const { resolveCallSessionBySid } = await import('@/lib/api');
    jest.mocked(resolveCallSessionBySid).mockResolvedValue({ id: 'session-1' });
    await renderPage(true);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/history/session-1'));
    expect(resolveCallSessionBySid).toHaveBeenCalledWith('RM_call1');
  });

  it('si la llamada sigue para otros, explica cuándo aparece y deja reintentar', async () => {
    const { resolveCallSessionBySid, ApiError } = await import('@/lib/api');
    jest.mocked(resolveCallSessionBySid).mockRejectedValue(new ApiError('No', 404));
    await renderPage(true);
    await waitFor(() => expect(resolveCallSessionBySid).toHaveBeenCalled());
    expect(
      await screen.findByText(
        'Todavía no está en tu historial: aparece cuando la llamada termina para todas las personas.',
      ),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();

    jest.mocked(resolveCallSessionBySid).mockResolvedValue({ id: 'session-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/history/session-1'));
  });

});
