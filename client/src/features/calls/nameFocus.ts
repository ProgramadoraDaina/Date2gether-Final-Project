interface MentionableTrack {
  participant: { identity: string; name?: string };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Matches on the participant's first name only (tokenized), so "Juan Pérez"
// is found when someone says "Juan". Intentionally simple: no fuzzy/accent
// normalization beyond what \p{L} tokenizing already gives for free.
export function findMentionedParticipant<T extends MentionableTrack>(
  text: string,
  tracks: T[],
  excludeIdentity?: string,
): T | undefined {
  const words = new Set(tokenize(text));
  return tracks.find((track) => {
    if (track.participant.identity === excludeIdentity) return false;
    const displayName = (track.participant.name || track.participant.identity).trim();
    if (!displayName) return false;
    const firstName = displayName.split(/\s+/)[0]?.toLowerCase();
    return !!firstName && words.has(firstName);
  });
}
