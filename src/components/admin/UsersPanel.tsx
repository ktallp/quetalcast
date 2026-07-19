import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus, KeyRound, Ban, CircleCheck, Trash2, Copy, AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { relativeTime, absoluteUrl, copyToClipboard } from './format';

interface AdminUser {
  id: string;
  username: string;
  role: 'owner' | 'dj';
  disabled: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

interface InviteInfo {
  username: string;
  url: string;
  purpose: 'invite' | 'reset';
}

const USERNAME_RE = /^[a-z0-9-]{3,30}$/;

const AVATAR_COLORS = [
  'bg-emerald-600',
  'bg-sky-600',
  'bg-violet-600',
  'bg-rose-600',
  'bg-amber-600',
  'bg-teal-600',
  'bg-indigo-600',
  'bg-orange-600',
];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function roleChip(user: AdminUser) {
  if (user.disabled) {
    return <span className="status-badge status-offline text-[10px]">Disabled</span>;
  }
  if (user.role === 'owner') {
    return (
      <span
        className="status-badge text-[10px]"
        style={{ backgroundColor: 'hsl(var(--warning) / 0.15)', color: 'hsl(var(--warning))' }}
      >
        Owner
      </span>
    );
  }
  return <span className="status-badge status-receiving text-[10px]">DJ</span>;
}

export function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<'dj' | 'owner'>('dj');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [confirm, setConfirm] = useState<{ type: 'disable' | 'delete'; user: AdminUser } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async () => {
    const username = newUsername.trim();
    if (!USERNAME_RE.test(username)) {
      setFormError('Username must be 3-30 characters: lowercase letters, numbers, and hyphens.');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, role: newRole }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreateOpen(false);
        setNewUsername('');
        setNewRole('dj');
        setInvite({ username, url: absoluteUrl(data.inviteUrl), purpose: 'invite' });
        loadUsers();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to create user' }));
        toast.error(err.error || 'Failed to create user');
      }
    } catch {
      toast.error('Could not reach server');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (user: AdminUser) => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}/reset`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setInvite({ username: user.username, url: absoluteUrl(data.inviteUrl), purpose: 'reset' });
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to reset password' }));
        toast.error(err.error || 'Failed to reset password');
      }
    } catch {
      toast.error('Could not reach server');
    }
  };

  const setDisabled = async (user: AdminUser, disabled: boolean) => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ disabled }),
      });
      if (res.ok) {
        toast.success(disabled ? `${user.username} disabled` : `${user.username} enabled`);
        loadUsers();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to update user' }));
        toast.error(err.error || 'Failed to update user');
      }
    } catch {
      toast.error('Could not reach server');
    }
  };

  const handleDelete = async (user: AdminUser) => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        toast.success(`${user.username} deleted`);
        loadUsers();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to delete user' }));
        toast.error(err.error || 'Failed to delete user');
      }
    } catch {
      toast.error('Could not reach server');
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    if (confirm.type === 'disable') {
      await setDisabled(confirm.user, true);
    } else {
      await handleDelete(confirm.user);
    }
    setBusy(false);
    setConfirm(null);
  };

  const handleCopyInvite = async () => {
    if (!invite) return;
    if (await copyToClipboard(invite.url)) {
      toast.success('Invite link copied');
    } else {
      toast.error('Could not copy link');
    }
  };

  if (loading) {
    return (
      <div className="panel flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading users…
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel border-destructive/40 text-center py-8 space-y-2">
        <AlertTriangle className="h-5 w-5 text-destructive mx-auto" />
        <div className="text-sm font-mono text-destructive">Could not load users</div>
        <Button variant="secondary" size="sm" onClick={() => { setLoading(true); loadUsers(); }}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel">
        <div className="panel-header flex items-center justify-between">
          <span>Users</span>
          <Button size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Create User
          </Button>
        </div>

        {users.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">No users yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="stat-label text-left pb-2 pr-3 font-normal">User</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Role</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Status</th>
                  <th className="stat-label text-left pb-2 pr-3 font-normal">Last Active</th>
                  <th className="stat-label text-right pb-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${avatarColor(user.username)} ${user.disabled ? 'opacity-50' : ''}`}
                        >
                          {user.username.slice(0, 2).toUpperCase()}
                        </span>
                        <span className={`font-mono text-xs ${user.disabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {user.username}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">{roleChip(user)}</td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {user.disabled ? 'Disabled' : 'Active'}
                    </td>
                    <td className="py-2.5 pr-3 text-xs font-mono text-muted-foreground">
                      {relativeTime(user.lastActiveAt)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => handleReset(user)}
                          aria-label={`Reset password for ${user.username}`}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        {user.disabled ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => setDisabled(user, false)}
                            aria-label={`Enable ${user.username}`}
                          >
                            <CircleCheck className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => setConfirm({ type: 'disable', user })}
                            aria-label={`Disable ${user.username}`}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirm({ type: 'delete', user })}
                          aria-label={`Delete ${user.username}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create user dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setNewUsername('');
            setNewRole('dj');
            setFormError('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              New users receive an invite link and set their own password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="new-username" className="stat-label block mb-1.5">Username</label>
              <input
                id="new-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                placeholder="dj-name"
                autoComplete="off"
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                3-30 characters: lowercase letters, numbers, hyphens
              </p>
            </div>
            <div>
              <span className="stat-label block mb-1.5">Role</span>
              <RadioGroup
                value={newRole}
                onValueChange={(v) => setNewRole(v as 'dj' | 'owner')}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="dj" id="role-dj" />
                  <Label htmlFor="role-dj" className="text-sm font-mono">DJ</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="owner" id="role-owner" />
                  <Label htmlFor="role-owner" className="text-sm font-mono">Owner</Label>
                </div>
              </RadioGroup>
            </div>
            {formError && <div className="text-xs font-mono text-destructive">{formError}</div>}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite link dialog (create + reset) */}
      <Dialog open={invite !== null} onOpenChange={(open) => { if (!open) setInvite(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {invite?.purpose === 'reset' ? 'Password reset link' : 'Invite link'}
            </DialogTitle>
            <DialogDescription>
              Share this link with{' '}
              <span className="font-mono text-foreground">{invite?.username}</span>. They set their
              own password on first sign-in. Link expires in 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground overflow-x-auto whitespace-nowrap">
              {invite?.url}
            </code>
            <Button
              variant="secondary"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleCopyInvite}
              aria-label="Copy invite link"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setInvite(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable / Delete confirmation dialog */}
      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === 'delete' ? 'Delete user?' : 'Disable user?'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === 'delete' ? (
                <>
                  This permanently removes{' '}
                  <span className="font-mono text-foreground">{confirm?.user.username}</span> and
                  cannot be undone.
                </>
              ) : (
                <>
                  <span className="font-mono text-foreground">{confirm?.user.username}</span> will
                  no longer be able to sign in. You can re-enable them later.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={confirm?.type === 'delete' ? 'destructive' : 'default'}
              onClick={handleConfirm}
              disabled={busy}
            >
              {busy ? 'Working…' : confirm?.type === 'delete' ? 'Delete' : 'Disable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
