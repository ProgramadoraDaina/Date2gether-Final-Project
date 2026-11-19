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
    fireEvent.click(screen.getByRole('button', { name: /Tamaño de los subtítulos/ }));
    expect(screen.getByRole('radio', { name: 'Mediana' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Grande' }));

    expect(screen.getByRole('radio', { name: 'Grande' })).toBeChecked();
    expect(useCallSettingsStore.getState().captionSize).toBe('large');
    expect(JSON.parse(localStorage.getItem('date2gether:call-settings') ?? '{}')).toMatchObject({
      state: { captionSize: 'large' },
    });
  });

  it('la subvista de subtítulos tiene flecha atrás y X, y el menú abre el modal del avatar', () => {
    render(<CallSettingsButton buttonClassName="btn" />);
    const gear = screen.getByRole('button', { name: 'Ajustes de la llamada' });
    fireEvent.click(gear);
    fireEvent.click(screen.getByRole('button', { name: /Tamaño de los subtítulos/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.queryByRole('radio', { name: 'Grande' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Personalizar avatar/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tamaño de los subtítulos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(gear).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(gear);
    fireEvent.click(screen.getByRole('button', { name: /Personalizar avatar/ }));
    expect(gear).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('tab', { name: 'Probador', hidden: true })).toBeInTheDocument();
  });

  it('se cierra con Escape', () => {
    render(<CallSettingsButton buttonClassName="btn" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la llamada' }));
    fireEvent.click(screen.getByRole('button', { name: /Tamaño de los subtítulos/ }));
    expect(screen.getByRole('group', { name: 'Tamaño de los subtítulos' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('group', { name: 'Tamaño de los subtítulos' }),
    ).not.toBeInTheDocument();
  });
});
