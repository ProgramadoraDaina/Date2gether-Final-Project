import { describe, expect, it } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { attributionFor, FreesoundService, licenseLabel } from './freesound.service';

describe('licenseLabel', () => {
  it.each([
    ['http://creativecommons.org/licenses/by/3.0/', 'CC BY 3.0'],
    ['http://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'],
    ['http://creativecommons.org/licenses/by-nc/4.0/', 'CC BY-NC 4.0'],
    ['http://creativecommons.org/publicdomain/zero/1.0/', 'CC0'],
  ])('traduce %s a %s', (url, label) => {
    expect(licenseLabel(url)).toBe(label);
  });
});

describe('attributionFor', () => {
  it('arma el crédito con nombre, autor, licencia y enlace', () => {
    expect(
      attributionFor({
        id: 519274,
        name: 'TTS Daniel Bruh Moment.wav',
        username: 'GreenTractor77',
        license: 'http://creativecommons.org/licenses/by/3.0/',
      }),
    ).toBe('"TTS Daniel Bruh Moment.wav" por GreenTractor77 (CC BY 3.0) — freesound.org/s/519274');
  });
});

describe('FreesoundService', () => {
  it('responde 503 sin consultar a Freesound cuando falta FREESOUND_API_KEY', async () => {
    const service = new FreesoundService(new ConfigService({}));
    await expect(service.search('bruh')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
