import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { NAME_COLOR_HEX } from '@/lib/nameColors';
import { InitialsAvatar } from './InitialsAvatar';

describe('InitialsAvatar', () => {
  it('muestra una sola inicial para un nombre de una palabra', () => {
    render(<InitialsAvatar name="Daina" />);
    expect(screen.getByTestId('initials-avatar')).toHaveTextContent('D');
  });

  it('muestra las iniciales de las dos primeras palabras para un nombre compuesto', () => {
    render(<InitialsAvatar name="Daina Gimena" />);
    expect(screen.getByTestId('initials-avatar')).toHaveTextContent('DG');
  });

  it('ignora cualquier palabra más allá de la segunda', () => {
    render(<InitialsAvatar name="Daina Gimena Gacha" />);
    expect(screen.getByTestId('initials-avatar')).toHaveTextContent('DG');
  });

  it('soporta nombres con acentos y caracteres Unicode sin romperlos a la mitad', () => {
    render(<InitialsAvatar name="Ñandú Úrsula" />);
    expect(screen.getByTestId('initials-avatar')).toHaveTextContent('ÑÚ');
  });

  it('asigna el mismo color a un mismo nombre en renders distintos (estabilidad)', () => {
    const { unmount } = render(<InitialsAvatar name="Carla Pérez" />);
    const firstColor = screen.getByTestId('initials-avatar').style.backgroundColor;
    unmount();
    render(<InitialsAvatar name="Carla Pérez" />);
    expect(screen.getByTestId('initials-avatar').style.backgroundColor).toBe(firstColor);
  });

  it('usa el color informado por el servidor en vez del derivado del nombre, cuando viene', () => {
    render(<InitialsAvatar name="Carla Pérez" nameColor="pink" />);
    expect(screen.getByTestId('initials-avatar')).toHaveStyle({
      backgroundColor: NAME_COLOR_HEX.pink,
    });
  });

  it('ignora un nameColor inválido y recurre al mismo color derivado del nombre que sin nameColor', () => {
    const { unmount } = render(<InitialsAvatar name="Carla Pérez" />);
    const colorSinNameColor = screen.getByTestId('initials-avatar').style.backgroundColor;
    unmount();
    render(<InitialsAvatar name="Carla Pérez" nameColor="no-existe" />);
    expect(screen.getByTestId('initials-avatar').style.backgroundColor).toBe(colorSinNameColor);
  });
});
