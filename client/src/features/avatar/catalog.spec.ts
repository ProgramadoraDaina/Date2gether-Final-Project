import { describe, expect, it } from '@jest/globals';
import {
  BODY_PIECES,
  FACE_PIECES,
  HEAD_PIECES,
  NECK_PIECES,
  colorOf,
  idsOf,
  piecesOf,
  randomAvatar,
  toAvatar,
  togglePiece,
  withColor,
  withPiece,
} from './catalog';

describe('toAvatar', () => {
  it('descarta piezas y colores que no son del catálogo, y migra un color viejo por slot a la pieza', () => {
    expect(
      toAvatar({
        head: 'cap',
        face: 'dominus',
        colors: { head: '#3D7BE0', face: '#ffffff', neck: 'red' },
        sticker: false,
      }),
    ).toEqual({ head: ['cap'], colors: { 'head:cap': '#3d7be0' }, sticker: false });
  });

  it('acepta un array de ids, preserva el orden y descarta los que no existen', () => {
    expect(
      toAvatar({
        head: ['crown', 'dominus', 'tiara'],
        sticker: true,
      }),
    ).toEqual({ head: ['crown', 'tiara'], sticker: true });
  });

  it('acepta colores nuevos por pieza ("slot:id") sin tocar los de otras piezas del slot', () => {
    expect(
      toAvatar({
        head: ['crown', 'tiara'],
        colors: { 'head:crown': '#e04b3a', 'head:tiara': 'red' },
        sticker: true,
      }),
    ).toEqual({ head: ['crown', 'tiara'], colors: { 'head:crown': '#e04b3a' }, sticker: true });
  });
});

describe('togglePiece', () => {
  it('suma una pieza nueva al final del slot sin tocar las demás', () => {
    const avatar = { head: ['crown' as const], sticker: true };
    expect(togglePiece(avatar, 'head', 'tiara')).toEqual({
      head: ['crown', 'tiara'],
      sticker: true,
    });
  });

  it('saca una pieza y limpia solo su propio color, sin afectar al de las demás', () => {
    const avatar = {
      head: ['crown' as const, 'tiara' as const],
      colors: { 'head:crown': '#e04b3a', 'head:tiara': '#3d7be0' },
      sticker: true,
    };
    expect(togglePiece(avatar, 'head', 'crown')).toEqual({
      head: ['tiara'],
      colors: { 'head:tiara': '#3d7be0' },
      sticker: true,
    });
  });

  it('al vaciar el slot entero no deja un objeto colors vacío', () => {
    const avatar = { head: ['crown' as const], colors: { 'head:crown': '#e04b3a' }, sticker: true };
    expect(togglePiece(avatar, 'head', 'crown')).toEqual({ sticker: true });
  });
});

describe('piecesOf / idsOf', () => {
  it('devuelve varias piezas del mismo slot en el orden guardado', () => {
    const avatar = withPiece(withPiece({ sticker: true }, 'head', 'crown'), 'head', undefined);
    const stacked = togglePiece(togglePiece(avatar, 'head', 'crown'), 'head', 'tiara');
    expect(idsOf(stacked, 'head')).toEqual(['crown', 'tiara']);
    expect(piecesOf(stacked, 'head').map((p) => p.label)).toEqual(['Corona', 'Tiara']);
  });
});

describe('colorOf / withColor', () => {
  it('cada pieza cae a su propio color de base cuando no tiene override', () => {
    const avatar = { head: ['crown' as const, 'tiara' as const], sticker: true };
    expect(colorOf(avatar, 'head', 'crown')).toBe(HEAD_PIECES.crown.color);
    expect(colorOf(avatar, 'head', 'tiara')).toBe(HEAD_PIECES.tiara.color);
  });

  it('withColor cambia una sola pieza sin afectar el color de las demás del mismo slot', () => {
    const avatar = { head: ['crown' as const, 'tiara' as const], sticker: true };
    const next = withColor(avatar, 'head', 'crown', '#E04B3A');
    expect(colorOf(next, 'head', 'crown')).toBe('#e04b3a');
    expect(colorOf(next, 'head', 'tiara')).toBe(HEAD_PIECES.tiara.color);
  });
});

describe('randomAvatar', () => {
  it('arma un avatar al azar solo con piezas del catálogo y respeta el sticker', () => {
    for (let i = 0; i < 30; i += 1) {
      const avatar = randomAvatar(false);
      expect(avatar.body).toHaveLength(1);
      expect(Object.keys(BODY_PIECES)).toContain(avatar.body?.[0]);
      expect(avatar.head).toHaveLength(1);
      expect(Object.keys(HEAD_PIECES)).toContain(avatar.head?.[0]);
      expect(avatar.face).toHaveLength(1);
      expect(Object.keys(FACE_PIECES)).toContain(avatar.face?.[0]);
      if (avatar.neck) expect(Object.keys(NECK_PIECES)).toContain(avatar.neck[0]);
      expect(avatar.sticker).toBe(false);
    }
  });
});
