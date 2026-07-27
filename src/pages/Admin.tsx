import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated, isOwner, logout, verifySession } from '@/lib/auth';
import { Shield, Radio, LogOut } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RoomsPanel, type AdminRoom, type RoomStats } from '@/components/admin/RoomsPanel';
import { BroadcastsPanel } from '@/components/admin/BroadcastsPanel';
import { UsersPanel } from '@/components/admin/UsersPanel';
import { CompliancePanel } from '@/components/admin/CompliancePanel';
import { ArchivesPanel } from '@/components/admin/ArchivesPanel';

const Admin = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const owner = isOwner();

  // Auth gate: quick local check, then verify against the server
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/login');
      return;
    }
    verifySession().then((valid) => {
      if (!valid) navigate('/login');
    });
  }, [navigate]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/admin/rooms', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats || null);
        setRooms(data.rooms || []);
        setServerStatus('online');
      } else if (res.status === 401 || res.status === 403) {
        navigate('/login');
      } else {
        setServerStatus('offline');
      }
    } catch {
      setServerStatus('offline');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [poll]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
        <div className="flex items-center gap-2 text-sm font-mono font-semibold text-foreground">
          <Shield className="h-4 w-4 text-primary" />
          ADMIN
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/broadcast')}
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors bg-secondary px-3 py-1.5 rounded-md"
            aria-label="Back to the broadcaster console"
          >
            <Radio className="h-3 w-3" aria-hidden />
            Console
          </button>
          <button
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors bg-secondary px-3 py-1.5 rounded-md"
            aria-label="Log out"
          >
            <LogOut className="h-3 w-3" aria-hidden />
            Log out
          </button>
          <div className={`status-badge ${serverStatus === 'online' ? 'status-on-air' : 'status-offline'}`}>
            Server: {serverStatus}
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 max-w-5xl mx-auto w-full">
        <Tabs defaultValue="rooms">
          <TabsList>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>
            {owner && <TabsTrigger value="users">Users</TabsTrigger>}
            {owner && <TabsTrigger value="compliance">Compliance</TabsTrigger>}
            {owner && <TabsTrigger value="archives">Archives</TabsTrigger>}
          </TabsList>

          <TabsContent value="rooms" className="mt-4">
            <RoomsPanel
              stats={stats}
              rooms={rooms}
              loading={loading}
              error={serverStatus === 'offline'}
              isOwner={owner}
              onRefresh={poll}
            />
          </TabsContent>

          <TabsContent value="broadcasts" className="mt-4">
            <BroadcastsPanel isOwner={owner} />
          </TabsContent>

          {owner && (
            <TabsContent value="users" className="mt-4">
              <UsersPanel />
            </TabsContent>
          )}

          {owner && (
            <TabsContent value="compliance" className="mt-4">
              <CompliancePanel />
            </TabsContent>
          )}

          {owner && (
            <TabsContent value="archives" className="mt-4">
              <ArchivesPanel />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;
