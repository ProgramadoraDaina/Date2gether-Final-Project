import { extractErrorMessage } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface MusicSearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
}

export async function searchMusic(
  roomCode: string,
  roomToken: string,
  query: string,
): Promise<MusicSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${API_URL}/music-search/${encodeURIComponent(roomCode)}?${params}`, {
    headers: { Authorization: `Bearer ${roomToken}` },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'No se pudo buscar en YouTube'));
  return (await res.json()) as MusicSearchResult[];
}

export function youTubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
