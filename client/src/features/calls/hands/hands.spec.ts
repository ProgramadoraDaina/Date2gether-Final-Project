import { describe, expect, it } from '@jest/globals';
import { decodeHand, encodeHand, handQueue } from './hands';

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
      beto: { identity: 'beto', source: 'beto', name: 'Beto', at: 20 },
      ana: { identity: 'ana', source: 'ana', name: 'Ana', at: 10 },
      caro: { identity: 'caro', source: 'caro', name: 'Caro', at: 20 },
    });
    expect(queue.map((hand) => hand.identity)).toEqual(['ana', 'beto', 'caro']);
  });
});
