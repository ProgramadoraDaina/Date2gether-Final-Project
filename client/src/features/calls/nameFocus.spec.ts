import { describe, expect, it } from '@jest/globals';
import { findMentionedParticipant } from './nameFocus';

interface Track {
  participant: { identity: string; name?: string };
}

function track(identity: string, name?: string): Track {
  return { participant: { identity, name } };
}

describe('findMentionedParticipant', () => {
  it('encuentra al participante cuando se dice su primer nombre como palabra completa', () => {
    const juan = track('id-juan', 'Juan Pérez');
    const tracks = [track('id-ana', 'Ana'), juan];

    expect(findMentionedParticipant('che Juan, mirá esto', tracks)).toBe(juan);
  });

  it('no matchea un nombre que aparece como substring de otra palabra', () => {
    const ana = track('id-ana', 'Ana');

    expect(findMentionedParticipant('me comí una banana', [ana])).toBeUndefined();
  });

  it('ignora al participante excluido (quien está hablando)', () => {
    const ana = track('id-ana', 'Ana');

    expect(findMentionedParticipant('Ana dijo que Ana vendría', [ana], 'id-ana')).toBeUndefined();
  });

  it('matchea nombres con tildes', () => {
    const jose = track('id-jose', 'José');

    expect(findMentionedParticipant('preguntale a José', [jose])).toBe(jose);
  });

  it('devuelve undefined si no hay ninguna mención', () => {
    const tracks = [track('id-ana', 'Ana'), track('id-juan', 'Juan')];

    expect(findMentionedParticipant('nadie dijo nada', tracks)).toBeUndefined();
  });

  it('devuelve undefined si no hay tracks', () => {
    expect(findMentionedParticipant('Juan, Ana', [])).toBeUndefined();
  });

  it('usa la identity como nombre cuando el participante no tiene name', () => {
    const anon = track('juanete');

    expect(findMentionedParticipant('juanete, vení', [anon])).toBe(anon);
  });
});
