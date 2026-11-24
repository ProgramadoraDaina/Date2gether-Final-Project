import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const ACCESS_TOKEN_KEY = 'date2gether:accessToken';

async function renderGuarded() {
  const { RequireAuth } = await import('./RequireAuth');
  return render(
    <RequireAuth>
      <p>private content</p>
    </RequireAuth>,
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    replace.mockClear();
    window.history.replaceState(null, '', '/rooms?x=1');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('redirects to /login with the current path and query, and never renders the content', async () => {
    await renderGuarded();
    expect(replace).toHaveBeenCalledWith('/login?next=%2Frooms%3Fx%3D1');
    expect(screen.queryByText('private content')).not.toBeInTheDocument();
  });

  it('renders the children and does not redirect when a session exists', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token');
    await renderGuarded();
    expect(screen.getByText('private content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects when the session ends in this tab (refresh failed, logout)', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token');
    await renderGuarded();
    const { clearTokens } = await import('@/lib/auth');
    act(() => clearTokens());
    expect(replace).toHaveBeenCalledWith('/login?next=%2Frooms%3Fx%3D1');
    expect(screen.queryByText('private content')).not.toBeInTheDocument();
  });

  it('redirects when another tab logs out (storage event)', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token');
    await renderGuarded();
    act(() => {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: ACCESS_TOKEN_KEY }));
    });
    expect(replace).toHaveBeenCalledWith('/login?next=%2Frooms%3Fx%3D1');
  });

  it('re-checks when the page is restored from the back/forward cache', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'token');
    await renderGuarded();
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(replace).toHaveBeenCalledWith('/login?next=%2Frooms%3Fx%3D1');
    expect(screen.queryByText('private content')).not.toBeInTheDocument();
  });
});
