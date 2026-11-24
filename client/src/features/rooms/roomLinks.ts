const URL_PATTERN = /https?:\/\/[^\s<>"]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;
const MAX_TITLE_LENGTH = 120;

export function linkFromMessage(text: string): { url: string; title?: string } | null {
  const match = URL_PATTERN.exec(text);
  if (!match) return null;
  const url = match[0].replace(TRAILING_PUNCTUATION, '');
  const rest = (text.slice(0, match.index) + text.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return { url, title: rest ? rest.slice(0, MAX_TITLE_LENGTH) : undefined };
}
