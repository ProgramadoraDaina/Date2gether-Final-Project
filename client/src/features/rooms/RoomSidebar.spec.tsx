import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/features/theme/ThemeToggle', () => ({ ThemeToggle: () => <button>Tema</button> }));
jest.mock('@/features/translation/LanguageToggle', () => ({
  LanguageToggle: () => <button>EN</button>,
}));

describe('RoomSidebar', () => {
  it('muestra "Hacer evento" y deja tema e idioma para el menú de ajustes', async () => {
    const { RoomSidebar } = await import('./RoomSidebar');
    render(
      <RoomSidebar
        code="abc-defg-hij"
        copied={false}
        onCopyLink={jest.fn()}
        onOpenEmojis={jest.fn()}
        open
        width={260}
        onResizeHandleMouseDown={jest.fn()}
        inCall={false}
        eventControl={<button type="button">Hacer evento</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hacer evento' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tema' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EN' })).not.toBeInTheDocument();
  });
});
