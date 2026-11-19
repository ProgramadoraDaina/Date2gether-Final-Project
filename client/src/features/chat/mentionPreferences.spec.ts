import { beforeEach, describe, expect, it } from '@jest/globals';
import { isMentionSoundEnabled, setMentionSoundEnabled } from './mentionPreferences';

describe('mentionPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('está prendido por defecto', () => {
    expect(isMentionSoundEnabled()).toBe(true);
  });

  it('persiste apagarlo y volver a prenderlo', () => {
    setMentionSoundEnabled(false);
    expect(isMentionSoundEnabled()).toBe(false);

    setMentionSoundEnabled(true);
    expect(isMentionSoundEnabled()).toBe(true);
  });
});
