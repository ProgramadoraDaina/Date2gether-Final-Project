/**
 * Reads the allowed CORS origin from CORS_ORIGIN. There is deliberately no
 * fallback: a missing value would silently open the API to any origin, so the
 * app refuses to boot instead (fail-fast). Only a single origin is supported,
 * which is what every environment (dev, e2e, EC2) uses today.
 */
export function getCorsOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const origin = env.CORS_ORIGIN?.trim();
  if (!origin) {
    throw new Error(
      'CORS_ORIGIN is not set. Define it as the frontend origin (e.g. http://localhost:3002); see .env.example.',
    );
  }
  if (origin === '*') {
    throw new Error(
      "CORS_ORIGIN must be the frontend's own origin, not a wildcard. See .env.example.",
    );
  }
  let normalized: string | null = null;
  try {
    normalized = new URL(origin).origin;
  } catch {
    normalized = null;
  }
  if (normalized !== origin) {
    throw new Error(
      `CORS_ORIGIN must be a bare origin (scheme + host[:port], no path or trailing slash), e.g. https://app.example.com. Received: ${origin}`,
    );
  }
  return origin;
}
