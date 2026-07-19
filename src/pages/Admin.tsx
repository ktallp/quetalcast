import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated, isOwner, verifySession } from '@/lib/auth';
import { Shield } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RoomsPanel, type AdminRoom, type RoomStats } from '@/components/admin/RoomsPanel';
import { UsersPanel } from '@/components/admin/UsersPanel';

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
        <div className={`status-badge ${serverStatus === 'online' ? 'status-on-air' : 'status-offline'}`}>
          Server: {serverStatus}
        </div>
      </div>

      <div className="flex-1 p-4 max-w-5xl mx-auto w-full">
        <Tabs defaultValue="rooms">
          <TabsList>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            {owner && <TabsTrigger value="users">Users</TabsTrigger>}
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

          {owner && (
            <TabsContent value="users" className="mt-4">
              <UsersPanel />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;
