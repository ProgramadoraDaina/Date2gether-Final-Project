import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GifsService } from './gifs.service';

describe('GifsService', () => {
  it('responde 503 sin consultar a GIPHY cuando falta GIPHY_API_KEY', async () => {
    const service = new GifsService(new ConfigService({}));

    await expect(service.search('gato')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
