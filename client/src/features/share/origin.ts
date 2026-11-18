import { headers } from 'next/headers';

// Absolute URLs follow whoever served the request (localhost, a tunnel or prod) with no per-env config.
export async function requestOrigin(): Promise<URL> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get('x-forwarded-proto') ?? (isLocal ? 'http' : 'https');
  return new URL(`${proto}://${host}`);
}
