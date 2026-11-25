import { describe, expect, it } from '@jest/globals';
import { canLowerHandOf, decodeHand, encodeHand, handQueue } from './hands';

describe('hands', () => {
  it('ida y vuelta de levantar, bajar y bajar a otra persona', () => {
    expect(decodeHand(encodeHand({ raised: true, at: 10 }))).toEqual({ raised: true, at: 10 });
    expect(decodeHand(encodeHand({ raised: false }))).toEqual({ raised: false });
    expect(decodeHand(encodeHand({ raised: false, target: 'beto' }))).toEqual({
      raised: false,
      target: 'beto',
    });
  });

  it('descarta mensajes que no son de manos', () => {
    expect(decodeHand(new TextEncoder().encode('no es json'))).toBeNull();
    expect(decodeHand(new TextEncoder().encode('{"raised":true}'))).toBeNull();
  });

  it('ordena la fila por quién levantó primero', () => {
    const queue = handQueue({
      beto: { identity: 'beto', name: 'Beto', at: 20 },
      ana: { identity: 'ana', name: 'Ana', at: 10 },
      caro: { identity: 'caro', name: 'Caro', at: 20 },
    });
    expect(queue.map((hand) => hand.identity)).toEqual(['ana', 'beto', 'caro']);
  });

  it('solo un admin puede bajarle la mano a otra persona', () => {
    expect(canLowerHandOf('admin-1', ['admin-1'])).toBe(true);
    expect(canLowerHandOf('invitado', ['admin-1'])).toBe(false);
  });
});
