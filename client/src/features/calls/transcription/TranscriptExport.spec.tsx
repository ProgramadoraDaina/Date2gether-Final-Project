import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TranscriptEntry } from '@/lib/transcripts';
import { useLanguageStore } from '../../translation/store';
import { TranscriptExport } from './TranscriptExport';
import { formatTranscriptTime, transcriptToText } from './transcriptFiles';

const mockPdf = {
  text: jest.fn(),
  setFontSize: jest.fn(),
  addPage: jest.fn(),
  save: jest.fn(),
  splitTextToSize: jest.fn((text: string) => [text]),
  internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
};
jest.mock('jspdf', () => ({ jsPDF: jest.fn(() => mockPdf) }));

const lines: TranscriptEntry[] = [
  {
    id: '1',
    speakerName: 'Ana',
    content: 'me encanta esta aplicacion',
    spokenAt: '2026-11-18T20:01:05Z',
  },
  { id: '2', speakerName: 'Juan', content: 'a mí también', spokenAt: '2026-11-18T20:01:09Z' },
];

describe('Exportar el acta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
  });

  it('el TXT lleva el título y una línea por frase con hora y quién habló', () => {
    expect(transcriptToText('Acta · abc', lines)).toBe(
      [
        'Acta · abc',
        '',
        `[${formatTranscriptTime(lines[0].spokenAt)}] Ana: me encanta esta aplicacion`,
        `[${formatTranscriptTime(lines[1].spokenAt)}] Juan: a mí también`,
        '',
      ].join('\n'),
    );
  });

  it('descarga el TXT con el nombre de la sala y la fecha de la llamada', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = jest.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:acta';
    });
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TranscriptExport roomCode="abc-defg-hij" lines={lines} />);

    fireEvent.click(screen.getByRole('button', { name: 'Descargar TXT' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'transcripcion-abc-defg-hij-2026-11-18.txt',
    );
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });
    expect(content).toContain('Ana: me encanta esta aplicacion');
    click.mockRestore();
  });

  it('descarga el PDF con todas las frases', async () => {
    render(<TranscriptExport roomCode="abc-defg-hij" lines={lines} />);
    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() =>
      expect(mockPdf.save).toHaveBeenCalledWith('transcripcion-abc-defg-hij-2026-11-18.pdf'),
    );
    const written = mockPdf.text.mock.calls.map((call) => call[0]).join('\n');
    expect(written).toContain('Transcripción de la llamada · abc-defg-hij');
    expect(written).toContain('Ana: me encanta esta aplicacion');
    expect(written).toContain('Juan: a mí también');
  });
});
