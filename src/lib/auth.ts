const AUTH_KEY = 'webrtc-bridge-auth';

export type UserRole = 'owner' | 'dj';

export interface AuthSession {
  username: string;
  role?: UserRole;
  timestamp: number;
}

export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      const data = await res.json();
      const session: AuthSession = {
        username: data.username,
        role: data.role,
        timestamp: Date.now(),
      };
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      return { ok: true };
    }

    const err = await res.json().catch(() => ({ error: 'Login failed' }));
    return { ok: false, error: err.error || 'Invalid credentials' };
  } catch {
    return { ok: false, error: 'Could not reach server' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore network errors during logout
  }
  localStorage.removeItem(AUTH_KEY);
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function getRole(): UserRole | null {
  return getSession()?.role ?? null;
}

export function isOwner(): boolean {
  return getRole() === 'owner';
}

/** Verify the session cookie is still valid on the server. Clears local auth if not. */
export async function verifySession(): Promise<boolean> {
  try {
    const res = await fetch('/api/session', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.authenticated) {
        // Refresh the stored username/role from the server
        const session: AuthSession = {
          username: data.username,
          role: data.role,
          timestamp: Date.now(),
        };
        localStorage.setItem(AUTH_KEY, JSON.stringify(session));
        return true;
      }
      localStorage.removeItem(AUTH_KEY);
      return false;
    }
    // Server says session is invalid, clear local auth
    localStorage.removeItem(AUTH_KEY);
    return false;
  } catch {
    // Network error, keep local auth, don't lock user out
    return true;
  }
}
