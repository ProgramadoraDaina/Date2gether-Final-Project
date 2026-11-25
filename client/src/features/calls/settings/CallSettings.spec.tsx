import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';
import { useCallLayoutStore } from '../layout/store';
import { CallSettingsButton } from './CallSettings';
import { useCallSettingsStore } from './store';

describe('Ajustes de la llamada', () => {
  beforeEach(() => {
    localStorage.clear();
    useLanguageStore.setState({ language: 'es' });
    useCallSettingsStore.setState({ captionSize: 'medium' });
  });

  it('abre el panel, cambia el tamaño de los subtítulos y lo recuerda para la próxima llamada', () => {
    render(
      <CallSettingsButton
        buttonClassName="btn"
        isAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        nameFocusEnabled={false}
        onSetNameFocus={jest.fn()}
      />,
    );
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
    render(
      <CallSettingsButton
        buttonClassName="btn"
        isAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        nameFocusEnabled={false}
        onSetNameFocus={jest.fn()}
      />,
    );
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
    render(
      <CallSettingsButton
        buttonClassName="btn"
        isAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        nameFocusEnabled={false}
        onSetNameFocus={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la llamada' }));
    fireEvent.click(screen.getByRole('button', { name: /Tamaño de los subtítulos/ }));
    expect(screen.getByRole('group', { name: 'Tamaño de los subtítulos' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('group', { name: 'Tamaño de los subtítulos' }),
    ).not.toBeInTheDocument();
  });

  it('el admin ve el toggle de enfoque automático y activarlo llama a onSetNameFocus', () => {
    const onSetNameFocus = jest.fn();
    render(
      <CallSettingsButton
        buttonClassName="btn"
        isAdmin
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        nameFocusEnabled={false}
        onSetNameFocus={onSetNameFocus}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la llamada' }));

    const toggle = screen.getByRole('checkbox', {
      name: 'Enfocar automáticamente al nombrar a alguien',
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(onSetNameFocus).toHaveBeenCalledWith(true);
  });

  it('un participante sin rol de admin no ve los toggles de sala', () => {
    render(
      <CallSettingsButton
        buttonClassName="btn"
        isAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        nameFocusEnabled={false}
        onSetNameFocus={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la llamada' }));

    expect(
      screen.queryByRole('checkbox', { name: 'Enfocar automáticamente al nombrar a alguien' }),
    ).not.toBeInTheDocument();
  });

  it('desde la tuerca se editan los mosaicos de la llamada en vivo y se vuelve al menú', () => {
    useCallLayoutStore.setState({ enabled: false, zones: [] });
    render(
      <CallSettingsButton
        buttonClassName="btn"
        isAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        nameFocusEnabled={false}
        onSetNameFocus={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes de la llamada' }));
    fireEvent.click(screen.getByRole('button', { name: /Mosaicos/ }));

    fireEvent.click(screen.getByLabelText('Usar mi distribución en las llamadas'));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    const firstZone = screen.getByRole('group', { name: 'Zona 1' });
    fireEvent.change(within(firstZone).getByLabelText('Personas'), { target: { value: '2' } });

    expect(useCallLayoutStore.getState()).toMatchObject({
      enabled: true,
      zones: [{ capacity: 2 }, { capacity: 4 }],
    });
    // In the call the screen itself is the preview.
    expect(screen.queryByTestId('layout-preview')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('button', { name: /Mosaicos/ })).toBeInTheDocument();
  });
});
