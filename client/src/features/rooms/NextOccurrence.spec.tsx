import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.mock('../translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

describe('NextOccurrence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renderiza el instante formateado en la zona del VIEWER (Intl.DateTimeFormat sin zona explícita)', async () => {
    const format = jest.fn().mockReturnValue('lunes, 10:00 a.m.');
    const dateTimeFormatSpy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(() => ({ format }) as unknown as Intl.DateTimeFormat);

    const { NextOccurrence } = await import('./NextOccurrence');
    render(<NextOccurrence nextOccurrenceAt="2026-11-17T10:00:00.000Z" />);

    expect(await screen.findByText('lunes, 10:00 a.m.')).toBeInTheDocument();
    // Sin zona explícita en las options: Intl resuelve la zona del viewer
    // por definición, nunca la del owner (design.md D6).
    expect(dateTimeFormatSpy).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ weekday: 'long', hour: 'numeric', minute: '2-digit' }),
    );
    expect(dateTimeFormatSpy.mock.calls[0][1]).not.toHaveProperty('timeZone');
  });

  it('muestra el estado "sin próxima ocurrencia" cuando nextOccurrenceAt es null', async () => {
    const { NextOccurrence } = await import('./NextOccurrence');
    render(<NextOccurrence nextOccurrenceAt={null} />);

    expect(
      await screen.findByText('Esta sala no tiene un próximo horario programado.'),
    ).toBeInTheDocument();
  });
});
