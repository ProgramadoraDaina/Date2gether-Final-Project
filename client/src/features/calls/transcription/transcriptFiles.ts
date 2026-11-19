import type { TranscriptEntry } from '@/lib/transcripts';

export function formatTranscriptTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function transcriptFileName(roomCode: string, lines: TranscriptEntry[], ext: 'txt' | 'pdf') {
  const day = (lines[0]?.spokenAt ?? new Date().toISOString()).slice(0, 10);
  return `transcripcion-${roomCode}-${day}.${ext}`;
}

export function transcriptToText(title: string, lines: TranscriptEntry[]): string {
  const body = lines.map(
    (line) => `[${formatTranscriptTime(line.spokenAt)}] ${line.speakerName}: ${line.content}`,
  );
  return [title, '', ...body, ''].join('\n');
}

export function downloadTranscriptTxt(fileName: string, title: string, lines: TranscriptEntry[]) {
  const blob = new Blob([transcriptToText(title, lines)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const PDF_MARGIN = 15;
const PDF_LINE_HEIGHT = 6;

export async function downloadTranscriptPdf(
  fileName: string,
  title: string,
  lines: TranscriptEntry[],
) {
  // Import dinámico: jsPDF pesa ~100 KB y solo se usa al exportar.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  const width = doc.internal.pageSize.getWidth() - PDF_MARGIN * 2;
  const bottom = doc.internal.pageSize.getHeight() - PDF_MARGIN;
  let y = PDF_MARGIN;

  doc.setFontSize(14);
  doc.text(title, PDF_MARGIN, y);
  y += PDF_LINE_HEIGHT * 2;
  doc.setFontSize(10);

  for (const line of lines) {
    const head = `[${formatTranscriptTime(line.spokenAt)}] ${line.speakerName}: `;
    const wrapped: string[] = doc.splitTextToSize(head + line.content, width);
    for (const row of wrapped) {
      if (y > bottom) {
        doc.addPage();
        y = PDF_MARGIN;
      }
      doc.text(row, PDF_MARGIN, y);
      y += PDF_LINE_HEIGHT;
    }
    y += PDF_LINE_HEIGHT / 2;
  }
  doc.save(fileName);
}
