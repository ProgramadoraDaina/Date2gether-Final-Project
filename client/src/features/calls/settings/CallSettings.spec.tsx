import { beforeEach, describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';
import { CallSettingsButton } from './CallSettings';
import { useCallSettingsStore } from './store';

describe('Ajustes de la llamada', () => {
  beforeEach(() => {
    localStorage.clear();
    useLanguageStore.setState({ language: 'es' });
    useCallSettingsStore.setState({ captionSize: 'medium' });
  });

  it('abre el panel, cambia el tamaño de los subtítulos y lo recuerda para la próxima llamada', () => {
    render(<CallSettingsButton buttonClassName="btn" />);
    const button = screen.getByRole('button', { name: 'Ajustes de la llamada' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(screen.getByRole('radio', { name: 'Mediana' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Grande' }));

    expect(screen.getByRole('radio', { name: 'Grande' })).toBeChecked();
    expect(useCallSettingsStore.getState().captionSize).toBe('large');
    expect(JSON.parse(localStorage.getItem('date2gether:call-settings') ?? '{}')).toMatchObject({
      state: { captionSize: 'large' },
    });
  });

  it('se cierra con Escape', () => {
    render(<CallSettingsButton buttonClassName="btn" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la llamada' }));
    expect(screen.getByRole('group', { name: 'Tamaño de los subtítulos' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('group', { name: 'Tamaño de los subtítulos' }),
    ).not.toBeInTheDocument();
  });
});
