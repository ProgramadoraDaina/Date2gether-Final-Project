import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ParticipantRequest } from '../auth/guards/room-access.guard';
import { GetTranscriptDto, SaveTranscriptLineDto } from './dto/save-transcript-line.dto';
import { TranscriptsController } from './transcripts.controller';
import type { TranscriptsService } from './transcripts.service';

const request = {
  participant: { kind: 'room-participant', sub: 'guest-1', roomCode: 'abc-defg-hij', name: 'Ana' },
} as ParticipantRequest;

describe('TranscriptsController', () => {
  it('guarda la frase con el nombre del pase verificado, no con uno del body', async () => {
    const service = { save: jest.fn<TranscriptsService['save']>() };
    const controller = new TranscriptsController(service as unknown as TranscriptsService);
    const body = Object.assign(new SaveTranscriptLineDto(), {
      callSid: 'RM_abc',
      content: 'Hola',
      speakerName: 'Otra persona',
    });

    await controller.save('abc-defg-hij', body, request);

    expect(service.save).toHaveBeenCalledWith('abc-defg-hij', 'RM_abc', 'Ana', 'Hola');
  });

  it('devuelve el acta de la llamada pedida sin cachear', async () => {
    const service = { getCall: jest.fn<TranscriptsService['getCall']>().mockResolvedValue([]) };
    const controller = new TranscriptsController(service as unknown as TranscriptsService);

    await expect(
      controller.getCall(
        'abc-defg-hij',
        Object.assign(new GetTranscriptDto(), { callSid: 'RM_abc' }),
      ),
    ).resolves.toEqual([]);
    expect(service.getCall).toHaveBeenCalledWith('abc-defg-hij', 'RM_abc');
    const handler = Object.getOwnPropertyDescriptor(TranscriptsController.prototype, 'getCall')!
      .value as object;
    expect(Reflect.getMetadata('__headers__', handler)).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
  });
});

describe('SaveTranscriptLineDto', () => {
  const errors = (body: object) =>
    validateSync(plainToInstance(SaveTranscriptLineDto, body)).map((e) => e.property);

  it('acepta una frase y recorta espacios', () => {
    const dto = plainToInstance(SaveTranscriptLineDto, { callSid: ' RM_abc ', content: ' Hola ' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ callSid: 'RM_abc', content: 'Hola' });
  });

  it('rechaza frases vacías, demasiado largas o sin llamada', () => {
    expect(errors({ callSid: 'RM_abc', content: '   ' })).toEqual(['content']);
    expect(errors({ callSid: 'RM_abc', content: 'a'.repeat(501) })).toEqual(['content']);
    expect(errors({ content: 'Hola' })).toEqual(['callSid']);
    expect(errors({ callSid: 'x'.repeat(65), content: 'Hola' })).toEqual(['callSid']);
  });
});
