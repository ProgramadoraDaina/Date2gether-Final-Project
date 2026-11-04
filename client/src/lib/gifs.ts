import { extractErrorMessage } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Gif {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface GifPage {
  results: Gif[];
  nextOffset: number | null;
}

export async function searchGifs(
  roomCode: string,
  roomToken: string,
  query: string,
  offset: number,
  signal?: AbortSignal,
): Promise<GifPage> {
  const params = new URLSearchParams({ offset: String(offset) });
  if (query) params.set('q', query);
  const res = await fetch(`${API_URL}/gifs/${encodeURIComponent(roomCode)}?${params}`, {
    headers: { Authorization: `Bearer ${roomToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'No se pudieron cargar los GIFs'));
  return res.json();
}
