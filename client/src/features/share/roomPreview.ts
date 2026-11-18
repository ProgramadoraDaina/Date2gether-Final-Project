const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface RoomPreview {
  name: string;
  isPermanent: boolean;
}

// Public room info for link previews; a missing or expired room falls back to the generic card.
export async function getRoomPreview(code: string): Promise<RoomPreview | null> {
  try {
    const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const room = (await res.json()) as Partial<RoomPreview>;
    return typeof room.name === 'string'
      ? { name: room.name, isPermanent: Boolean(room.isPermanent) }
      : null;
  } catch {
    return null;
  }
}
