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
  it('muestra "Hacer evento" en la misma fila que el tema y el idioma', async () => {
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

    const event = screen.getByRole('button', { name: 'Hacer evento' });
    expect(event.parentElement).toBe(screen.getByRole('button', { name: 'Tema' }).parentElement);
  });
});
