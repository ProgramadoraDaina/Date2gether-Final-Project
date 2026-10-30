import { describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GifsModule } from './gifs.module';
import { GifsService } from './gifs.service';

describe('GifsModule', () => {
  it('resuelve el GifsService con sus dependencias conectadas', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), GifsModule],
    }).compile();

    expect(module.get(GifsService)).toBeInstanceOf(GifsService);
  });
});
