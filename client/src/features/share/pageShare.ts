import type { Metadata } from 'next';
import { requestOrigin } from './origin';
import { SHARE_IMAGE_SIZE } from './shareCard';

// Nested openGraph/twitter objects replace the parent's, so every page rebuilds them with the image.
export async function shareMetadata(
  title: string,
  description: string,
  previewTitle: string = title,
): Promise<Metadata> {
  const origin = await requestOrigin();
  const images = [{ url: new URL('/og', origin).href, ...SHARE_IMAGE_SIZE, alt: 'Date2gether' }];
  return {
    title,
    description,
    openGraph: {
      type: 'website',
      siteName: 'Date2gether',
      locale: 'es_AR',
      title: previewTitle,
      description,
      images,
    },
    twitter: { card: 'summary_large_image', title: previewTitle, description, images },
  };
}
