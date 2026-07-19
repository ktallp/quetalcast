import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Radio, AlertTriangle, Loader2 } from 'lucide-react';
import { Footer } from '@/components/Footer';

interface InviteState {
  valid: boolean;
  username?: string;
  purpose?: 'invite' | 'reset';
}

const Join = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState<InviteState | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvite({ valid: false });
      setChecking(false);
      return;
    }
    const check = async () => {
      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setInvite(data);
        } else {
          setInvite({ valid: false });
        }
      } catch {
        setInvite({ valid: false });
      } finally {
        setChecking(false);
      }
    };
    check();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token || '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        toast.success('Password set. Sign in to continue.');
        navigate('/login');
      } else {
        const err = await res.json().catch(() => ({ error: 'Could not set password' }));
        setError(err.error || 'Could not set password');
      }
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <Radio className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">QueTal Cast</h1>
          <p className="text-sm text-muted-foreground mt-1">101.5 KTAL-LP</p>
        </div>

        {checking ? (
          <div className="panel w-full max-w-sm flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking invite…
          </div>
        ) : !invite?.valid ? (
          <div className="panel w-full max-w-sm text-center space-y-3 py-8">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
            <div className="text-sm font-semibold text-foreground">Invite link invalid or expired</div>
            <p className="text-xs text-muted-foreground">
              Ask the station owner for a new link.
            </p>
            <Link to="/login" className="inline-block text-sm text-primary hover:underline font-mono">
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="panel space-y-4 w-full max-w-sm">
            <div className="text-sm text-muted-foreground">
              {invite.purpose === 'reset' ? 'Set a new password for' : 'Welcome,'}{' '}
              <span className="font-mono text-foreground">{invite.username}</span>
              {invite.purpose === 'reset' ? '.' : '. Choose a password to finish setting up your account.'}
            </div>
            <div>
              <label htmlFor="join-password" className="stat-label block mb-1.5">Password</label>
              <input
                id="join-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground mt-1">At least 8 characters</p>
            </div>
            <div>
              <label htmlFor="join-confirm" className="stat-label block mb-1.5">Confirm Password</label>
              <input
                id="join-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {error && (
              <div className="text-xs font-mono text-destructive">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Set Password'}
            </button>
          </form>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default Join;
