export interface MentionSegment {
  text: string;
  mention: boolean;
}

export function splitMentions(text: string, names: readonly string[]): MentionSegment[] {
  const escaped = Array.from(new Set(names.filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return [{ text, mention: false }];
  const pattern = new RegExp(
    '(^|[^\\p{L}\\p{N}_@])(@(?:' + escaped.join('|') + '))(?![\\p{L}\\p{N}_])',
    'giu',
  );
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    if (start > last) segments.push({ text: text.slice(last, start), mention: false });
    segments.push({ text: match[2], mention: true });
    last = start + match[2].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: false });
  return segments;
}

export function getMentionQuery(value: string, caret: number) {
  const match = value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  let end = caret;
  while (end < value.length && /[^\s@]/u.test(value[end])) end++;
  return { start, end, query: match[1].toLocaleLowerCase() };
}
