import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_SOUND_SECONDS } from './emoji-media';

const API_URL = 'https://freesound.org/apiv2';
const PREVIEW_HOST = 'cdn.freesound.org';
const PAGE_SIZE = 15;
const REQUEST_TIMEOUT_MS = 8000;
const FIELDS = 'id,name,username,license,duration,previews';

export interface FreesoundSound {
  id: number;
  name: string;
  username: string;
  license: string;
  duration: number;
  previewUrl: string;
}

interface FreesoundApiSound {
  id: number;
  name: string;
  username: string;
  license: string;
  duration: number;
  previews: Record<string, string>;
}

// Freesound devuelve la licencia como URL de Creative Commons.
export function licenseLabel(url: string): string {
  if (/publicdomain\/zero/.test(url)) return 'CC0';
  const match = /licenses\/([a-z-]+)\/(\d+(?:\.\d+)?)/.exec(url);
  if (!match) return 'CC';
  return `CC ${match[1].toUpperCase()} ${match[2]}`;
}

export function attributionFor(
  sound: Pick<FreesoundSound, 'name' | 'username' | 'license' | 'id'>,
) {
  return `"${sound.name}" por ${sound.username} (${licenseLabel(sound.license)}) — freesound.org/s/${sound.id}`.slice(
    0,
    300,
  );
}

@Injectable()
export class FreesoundService {
  private readonly logger = new Logger(FreesoundService.name);

  constructor(private readonly config: ConfigService) {}

  async search(query: string): Promise<FreesoundSound[]> {
    const params = new URLSearchParams({
      query,
      filter: `duration:[0 TO ${MAX_SOUND_SECONDS}]`,
      fields: FIELDS,
      page_size: String(PAGE_SIZE),
    });
    const body = await this.request<{ results: FreesoundApiSound[] }>(`/search/?${params}`);
    return body.results.map(toSound).filter((s): s is FreesoundSound => s !== null);
  }

  // Se pide por id para no descargar nunca una URL elegida por el navegador (SSRF).
  async downloadForEmoji(id: number): Promise<{ data: Buffer; attribution: string }> {
    const sound = toSound(await this.request<FreesoundApiSound>(`/sounds/${id}/?fields=${FIELDS}`));
    if (!sound) throw new BadRequestException('Ese sonido de Freesound no está disponible');
    try {
      const response = await fetch(sound.previewUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`preview ${response.status}`);
      return {
        data: Buffer.from(await response.arrayBuffer()),
        attribution: attributionFor(sound),
      };
    } catch {
      this.logger.warn('No se pudo descargar el sonido de Freesound');
      throw new ServiceUnavailableException('No se pudo descargar el sonido. Intentá nuevamente.');
    }
  }

  private async request<T>(path: string): Promise<T> {
    const apiKey = this.config.get<string>('FREESOUND_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('La búsqueda de sonidos no está configurada');
    }
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      this.logger.warn('No se pudo consultar Freesound');
      throw new ServiceUnavailableException(
        'No se pudieron cargar los sonidos. Intentá nuevamente.',
      );
    }
    if (response.status === 404) {
      throw new BadRequestException('Ese sonido de Freesound no está disponible');
    }
    if (!response.ok) {
      this.logger.warn(`Freesound respondió ${response.status}`);
      throw new ServiceUnavailableException(
        'No se pudieron cargar los sonidos. Intentá nuevamente.',
      );
    }
    return (await response.json()) as T;
  }
}

function toSound(raw: FreesoundApiSound): FreesoundSound | null {
  const previewUrl = raw.previews?.['preview-hq-mp3'];
  if (!previewUrl || new URL(previewUrl).host !== PREVIEW_HOST) return null;
  return {
    id: raw.id,
    name: raw.name,
    username: raw.username,
    license: raw.license,
    duration: raw.duration,
    previewUrl,
  };
}
