import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useCallLayoutStore } from './store';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

const state = () => useCallLayoutStore.getState();

async function renderEditor() {
  const { CallLayoutEditor } = await import('./CallLayoutEditor');
  render(<CallLayoutEditor />);
}

describe('CallLayoutEditor', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => useCallLayoutStore.setState({ enabled: false, zones: [], focusedZoneId: null }));
  });

  it('sin zonas muestra cómo empezar y no trae ninguna predefinida', async () => {
    await renderEditor();
    expect(state().zones).toEqual([]);
    expect(screen.getByText('Todavía no hay zonas')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-preview')).not.toBeInTheDocument();
  });

  it('agrega zonas, abre la nueva y las muestra en la vista previa con su color', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));

    expect(state().zones).toHaveLength(2);
    expect(state().focusedZoneId).toBe(state().zones[1].id);
    const preview = screen.getByTestId('layout-preview');
    const previewZones = within(preview).getAllByTestId('layout-zone');
    expect(previewZones).toHaveLength(2);
    const first = screen.getByRole('group', { name: 'Zona 1' });
    // The card badge and the zone on screen share one color so they can be matched.
    expect(within(first).getByTestId('zone-badge').style.getPropertyValue('--zone-color')).toBe(
      previewZones[0].style.getPropertyValue('--zone-color'),
    );
    expect(screen.getByText('2 zonas')).toBeInTheDocument();
  });

  it('solo la zona abierta muestra sus controles; tocar otra la abre', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    const first = screen.getByRole('group', { name: 'Zona 1' });
    const second = screen.getByRole('group', { name: 'Zona 2' });
    expect(within(first).queryByLabelText('Personas')).not.toBeInTheDocument();
    expect(within(second).getByLabelText('Personas')).toBeInTheDocument();

    fireEvent.click(within(first).getByRole('button', { name: /Zona 1/ }));
    expect(within(first).getByLabelText('Personas')).toBeInTheDocument();
    expect(within(second).queryByLabelText('Personas')).not.toBeInTheDocument();
    expect(state().focusedZoneId).toBe(state().zones[0].id);
  });

  it('la primera zona ocupa el resto: no tiene posición, alto ni ancho', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    const first = screen.getByRole('group', { name: 'Zona 1' });

    expect(within(first).queryByRole('radiogroup', { name: 'Posición' })).not.toBeInTheDocument();
    expect(within(first).queryByLabelText('Ancho (%)')).not.toBeInTheDocument();
    expect(within(first).getAllByText('Ocupa el espacio que queda').length).toBeGreaterThan(0);
  });

  it('configura posición, tamaño, cantidad, escala y forma de una zona', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    const second = screen.getByRole('group', { name: 'Zona 2' });

    fireEvent.click(within(second).getByRole('radio', { name: 'Al lado de la anterior' }));
    fireEvent.change(within(second).getByLabelText('Ancho (%)'), { target: { value: '40' } });
    fireEvent.change(within(second).getByLabelText('Alto (%)'), { target: { value: '60' } });
    fireEvent.change(within(second).getByLabelText('Personas'), { target: { value: '9' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Una persona más' }));
    fireEvent.change(within(second).getByLabelText('Tamaño (%)'), { target: { value: '90' } });
    fireEvent.click(within(second).getByRole('radio', { name: 'Cuadrada (1:1)' }));

    expect(state().zones[1]).toMatchObject({
      placement: 'beside-previous',
      width: 40,
      height: 60,
      capacity: 10,
      scale: 90,
      aspect: '1:1',
    });
    expect(within(second).getByRole('radio', { name: 'Cuadrada (1:1)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('quita una zona', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Zona 1' })).getByRole('button', {
        name: 'Quitar zona',
      }),
    );

    expect(state().zones).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Zona 2' })).not.toBeInTheDocument();
  });

  it('activa la distribución para las llamadas con el interruptor', async () => {
    await renderEditor();
    fireEvent.click(screen.getByLabelText('Usar mi distribución en las llamadas'));
    expect(state().enabled).toBe(true);
  });
});
