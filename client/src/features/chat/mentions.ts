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

// Mencionar un rol pega a todos los que lo tienen (como @role en Discord),
// no a una sola persona. 'invitados' no es un RoomRole del backend (los
// invitados no tienen fila en room_members): es una categoría propia del
// chat para pegarles a todos los que no tienen cuenta en la sala.
export const ROLE_MENTION_KEYWORDS = [
  'administrador',
  'colaborador',
  'participante',
  'invitados',
] as const;

export interface MentionIdentity {
  name: string;
  // Rol de cuenta (coincide con RoomRole) y/o 'invitados' si es invitado.
  // Vacío si todavía no se resolvió (ej. antes de que cargue el rol).
  roleKeywords: readonly string[];
}

export function isSelfMentioned(text: string, identity: MentionIdentity): boolean {
  const names = [identity.name, ...identity.roleKeywords].filter((value) => value.trim());
  if (!names.length) return false;
  return splitMentions(text, names).some((segment) => segment.mention);
}

export function getMentionQuery(value: string, caret: number) {
  const match = value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  let end = caret;
  while (end < value.length && /[^\s@]/u.test(value[end])) end++;
  return { start, end, query: match[1].toLocaleLowerCase() };
}
