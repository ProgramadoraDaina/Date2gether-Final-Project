import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GIPHY_URL = 'https://api.giphy.com/v1/gifs';
const PAGE_SIZE = 24;
const REQUEST_TIMEOUT_MS = 5000;

// Formato propio, independiente del proveedor: cambiar GIPHY por otro solo toca este archivo.
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

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyResponse {
  data: {
    id: string;
    title: string;
    images: { fixed_width: GiphyImage; fixed_width_small: GiphyImage };
  }[];
  pagination: { total_count: number; count: number; offset: number };
}

@Injectable()
export class GifsService {
  private readonly logger = new Logger(GifsService.name);

  constructor(private readonly config: ConfigService) {}

  async search(query: string | undefined, offset = 0): Promise<GifPage> {
    const apiKey = this.config.get<string>('GIPHY_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('La búsqueda de GIFs no está configurada');

    // Sin texto se muestran los GIFs en tendencia, como en WhatsApp o Discord.
    const endpoint = query ? 'search' : 'trending';
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      rating: 'pg-13',
    });
    if (query) {
      params.set('q', query);
      params.set('lang', 'es');
    }

    let body: GiphyResponse;
    try {
      const response = await fetch(`${GIPHY_URL}/${endpoint}?${params}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`GIPHY ${response.status}`);
      body = (await response.json()) as GiphyResponse;
    } catch {
      // No registrar la URL: lleva la API key en la query.
      this.logger.warn('No se pudo consultar GIPHY');
      throw new ServiceUnavailableException('No se pudieron cargar los GIFs. Intentá nuevamente.');
    }

    const { offset: current, count, total_count } = body.pagination;
    const next = current + count;
    return {
      results: body.data.map((gif) => ({
        id: gif.id,
        title: gif.title,
        url: gif.images.fixed_width.url,
        previewUrl: gif.images.fixed_width_small.url,
        width: Number(gif.images.fixed_width.width),
        height: Number(gif.images.fixed_width.height),
      })),
      nextOffset: count > 0 && next < total_count && next <= 4999 ? next : null,
    };
  }
}
