import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { useLanguageStore } from '../translation/store';
import { AvatarEditor } from './AvatarEditor';
import { HEAD_PIECES, type Avatar } from './catalog';

function Harness({ initial, onChange }: { initial: Avatar; onChange: (a: Avatar) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <AvatarEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const HEAD_IDS = Object.keys(HEAD_PIECES);

// jsdom no implementa PointerEvent: sin esto fireEvent pierde clientX.
if (!('PointerEvent' in window)) {
  Object.defineProperty(window, 'PointerEvent', { value: MouseEvent });
}

describe('AvatarEditor', () => {
  beforeEach(() => {
    useLanguageStore.setState({ language: 'es' });
  });

  it('modo mascota: deslizar con el dedo pasa a la pieza siguiente y da la vuelta en bucle', () => {
    const onChange = jest.fn();
    const last = HEAD_IDS[HEAD_IDS.length - 1] as NonNullable<Avatar['head']>[number];
    render(<Harness initial={{ head: [last], sticker: true }} onChange={onChange} />);
    const strip = screen.getByTestId('avatar-strip-head');

    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ sticker: true });

    fireEvent.pointerDown(strip, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 200, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ head: [last], sticker: true });
  });

  it('probador: con una pieza puesta se le puede cambiar el color', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ head: ['cap'], sticker: true }} onChange={onChange} />);

    const headColors = screen.getByRole('group', { name: 'Color: Gorra' });
    fireEvent.click(within(headColors).getByRole('button', { name: '#e04b3a' }));

    expect(onChange).toHaveBeenLastCalledWith({
      head: ['cap'],
      colors: { 'head:cap': '#e04b3a' },
      sticker: true,
    });
    expect(screen.getAllByRole('group', { name: /^Color:/ })).toHaveLength(1);
  });

  it('el naranja está entre los colores elegibles', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ head: ['cap'], sticker: true }} onChange={onChange} />);

    const headColors = screen.getByRole('group', { name: 'Color: Gorra' });
    fireEvent.click(within(headColors).getByRole('button', { name: '#f0821e' }));

    expect(onChange).toHaveBeenLastCalledWith({
      head: ['cap'],
      colors: { 'head:cap': '#f0821e' },
      sticker: true,
    });
  });

  it('modo catálogo: dos piezas del mismo slot se recolorean cada una por separado', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ head: ['crown', 'tiara'], sticker: true }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));
    const crownColors = screen.getByRole('group', { name: 'Color: Corona' });
    const tiaraColors = screen.getByRole('group', { name: 'Color: Tiara' });

    fireEvent.click(within(crownColors).getByRole('button', { name: '#e04b3a' }));
    expect(onChange).toHaveBeenLastCalledWith({
      head: ['crown', 'tiara'],
      colors: { 'head:crown': '#e04b3a' },
      sticker: true,
    });

    fireEvent.click(within(tiaraColors).getByRole('button', { name: '#3d7be0' }));
    expect(onChange).toHaveBeenLastCalledWith({
      head: ['crown', 'tiara'],
      colors: { 'head:crown': '#e04b3a', 'head:tiara': '#3d7be0' },
      sticker: true,
    });
  });

  it('modo catálogo: tocar una pieza la pone en el avatar', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ sticker: true }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Queso' }));

    expect(onChange).toHaveBeenLastCalledWith({ head: ['cheese'], sticker: true });
  });

  it('modo catálogo: tocar una pieza ya puesta la saca, y "Nada" vacía todo el slot', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ head: ['cheese', 'crown'], sticker: true }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));
    const headSection = screen.getByRole('region', { name: 'Cabeza' });
    fireEvent.click(within(headSection).getByRole('button', { name: 'Queso' }));
    expect(onChange).toHaveBeenLastCalledWith({ head: ['crown'], sticker: true });

    fireEvent.click(within(headSection).getByRole('button', { name: 'Nada' }));
    expect(onChange).toHaveBeenLastCalledWith({ sticker: true });
  });

  it('el borde sticker se elige y "Al azar" arma un avatar del catálogo respetándolo', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ sticker: true }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Borde sticker' }));
    expect(onChange).toHaveBeenLastCalledWith({ sticker: false });

    fireEvent.click(screen.getByRole('button', { name: 'Al azar' }));
    const random = onChange.mock.lastCall?.[0] as Avatar;
    expect(random.head).toHaveLength(1);
    expect(HEAD_IDS).toContain(random.head?.[0]);
    expect(random.sticker).toBe(false);
  });
});
