import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MusicSearchService } from './music-search.service';

const fetchMock = jest.fn<typeof fetch>();

function serviceWithKey() {
  return new MusicSearchService(new ConfigService({ YOUTUBE_API_KEY: 'test-key' }));
}

describe('MusicSearchService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    fetchMock.mockReset();
  });

  it('responde 503 sin consultar a YouTube cuando falta YOUTUBE_API_KEY', async () => {
    global.fetch = fetchMock;
    const service = new MusicSearchService(new ConfigService({}));

    await expect(service.search('queen')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca solo videos embebibles y devuelve resultados con el título decodificado', async () => {
    global.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: { videoId: 'fJ9rUzIMcZQ' },
              snippet: {
                title: 'Queen &amp; Friends &#39;Bohemian&#39; &quot;Live&quot;',
                channelTitle: 'Queen Official',
                thumbnails: { default: { url: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/default.jpg' } },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const results = await serviceWithKey().search('bohemian');

    expect(results).toEqual([
      {
        videoId: 'fJ9rUzIMcZQ',
        title: 'Queen & Friends \'Bohemian\' "Live"',
        channel: 'Queen Official',
        thumbnailUrl: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/default.jpg',
      },
    ]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/search');
    expect(url.searchParams.get('q')).toBe('bohemian');
    expect(url.searchParams.get('type')).toBe('video');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(url.searchParams.get('key')).toBe('test-key');
  });

  it('responde 503 cuando YouTube rechaza el pedido (por ejemplo, cuota agotada)', async () => {
    global.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));

    await expect(serviceWithKey().search('queen')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
