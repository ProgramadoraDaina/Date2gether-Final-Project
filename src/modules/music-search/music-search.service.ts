import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const MAX_RESULTS = 8;
const REQUEST_TIMEOUT_MS = 5000;

export interface MusicSearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
}

interface YouTubeSearchResponse {
  items?: {
    id: { videoId?: string };
    snippet: {
      title: string;
      channelTitle: string;
      thumbnails: { default?: { url: string } };
    };
  }[];
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

// YouTube returns snippet titles HTML-escaped.
function decodeEntities(text: string): string {
  return text.replace(/&(amp|quot|#39|lt|gt);/g, (entity) => HTML_ENTITIES[entity]);
}

@Injectable()
export class MusicSearchService {
  private readonly logger = new Logger(MusicSearchService.name);

  constructor(private readonly config: ConfigService) {}

  async search(query: string): Promise<MusicSearchResult[]> {
    const apiKey = this.config.get<string>('YOUTUBE_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('La búsqueda de música no está configurada');

    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true',
      maxResults: String(MAX_RESULTS),
      q: query,
      key: apiKey,
    });

    let body: YouTubeSearchResponse;
    try {
      const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`YouTube ${response.status}`);
      body = (await response.json()) as YouTubeSearchResponse;
    } catch {
      // Never log the URL: it carries the API key.
      this.logger.warn('No se pudo consultar YouTube');
      throw new ServiceUnavailableException(
        'No se pudo buscar en YouTube. Probá de nuevo más tarde.',
      );
    }

    return (body.items ?? [])
      .filter((item) => item.id.videoId)
      .map((item) => ({
        videoId: item.id.videoId as string,
        title: decodeEntities(item.snippet.title),
        channel: decodeEntities(item.snippet.channelTitle),
        thumbnailUrl: item.snippet.thumbnails.default?.url ?? '',
      }));
  }
}
