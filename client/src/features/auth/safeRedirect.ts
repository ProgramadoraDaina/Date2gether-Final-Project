const FALLBACK_ORIGIN = 'http://placeholder.invalid';

// Only same-origin relative paths are allowed as a post-login destination, so
// `?next=` cannot be used as an open redirect.
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  // Control characters (tabs/newlines are stripped by browsers) can smuggle a `//` past the check.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    return new URL(raw, FALLBACK_ORIGIN).origin === FALLBACK_ORIGIN ? raw : null;
  } catch {
    return null;
  }
}

export function loginUrlFor(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}

// Reads `?next=` from the current URL; falls back to `fallback` when absent or unsafe.
export function readNextPath(fallback = '/'): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return sanitizeNextPath(next) ?? fallback;
}
