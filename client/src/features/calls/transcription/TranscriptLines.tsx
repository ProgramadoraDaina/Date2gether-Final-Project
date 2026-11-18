import type { TranscriptEntry } from '@/lib/transcripts';
import { formatTranscriptTime } from './transcriptFiles';
import styles from './TranscriptDialog.module.css';

export function TranscriptLines({ lines }: { lines: TranscriptEntry[] }) {
  return (
    <ol className={styles.lines}>
      {lines.map((line) => (
        <li key={line.id} className={styles.line}>
          <time className={styles.time} dateTime={line.spokenAt}>
            {formatTranscriptTime(line.spokenAt)}
          </time>
          <span className={styles.speaker}>{line.speakerName}</span>
          <span>{line.content}</span>
        </li>
      ))}
    </ol>
  );
}
