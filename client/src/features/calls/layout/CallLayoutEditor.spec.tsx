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
    act(() => useCallLayoutStore.setState({ enabled: false, zones: [] }));
  });

  it('agrega zonas y las muestra en la vista previa', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));

    expect(state().zones).toHaveLength(2);
    const preview = screen.getByTestId('layout-preview');
    expect(within(preview).getAllByTestId('layout-zone')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Zona 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Zona 2' })).toBeInTheDocument();
  });

  it('la primera zona ocupa el resto: no tiene posición, alto ni ancho', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    const first = screen.getByRole('group', { name: 'Zona 1' });

    expect(within(first).queryByLabelText('Posición')).not.toBeInTheDocument();
    expect(within(first).queryByLabelText('Ancho (%)')).not.toBeInTheDocument();
    expect(within(first).getByText('Ocupa el espacio que queda')).toBeInTheDocument();
  });

  it('configura posición, tamaño, cantidad, escala y forma de una zona', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar zona' }));
    const second = screen.getByRole('group', { name: 'Zona 2' });

    fireEvent.change(within(second).getByLabelText('Posición'), {
      target: { value: 'beside-previous' },
    });
    fireEvent.change(within(second).getByLabelText('Ancho (%)'), { target: { value: '40' } });
    fireEvent.change(within(second).getByLabelText('Alto (%)'), { target: { value: '60' } });
    fireEvent.change(within(second).getByLabelText('Personas'), { target: { value: '10' } });
    fireEvent.change(within(second).getByLabelText('Tamaño de cámara (px)'), {
      target: { value: '90' },
    });
    fireEvent.change(within(second).getByLabelText('Forma'), { target: { value: '1:1' } });

    expect(state().zones[1]).toMatchObject({
      placement: 'beside-previous',
      width: 40,
      height: 60,
      capacity: 10,
      tileSize: 90,
      aspect: '1:1',
    });
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

  it('activa la distribución para las llamadas', async () => {
    await renderEditor();
    fireEvent.click(screen.getByLabelText('Usar mi distribución en las llamadas'));
    expect(state().enabled).toBe(true);
  });
});
