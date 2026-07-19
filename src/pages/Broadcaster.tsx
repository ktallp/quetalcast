import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isAuthenticated, verifySession } from '@/lib/auth';
import { useSignaling } from '@/hooks/useSignaling';
import { useWebRTC, type ConnectionStatus, type AudioQuality } from '@/hooks/useWebRTC';
import { useAudioAnalyser } from '@/hooks/useAudioAnalyser';
import { StatusBar } from '@/components/StatusBar';
import { LevelMeter } from '@/components/LevelMeter';
import { HealthPanel } from '@/components/HealthPanel';
import { EventLog, createLogEntry, type LogEntry } from '@/components/EventLog';
import {
  Mic, Radio, Music, Sparkles, Zap, Plug2, Keyboard, Monitor, MonitorOff,
  Download, SlidersHorizontal, Copy, ListMusic, ScrollText, Ear,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAudioMixer } from '@/hooks/useAudioMixer';
import { useMicEffects } from '@/hooks/useMicEffects';
import { SoundBoard } from '@/components/SoundBoard';
import { NowPlayingInput, type NowPlayingMeta, type TrackMeta } from '@/components/NowPlayingInput';
import { TrackList, type Track } from '@/components/TrackList';
import { EffectsBoard } from '@/components/EffectsBoard';
import { Footer } from '@/components/Footer';
import { ChatPanel } from '@/components/ChatPanel';
import { IntegrationsSheet } from '@/components/IntegrationsSheet';
import { useIntegrationStream, type RelayStatus } from '@/hooks/useIntegrationStream';
import { useAutoIdentify } from '@/hooks/useAutoIdentify';
import { useRelayStream } from '@/hooks/useRelayStream';
import { getIntegration, type IntegrationConfig } from '@/lib/integrations';
import { getPresets, savePreset, deletePreset, type Preset } from '@/lib/presets';
import { type EffectName } from '@/hooks/useMicEffects';
import { useRecorder } from '@/hooks/useRecorder';
import { useKeyboardShortcuts, SHORTCUT_MAP } from '@/hooks/useKeyboardShortcuts';
import { downloadBroadcastZip } from '@/lib/zip-export';
import { PreBroadcastModal, type BroadcastSettings } from '@/components/PreBroadcastModal';
import { TransportBar, formatClock } from '@/components/broadcast/TransportBar';
import { MixerBoard, type ChannelStripState, type ChannelPatch } from '@/components/broadcast/MixerBoard';
import { SidePanel } from '@/components/broadcast/SidePanel';
import { ShareLinks, receiveLinkFor } from '@/components/broadcast/ShareLinks';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { copyText } from '@/lib/clipboard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const WS_URL = import.meta.env.VITE_WS_URL || (
  window.location.protocol === 'https:'
    ? `wss://${window.location.host}`
    : `ws://${window.location.hostname}:3001`
);

const BROADCASTER_LAYOUT_STORAGE_KEY = 'quetalcast:broadcaster-layout:v1';
const ACTIVE_BROADCAST_KEY = 'quetalcast:active-broadcast';
const API_BASE = import.meta.env.VITE_API_URL || '';

type SideTab = 'sounds' | 'effects' | 'tracks' | 'log';

type PersistedBroadcasterLayout = {
  qualityMode: AudioQuality;
  limiterDb: 0 | -3 | -6 | -12;
  micVolume: number;
  micMuted: boolean;
  micSolo: boolean;
  micPan: number;
  systemAudioVolume: number;
  systemAudioMuted: boolean;
  systemAudioSolo: boolean;
  systemAudioPan: number;
  padsVolume: number;
  padsMuted: boolean;
  padsSolo: boolean;
  padsPan: number;
  micMonitor: boolean;
  systemMonitor: boolean;
  padsMonitor: boolean;
  duckPads: boolean;
  duckSystem: boolean;
  autoIdentify: boolean;
  selectedDevice: string;
  sideTab: SideTab;
  effects: Record<EffectName, { enabled: boolean; params: Record<string, number> }>;
};

function readPersistedLayout(): Partial<PersistedBroadcasterLayout> | null {
  try {
    const raw = localStorage.getItem(BROADCASTER_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedBroadcasterLayout>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const Broadcaster = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isOnAir, setIsOnAir] = useState(false);
  const [goingOnAir, setGoingOnAir] = useState(false);
  const [micVolume, setMicVolume] = useState(100);
  const [micMuted, setMicMuted] = useState(false);
  const [micSolo, setMicSolo] = useState(false);
  const [micPan, setMicPan] = useState(0);
  const [listening, setListening] = useState(false);
  const [cueMode, setCueMode] = useState(false);
  const [limiterDb, setLimiterDb] = useState<0 | -3 | -6 | -12>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [nowPlaying, setNowPlaying] = useState('');
  const [, setNowPlayingCover] = useState<string | undefined>();
  const nowPlayingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trackList, setTrackList] = useState<Track[]>([]);
  const [presets, setPresets] = useState(() => getPresets());
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [deletePresetName, setDeletePresetName] = useState<string | null>(null);
  const [qualityMode, setQualityMode] = useState<AudioQuality>('auto');
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  // Pre-broadcast modal state
  const [preBroadcastOpen, setPreBroadcastOpen] = useState(false);
  const pendingBroadcastSettingsRef = useRef<BroadcastSettings | null>(null);

  // Broadcast recovery state
  const [recoveryRoomId, setRecoveryRoomId] = useState<string | null>(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);

  // Integration state
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationConfig | null>(null);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const integrationStream = useIntegrationStream();
  const recorder = useRecorder();
  const soundboardTriggerRef = useRef<((index: number) => void) | null>(null);

  // System audio state
  const [systemAudioActive, setSystemAudioActive] = useState(false);
  const [systemAudioVolume, setSystemAudioVolume] = useState(100);
  const [systemAudioMuted, setSystemAudioMuted] = useState(false);
  const [systemAudioSolo, setSystemAudioSolo] = useState(false);
  const [systemAudioPan, setSystemAudioPan] = useState(0);
  const [padsVolume, setPadsVolume] = useState(100);
  const [padsMuted, setPadsMuted] = useState(false);
  const [padsSolo, setPadsSolo] = useState(false);
  const [padsPan, setPadsPan] = useState(0);
  const [micMonitor, setMicMonitor] = useState(false);
  const [systemMonitor, setSystemMonitor] = useState(false);
  const [padsMonitor, setPadsMonitor] = useState(true);
  const [duckPads, setDuckPads] = useState(false);
  const [duckSystem, setDuckSystem] = useState(false);
  const [autoIdentifyAvailable, setAutoIdentifyAvailable] = useState(false);
  const [autoIdentifyOn, setAutoIdentifyOn] = useState(false);
  const [systemAudioInfoOpen, setSystemAudioInfoOpen] = useState(false);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const [channelLevels, setChannelLevels] = useState({ mic: 0, system: 0, pads: 0 });

  /** Preview stream for the level meter when not on air, so levels can be set before going live */
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const [startBroadcastDialogOpen, setStartBroadcastDialogOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('sounds');

  const mixerPanelRef = useRef<HTMLDivElement | null>(null);
  const sidePanelRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs((prev) => [...prev.slice(-100), createLogEntry(msg, level)]);
  }, []);

  const signaling = useSignaling(WS_URL);
  const relayStream = useRelayStream(signaling);
  const webrtc = useWebRTC(signaling, 'broadcaster');
  const mixer = useAudioMixer();
  const micEffects = useMicEffects();
  /** Level meter: prefer the mixer stream so mic/system gains are reflected pre-broadcast too */
  const levelMeterStream = mixer.mixedStream || previewStream;
  const audioAnalysis = useAudioAnalyser(levelMeterStream);

  // Auth check: verify both the local token and the server session
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/login');
      return;
    }
    verifySession().then((valid) => {
      if (!valid) navigate('/login');
    });
  }, [navigate]);

  // Auto-identify availability depends on the server having an AcoustID key
  useEffect(() => {
    fetch(`${API_BASE}/api/capabilities`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAutoIdentifyAvailable(Boolean(data?.autoIdentify)))
      .catch(() => setAutoIdentifyAvailable(false));
  }, []);

  // Check for a recoverable broadcast on mount
  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_BROADCAST_KEY);
    if (!saved) return;
    fetch(`${API_BASE}/api/room-status/${encodeURIComponent(saved)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.exists && data.recoverable) {
          setRecoveryRoomId(saved);
          setRecoveryDialogOpen(true);
        } else {
          localStorage.removeItem(ACTIVE_BROADCAST_KEY);
        }
      })
      .catch(() => localStorage.removeItem(ACTIVE_BROADCAST_KEY));
  }, []);

  // Enumerate devices
  useEffect(() => {
    async function getDevices() {
      try {
        // Need permission first to get labels
        const tempStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        tempStream.getTracks().forEach((t) => t.stop());

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices.filter((d) => d.kind === 'audioinput');
        setDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId);
        }
        addLog(`Found ${audioInputs.length} audio input${audioInputs.length !== 1 ? 's' : ''}`);
      } catch (e) {
        addLog('Couldn\'t find audio devices. Check permissions.', 'error');
      }
    }
    getDevices();
  }, [addLog, selectedDevice]);

  // Preview stream for level meter when not on air
  const previewStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (isOnAir || !selectedDevice) {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((t) => t.stop());
        previewStreamRef.current = null;
      }
      setPreviewStream(null);
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: { exact: selectedDevice },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: { ideal: 48000 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        setPreviewStream(stream);
      })
      .catch(() => {
        if (!cancelled) setPreviewStream(null);
      });
    return () => {
      cancelled = true;
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((t) => t.stop());
        previewStreamRef.current = null;
      }
      setPreviewStream(null);
    };
  }, [isOnAir, selectedDevice]);

  // Keep the preview mic connected to the mixer while off air so mic gain/mute
  // affect the level meter consistently.
  useEffect(() => {
    if (!isOnAir && previewStream) {
      mixer.connectMic(previewStream);
    } else if (!isOnAir && !previewStream) {
      mixer.disconnectMic();
    }
  }, [
    isOnAir,
    previewStream,
    mixer.connectMic,
    mixer.disconnectMic,
  ]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (ts - last >= 80) {
        last = ts;
        const next = mixer.getChannelLevels();
        setChannelLevels((prev) => {
          const closeEnough = Math.abs(prev.mic - next.mic) < 0.015
            && Math.abs(prev.system - next.system) < 0.015
            && Math.abs(prev.pads - next.pads) < 0.015;
          return closeEnough ? prev : next;
        });
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [mixer]);

  // Channel-strip mixer math: if any solo is active, only soloed channels pass.
  useEffect(() => {
    const anySolo = micSolo || systemAudioSolo || padsSolo;
    const micAllowed = !anySolo || micSolo;
    const systemAllowed = !anySolo || systemAudioSolo;
    const padsAllowed = !anySolo || padsSolo;

    const micGain = (micMuted || !micAllowed) ? 0 : micVolume / 100;
    const systemGain = (!systemAudioActive || systemAudioMuted || !systemAllowed) ? 0 : systemAudioVolume / 100;
    const padsGain = (padsMuted || !padsAllowed) ? 0 : padsVolume / 100;

    mixer.setMicVolume(micGain);
    mixer.setMicPan(micPan / 100);
    mixer.setMicMuted(micMuted);

    mixer.setSystemAudioVolume(systemGain);
    mixer.setSystemAudioPan(systemAudioPan / 100);

    mixer.setPadsVolume(padsGain);
    mixer.setPadsPan(padsPan / 100);
  }, [
    micSolo,
    systemAudioSolo,
    padsSolo,
    micMuted,
    micVolume,
    micPan,
    systemAudioActive,
    systemAudioMuted,
    systemAudioVolume,
    systemAudioPan,
    padsMuted,
    padsVolume,
    padsPan,
    mixer,
  ]);

  // Sync per-channel headphone monitor state to the mixer
  useEffect(() => {
    mixer.setMicMonitor(micMonitor);
  }, [micMonitor, mixer]);

  useEffect(() => {
    mixer.setSystemMonitor(systemMonitor);
  }, [systemMonitor, mixer]);

  useEffect(() => {
    mixer.setPadsMonitor(padsMonitor);
  }, [padsMonitor, mixer]);

  // Sync auto-duck settings to the mixer
  useEffect(() => {
    mixer.setDucking('pads', duckPads);
  }, [duckPads, mixer]);

  useEffect(() => {
    mixer.setDucking('system', duckSystem);
  }, [duckSystem, mixer]);

  const statusLabels: Record<ConnectionStatus, string> = {
    idle: 'Ready',
    connecting: 'Setting up broadcast…',
    'on-air': 'You\'re on air',
    receiving: 'Receiving',
    disconnected: 'Disconnected',
    error: 'Something went wrong',
  };

  // Connect signaling
  useEffect(() => {
    signaling.connect();
    addLog('Connecting…');
    return () => signaling.disconnect();
  }, []);

  useEffect(() => {
    if (signaling.connected) addLog('Connected to server');
  }, [signaling.connected]);

  // Handle auth errors and room creation errors from signaling
  useEffect(() => {
    const unsub = signaling.subscribe((msg) => {
      if (msg.type === 'error' && msg.code === 'AUTH_REQUIRED') {
        addLog('Session expired. Please log in again.', 'warn');
        localStorage.removeItem('webrtc-bridge-auth');
        setTimeout(() => navigate('/login'), 500);
      }
      if (msg.type === 'error' && (msg.code === 'INVALID_ROOM_ID' || msg.code === 'ROOM_ID_TAKEN')) {
        const errMsg = typeof msg.message === 'string' ? msg.message : 'Invalid room ID';
        toast.error(errMsg);
        addLog(errMsg, 'error');
        setIsOnAir(false);
      }
    });
    return unsub;
  }, [signaling, navigate, addLog]);

  // Listen for listener count, chat, and track list updates
  useEffect(() => {
    const unsub = signaling.subscribe((msg) => {
      if (msg.type === 'listener-count' && typeof msg.count === 'number') {
        setListenerCount(msg.count as number);
      }
      if (msg.type === 'chat' && typeof msg.text === 'string' && !msg.system) {
        addLog(`${msg.name}: ${msg.text}`, 'chat');
      }
      if (msg.type === 'track-list' && Array.isArray(msg.tracks)) {
        setTrackList(msg.tracks as Track[]);
      }
    });
    return unsub;
  }, [signaling, addLog]);

  // Log status changes
  const prevStatus = useRef<ConnectionStatus>('idle');
  useEffect(() => {
    if (webrtc.status !== prevStatus.current) {
      addLog(statusLabels[webrtc.status] || webrtc.status);
      prevStatus.current = webrtc.status;
    }
  }, [webrtc.status, addLog]);

  // Update URL with room ID when broadcast starts; persist for recovery
  useEffect(() => {
    if (webrtc.roomId) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('room', webrtc.roomId!);
        return next;
      }, { replace: true });
      if (isOnAir) localStorage.setItem(ACTIVE_BROADCAST_KEY, webrtc.roomId);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('room');
        if (next.toString() === '') return {};
        return next;
      }, { replace: true });
    }
  }, [webrtc.roomId, isOnAir, setSearchParams]);

  const broadcastStartedRef = useRef(false);
  const isOnAirRef = useRef(isOnAir);
  isOnAirRef.current = isOnAir;
  const recordingAfterBroadcastRef = useRef(false);
  const prevRecordingRef = useRef(false);

  /** Connect the mic and effects chain; shared by go-on-air, continue, and recover flows. */
  const connectMicForBroadcast = useCallback(async () => {
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: { ideal: 48000 },
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);
    mixer.connectMic(stream);
    const nodes = mixer.getNodes();
    if (nodes) {
      await micEffects.insertIntoChain(nodes.ctx, nodes.micGain, nodes.micVolumeGain);
    }
    mixer.setMicVolume(micVolume / 100);
    if (micMuted) mixer.setMicMuted(true);
    addLog('Mic connected');
  }, [selectedDevice, mixer, micEffects, micVolume, micMuted, addLog]);

  const doGoOnAir = useCallback(async () => {
    setGoingOnAir(true);
    try {
      // Only stop recording when it's from the preview stream (source will be torn down).
      if (recorder.recording && !isOnAir && !recordingAfterBroadcastRef.current) {
        recorder.stopRecording();
        addLog('Recording stopped. Saving MP3 before going on air.');
      }

      await connectMicForBroadcast();

      const settings = pendingBroadcastSettingsRef.current;
      const slug = settings?.customUrl || '';

      webrtc.createRoom(slug || undefined, settings?.streamTitle, settings?.streamDescription);
      addLog('Setting up room…');
      broadcastStartedRef.current = false;

      if (selectedIntegration) {
        const integrationInfo = getIntegration(selectedIntegration.integrationId);
        addLog(`Connecting to ${integrationInfo?.name || 'integration'}…`);
      }

      setIsOnAir(true);
      pendingBroadcastSettingsRef.current = null;
    } catch (e) {
      addLog('Couldn\'t start broadcast. Check mic permissions.', 'error');
      toast.error('Couldn\'t start the broadcast. Check mic permissions and try again.');
    } finally {
      setGoingOnAir(false);
    }
  }, [connectMicForBroadcast, webrtc, selectedIntegration, addLog, recorder, isOnAir]);

  const handleGoOnAir = useCallback(() => {
    const hasTrackList = trackList.length > 0;
    const hasBroadcastEnded = logs.some((e) => e.message.includes('Off air'));
    if (hasTrackList || hasBroadcastEnded) {
      setStartBroadcastDialogOpen(true);
      return;
    }
    setPreBroadcastOpen(true);
  }, [logs, trackList.length]);

  const handlePreBroadcastStart = useCallback(async (settings: BroadcastSettings) => {
    setPreBroadcastOpen(false);
    pendingBroadcastSettingsRef.current = settings;
    await doGoOnAir();
  }, [doGoOnAir]);

  const handlePreBroadcastSkip = useCallback(async () => {
    setPreBroadcastOpen(false);
    pendingBroadcastSettingsRef.current = null;
    await doGoOnAir();
  }, [doGoOnAir]);

  const handleStartBroadcastContinue = useCallback(() => {
    setLogs([]);
    setTrackList([]);
    setStartBroadcastDialogOpen(false);
    setPreBroadcastOpen(true);
  }, []);

  /** Continue previous broadcast: rejoin the same room, keep logs and track list */
  const handleContinuePreviousBroadcast = useCallback(async () => {
    const prevRoomId = webrtc.roomId;
    if (!prevRoomId) {
      await doGoOnAir();
      return;
    }
    setStartBroadcastDialogOpen(false);
    setGoingOnAir(true);
    try {
      await connectMicForBroadcast();
      addLog('Resuming previous broadcast…');
      webrtc.joinRoomAsBroadcaster(prevRoomId);
      broadcastStartedRef.current = false;
      if (selectedIntegration) {
        const integrationInfo = getIntegration(selectedIntegration.integrationId);
        addLog(`Connecting to ${integrationInfo?.name || 'integration'}…`);
      }
      setIsOnAir(true);
    } catch (e) {
      addLog('Couldn\'t resume broadcast. Check mic permissions.', 'error');
    } finally {
      setGoingOnAir(false);
    }
  }, [connectMicForBroadcast, webrtc, selectedIntegration, addLog, doGoOnAir]);

  const handleRecoverBroadcast = useCallback(async () => {
    if (!recoveryRoomId) return;
    setRecoveryDialogOpen(false);
    setGoingOnAir(true);
    try {
      await connectMicForBroadcast();
      addLog('Recovering previous broadcast…');
      webrtc.joinRoomAsBroadcaster(recoveryRoomId);
      broadcastStartedRef.current = false;
      if (selectedIntegration) {
        const integrationInfo = getIntegration(selectedIntegration.integrationId);
        addLog(`Connecting to ${integrationInfo?.name || 'integration'}…`);
      }
      setIsOnAir(true);
    } catch (e) {
      addLog('Couldn\'t recover broadcast. Check mic permissions.', 'error');
      localStorage.removeItem(ACTIVE_BROADCAST_KEY);
    } finally {
      setGoingOnAir(false);
    }
    setRecoveryRoomId(null);
  }, [recoveryRoomId, connectMicForBroadcast, webrtc, selectedIntegration, addLog]);

  const handleDismissRecovery = useCallback(() => {
    setRecoveryDialogOpen(false);
    setRecoveryRoomId(null);
    localStorage.removeItem(ACTIVE_BROADCAST_KEY);
  }, []);

  // Start broadcast once room is ready and we have a mixed stream (native mode)
  useEffect(() => {
    if (isOnAir && !selectedIntegration && mixer.mixedStream && webrtc.roomId && !broadcastStartedRef.current) {
      broadcastStartedRef.current = true;
      webrtc.startBroadcast(mixer.mixedStream);
      addLog('You\'re live!');
    }
    if (!isOnAir) {
      broadcastStartedRef.current = false;
    }
  }, [isOnAir, selectedIntegration, mixer.mixedStream, webrtc.roomId, webrtc.startBroadcast, addLog]);

  // Start integration stream once we have a mixed stream (integration mode)
  const integrationStartedRef = useRef(false);
  useEffect(() => {
    if (isOnAir && selectedIntegration && mixer.mixedStream && !integrationStartedRef.current) {
      integrationStartedRef.current = true;
      integrationStream.startStream(mixer.mixedStream, selectedIntegration, webrtc.roomId).then(() => {
        const integrationInfo = getIntegration(selectedIntegration.integrationId);
        addLog(`Live on ${integrationInfo?.name || 'integration'}!`);
      }).catch(() => {
        addLog('Failed to connect to streaming server', 'error');
        setIsOnAir(false);
      });
    }
    if (!isOnAir) {
      integrationStartedRef.current = false;
    }
  }, [isOnAir, selectedIntegration, mixer.mixedStream, integrationStream, addLog]);

  // Start relay stream for the built-in /stream/:roomId (always, for VLC/RadioDJ)
  const relayStartedRef = useRef(false);
  useEffect(() => {
    if (isOnAir && mixer.mixedStream && webrtc.roomId && !relayStartedRef.current) {
      relayStartedRef.current = true;
      relayStream.startRelay(mixer.mixedStream, webrtc.roomId).catch(() => {
        // Non-fatal: the WebRTC broadcast still works without the relay
      });
    }
    if (!isOnAir) {
      relayStartedRef.current = false;
    }
  }, [isOnAir, mixer.mixedStream, webrtc.roomId, relayStream]);

  // Log relay/integration stream errors
  useEffect(() => {
    if (relayStream.error) {
      addLog(`Stream relay: ${relayStream.error}`, 'warn');
    }
  }, [relayStream.error, addLog]);

  // Surface integration relay reconnect status
  const prevRelayStatusRef = useRef<RelayStatus>(null);
  useEffect(() => {
    const prev = prevRelayStatusRef.current;
    prevRelayStatusRef.current = integrationStream.relayStatus;
    if (integrationStream.relayStatus === 'reconnecting' && prev !== 'reconnecting') {
      addLog('Streaming server connection lost. Reconnecting…', 'warn');
    }
    if (integrationStream.relayStatus === 'connected' && prev === 'reconnecting') {
      addLog('Reconnected to streaming server');
    }
  }, [integrationStream.relayStatus, addLog]);

  // Auto-identify: fingerprint the broadcast and add recognized songs to the track list
  useAutoIdentify({
    stream: isOnAir && autoIdentifyOn ? mixer.mixedStream : null,
    enabled: isOnAir && autoIdentifyOn && autoIdentifyAvailable,
    existingTitles: trackList.map((t) => t.title),
    onMatch: (match) => {
      const text = `${match.artist} - ${match.title}`;
      signaling.send({ type: 'add-track', text, artist: match.artist, trackTitle: match.title });
      addLog(`Auto-identified: ${text}`);
    },
  });

  useEffect(() => {
    if (integrationStream.error) {
      addLog(integrationStream.error, 'error');
    }
  }, [integrationStream.error, addLog]);

  // When recording stops after broadcast ended, disconnect mixer/mic
  useEffect(() => {
    const wasRecording = prevRecordingRef.current;
    prevRecordingRef.current = recorder.recording;
    if (wasRecording && !recorder.recording && recordingAfterBroadcastRef.current) {
      recordingAfterBroadcastRef.current = false;
      micEffects.removeFromChain();
      localStream?.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
      mixer.disconnectMic();
      if (systemAudioActive) {
        mixer.disconnectSystemAudio();
        systemAudioStreamRef.current = null;
        setSystemAudioActive(false);
      }
    }
  }, [recorder.recording, micEffects, mixer, localStream, systemAudioActive]);

  const handleEndBroadcast = useCallback(() => {
    const wasRecording = recorder.recording;

    // If recording, keep mixer/mic connected so recording continues until user stops
    if (!wasRecording) {
      micEffects.removeFromChain();
      localStream?.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
      mixer.disconnectMic();

      if (systemAudioActive) {
        mixer.disconnectSystemAudio();
        systemAudioStreamRef.current = null;
        setSystemAudioActive(false);
      }
    } else {
      recordingAfterBroadcastRef.current = true;
      addLog('Recording continues. Stop when ready or start a new broadcast.');
    }

    webrtc.stop();
    if (selectedIntegration) {
      integrationStream.stopStream();
    }
    relayStream.stopRelay();

    setIsOnAir(false);
    localStorage.removeItem(ACTIVE_BROADCAST_KEY);
    addLog('Off air');
  }, [recorder.recording, micEffects, localStream, mixer, systemAudioActive, webrtc, selectedIntegration, integrationStream, relayStream, addLog]);

  // --- Mixer control handlers ---

  const handleToggleMute = () => {
    const newMuted = !micMuted;
    setMicMuted(newMuted);
    setSystemAudioMuted(newMuted);
    setPadsMuted(newMuted);
    mixer.setMicMuted(newMuted);
    addLog(newMuted ? 'All channels muted' : 'All channels unmuted');
  };

  const handleToggleListen = () => {
    const newListening = !listening;
    setListening(newListening);
    mixer.setListening(newListening);
    addLog(newListening ? 'Listen on' : 'Listen off');
  };

  const handleToggleCue = () => {
    const newCue = !cueMode;
    setCueMode(newCue);
    mixer.setCueMode(newCue);
    if (newCue) {
      setListening(true);
      addLog('Cue mode on. Previewing locally.');
    } else {
      setListening(false);
      mixer.setListening(false);
      addLog('Cue mode off. Back on air.');
    }
  };

  const handleQualityChange = (value: string) => {
    const q = value as AudioQuality;
    setQualityMode(q);
    webrtc.setAudioQuality(q);
    const labels: Record<AudioQuality, string> = {
      high: 'High quality (510 kbps stereo)',
      auto: 'Auto quality: adapts to connection health',
      low: 'Low bandwidth (32 kbps mono)',
    };
    addLog(labels[q]);
  };

  const handleToggleRecording = async () => {
    if (recorder.recording) {
      recorder.stopRecording();
      addLog('Recording stopped. Saving MP3.');
    } else {
      const stream = isOnAir ? mixer.mixedStream : previewStream;
      if (stream) {
        try {
          await recorder.startRecording(stream);
          addLog(isOnAir ? 'Recording started (320 kbps MP3)' : 'Recording started (mic only, before broadcast)');
        } catch (e) {
          addLog('Failed to start recording', 'error');
        }
      }
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleApplyPreset = (preset: Preset) => {
    micEffects.replaceEffects(preset.effects);
    addLog(`Preset loaded: ${preset.name}`);
  };

  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    savePreset(name, {
      effects: { ...micEffects.effects } as Record<EffectName, { enabled: boolean; params: Record<string, number> }>,
    });
    setPresets(getPresets());
    setSavePresetOpen(false);
    setNewPresetName('');
    addLog(`Preset saved: ${name}`);
  };

  const handleDeletePreset = (name: string) => {
    deletePreset(name);
    setPresets(getPresets());
    addLog(`Preset deleted: ${name}`);
  };

  const handleNowPlayingChange = (meta: NowPlayingMeta) => {
    setNowPlaying(meta.text);
    setNowPlayingCover(meta.cover);
    // Debounce sending metadata
    if (nowPlayingTimerRef.current) clearTimeout(nowPlayingTimerRef.current);
    nowPlayingTimerRef.current = setTimeout(() => {
      const payload: { type: string; [key: string]: string } = { type: 'metadata', text: meta.text };
      if (meta.cover) payload.cover = meta.cover;
      signaling.send(payload);
    }, 500);
  };

  const handleLimiterChange = (value: string) => {
    const db = Number(value) as 0 | -3 | -6 | -12;
    setLimiterDb(db);
    mixer.setLimiterThreshold(db);
    addLog(`Limiter set to ${db} dB`);
  };

  const handleToggleSystemAudio = () => {
    if (systemAudioActive) {
      mixer.disconnectSystemAudio();
      systemAudioStreamRef.current = null;
      setSystemAudioActive(false);
      if (!isOnAir) {
        micEffects.removeFromChain();
        mixer.disconnectMic();
        addLog('System audio stopped. Mic disconnected from mixer.');
      } else {
        addLog('System audio stopped');
      }
    } else {
      setSystemAudioInfoOpen(true);
    }
  };

  const handleSystemAudioConfirm = async () => {
    setSystemAudioInfoOpen(false);
    try {
      // When not on air, connect mic and effects so the full mix can be prepped
      if (!isOnAir && previewStream) {
        mixer.connectMic(previewStream);
        const nodes = mixer.getNodes();
        if (nodes) {
          await micEffects.insertIntoChain(nodes.ctx, nodes.micGain, nodes.micVolumeGain);
        }
        mixer.setMicVolume(micVolume / 100);
        if (micMuted) mixer.setMicMuted(true);
        addLog('Mic connected for level check');
      }

      // Request system audio via getDisplayMedia.
      // Video is required by browsers, but we request the absolute minimum
      // (1x1 @ 1fps) to avoid GPU/CPU overhead from screen capture encoding.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: {
          suppressLocalAudioPlayback: false,
          systemAudio: 'include',
        },
        video: {
          width: { ideal: 1 },
          height: { ideal: 1 },
          frameRate: { ideal: 1 },
        },
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
      } as DisplayMediaStreamOptions);

      // Stop the video track immediately: only the audio is needed
      stream.getVideoTracks().forEach(t => t.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        toast('No system audio was captured. Make sure to toggle "Share audio" in the dialog.', { duration: 5000 });
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      const audioOnlyStream = new MediaStream(audioTracks);

      mixer.connectSystemAudio(audioOnlyStream);
      systemAudioStreamRef.current = audioOnlyStream;
      setSystemAudioActive(true);
      addLog('System audio connected');

      audioTracks[0].addEventListener('ended', () => {
        systemAudioStreamRef.current = null;
        setSystemAudioActive(false);
        if (!isOnAirRef.current) {
          micEffects.removeFromChain();
          mixer.disconnectMic();
        }
        addLog('System audio stopped');
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NotAllowedError') {
        // User cancelled the picker; not an error
        return;
      }
      addLog('Failed to capture system audio', 'error');
      toast('Could not capture system audio. Your browser may not support this feature.', { duration: 4000 });
    }
  };

  // Keyboard shortcuts (momentary FX keys are handled by the effects engine)
  const { showHelp, setShowHelp } = useKeyboardShortcuts(isOnAir, {
    onToggleMute: handleToggleMute,
    onToggleRecording: handleToggleRecording,
    onToggleListen: handleToggleListen,
    onToggleCue: handleToggleCue,
    onTriggerPad: (index: number) => soundboardTriggerRef.current?.(index),
    onFxDown: (name) => micEffects.triggerFx(name),
    onFxUp: (name) => micEffects.releaseFx(name),
  });

  // Reset volatile display state when going off air
  useEffect(() => {
    if (!isOnAir) {
      setListening(false);
      setCueMode(false);
      setElapsedSeconds(0);
      setListenerCount(0);
      setNowPlaying('');
      setNowPlayingCover(undefined);
    }
  }, [isOnAir]);

  // Broadcast timer
  useEffect(() => {
    if (!isOnAir) return;
    setElapsedSeconds(0);
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isOnAir]);

  const integrationInfo = selectedIntegration ? getIntegration(selectedIntegration.integrationId) : null;

  const restoredLayoutRef = useRef(false);
  useEffect(() => {
    if (restoredLayoutRef.current) return;
    restoredLayoutRef.current = true;
    const saved = readPersistedLayout();
    if (!saved) return;

    if (saved.selectedDevice) setSelectedDevice(saved.selectedDevice);
    if (saved.qualityMode) {
      setQualityMode(saved.qualityMode);
      webrtc.setAudioQuality(saved.qualityMode);
    }
    if (typeof saved.limiterDb === 'number') {
      setLimiterDb(saved.limiterDb);
      mixer.setLimiterThreshold(saved.limiterDb);
    }
    if (typeof saved.micVolume === 'number') setMicVolume(saved.micVolume);
    if (typeof saved.micMuted === 'boolean') setMicMuted(saved.micMuted);
    if (typeof saved.micSolo === 'boolean') setMicSolo(saved.micSolo);
    if (typeof saved.micPan === 'number') setMicPan(saved.micPan);

    if (typeof saved.systemAudioVolume === 'number') setSystemAudioVolume(saved.systemAudioVolume);
    if (typeof saved.systemAudioMuted === 'boolean') setSystemAudioMuted(saved.systemAudioMuted);
    if (typeof saved.systemAudioSolo === 'boolean') setSystemAudioSolo(saved.systemAudioSolo);
    if (typeof saved.systemAudioPan === 'number') setSystemAudioPan(saved.systemAudioPan);

    if (typeof saved.padsVolume === 'number') setPadsVolume(saved.padsVolume);
    if (typeof saved.padsMuted === 'boolean') setPadsMuted(saved.padsMuted);
    if (typeof saved.padsSolo === 'boolean') setPadsSolo(saved.padsSolo);
    if (typeof saved.padsPan === 'number') setPadsPan(saved.padsPan);

    if (typeof saved.micMonitor === 'boolean') setMicMonitor(saved.micMonitor);
    if (typeof saved.systemMonitor === 'boolean') setSystemMonitor(saved.systemMonitor);
    if (typeof saved.padsMonitor === 'boolean') setPadsMonitor(saved.padsMonitor);
    if (typeof saved.duckPads === 'boolean') setDuckPads(saved.duckPads);
    if (typeof saved.duckSystem === 'boolean') setDuckSystem(saved.duckSystem);
    if (typeof saved.autoIdentify === 'boolean') setAutoIdentifyOn(saved.autoIdentify);

    if (saved.sideTab && ['sounds', 'effects', 'tracks', 'log'].includes(saved.sideTab)) {
      setSideTab(saved.sideTab);
    }

    if (saved.effects) {
      micEffects.replaceEffects(saved.effects);
    }
  }, [micEffects, mixer, webrtc]);

  useEffect(() => {
    const payload: PersistedBroadcasterLayout = {
      qualityMode,
      limiterDb,
      micVolume,
      micMuted,
      micSolo,
      micPan,
      systemAudioVolume,
      systemAudioMuted,
      systemAudioSolo,
      systemAudioPan,
      padsVolume,
      padsMuted,
      padsSolo,
      padsPan,
      micMonitor,
      systemMonitor,
      padsMonitor,
      duckPads,
      duckSystem,
      autoIdentify: autoIdentifyOn,
      selectedDevice,
      sideTab,
      effects: micEffects.effects,
    };
    try {
      localStorage.setItem(BROADCASTER_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota errors and keep runtime behavior intact.
    }
  }, [
    qualityMode,
    limiterDb,
    micVolume,
    micMuted,
    micSolo,
    micPan,
    systemAudioVolume,
    systemAudioMuted,
    systemAudioSolo,
    systemAudioPan,
    padsVolume,
    padsMuted,
    padsSolo,
    padsPan,
    micMonitor,
    systemMonitor,
    padsMonitor,
    duckPads,
    duckSystem,
    autoIdentifyOn,
    selectedDevice,
    sideTab,
    micEffects.effects,
  ]);

  const channelStates: ChannelStripState[] = [
    {
      id: 'mic',
      label: 'Mic',
      level: channelLevels.mic,
      volume: micVolume,
      muted: micMuted,
      solo: micSolo,
      pan: micPan,
      monitor: micMonitor,
      active: true,
    },
    {
      id: 'pads',
      label: 'Sound Pads',
      level: channelLevels.pads,
      volume: padsVolume,
      muted: padsMuted,
      solo: padsSolo,
      pan: padsPan,
      monitor: padsMonitor,
      active: true,
      duckable: true,
      duck: duckPads,
    },
    {
      id: 'system',
      label: 'System Audio',
      level: channelLevels.system,
      volume: systemAudioVolume,
      muted: systemAudioMuted,
      solo: systemAudioSolo,
      pan: systemAudioPan,
      monitor: systemMonitor,
      active: systemAudioActive,
      duckable: true,
      duck: duckSystem,
    },
  ];

  const handleChannelChange = (id: ChannelStripState['id'], patch: ChannelPatch) => {
    const map = {
      mic: {
        volume: setMicVolume, muted: setMicMuted, solo: setMicSolo, pan: setMicPan, monitor: setMicMonitor,
        duck: undefined as ((v: boolean) => void) | undefined,
      },
      pads: {
        volume: setPadsVolume, muted: setPadsMuted, solo: setPadsSolo, pan: setPadsPan, monitor: setPadsMonitor,
        duck: setDuckPads,
      },
      system: {
        volume: setSystemAudioVolume, muted: setSystemAudioMuted, solo: setSystemAudioSolo, pan: setSystemAudioPan, monitor: setSystemMonitor,
        duck: setDuckSystem,
      },
    }[id];
    if (patch.volume !== undefined) map.volume(patch.volume);
    if (patch.muted !== undefined) map.muted(patch.muted);
    if (patch.solo !== undefined) map.solo(patch.solo);
    if (patch.pan !== undefined) map.pan(patch.pan);
    if (patch.monitor !== undefined) map.monitor(patch.monitor);
    if (patch.duck !== undefined) map.duck?.(patch.duck);
  };

  const scrollToPanel = (ref: React.RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const mobileNavItems: Array<{ id: string; label: string; icon: typeof Music; onSelect: () => void; active: boolean }> = [
    { id: 'mix', label: 'Mix', icon: SlidersHorizontal, onSelect: () => scrollToPanel(mixerPanelRef), active: false },
    { id: 'sounds', label: 'Pads', icon: Music, onSelect: () => { setSideTab('sounds'); scrollToPanel(sidePanelRef); }, active: sideTab === 'sounds' },
    { id: 'effects', label: 'FX', icon: Sparkles, onSelect: () => { setSideTab('effects'); scrollToPanel(sidePanelRef); }, active: sideTab === 'effects' },
    { id: 'tracks', label: 'Tracks', icon: ListMusic, onSelect: () => { setSideTab('tracks'); scrollToPanel(sidePanelRef); }, active: sideTab === 'tracks' },
    { id: 'log', label: 'Log', icon: ScrollText, onSelect: () => { setSideTab('log'); scrollToPanel(sidePanelRef); }, active: sideTab === 'log' },
  ];

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <StatusBar
        status={selectedIntegration && isOnAir ? 'on-air' : webrtc.status}
        roomId={isOnAir ? webrtc.roomId : null}
        integrationName={isOnAir && integrationInfo ? integrationInfo.name : undefined}
        listenerCount={isOnAir ? listenerCount : undefined}
        elapsedSeconds={isOnAir ? elapsedSeconds : undefined}
        recording={recorder.recording}
        recordElapsed={recorder.elapsed}
      />

      <div className="flex-1 p-4 pb-16 lg:pb-4 max-w-6xl mx-auto w-full space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" aria-hidden />
              Broadcaster
            </h1>
            <button
              onClick={() => setShowHelp(true)}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Keyboard shortcuts"
              aria-label="Show keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
            </button>
            {autoIdentifyAvailable && (
              <button
                onClick={() => {
                  setAutoIdentifyOn((v) => {
                    addLog(v ? 'Auto-identify off' : 'Auto-identify on: recognized songs are added to the track list');
                    return !v;
                  });
                }}
                aria-pressed={autoIdentifyOn}
                aria-label={autoIdentifyOn ? 'Turn off automatic song identification' : 'Turn on automatic song identification'}
                className={`transition-colors ${
                  autoIdentifyOn ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'
                }`}
                title={autoIdentifyOn ? 'Auto-identify is on' : 'Auto-identify songs playing in your broadcast'}
              >
                <Ear className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {!isOnAir && (
            <button
              onClick={() => setIntegrationsOpen(true)}
              className={`flex items-center gap-1.5 text-xs font-mono transition-colors px-3 py-1.5 rounded-md ${
                selectedIntegration
                  ? 'text-primary bg-primary/10 hover:bg-primary/20'
                  : 'text-muted-foreground hover:text-foreground bg-secondary'
              }`}
            >
              <Plug2 className="h-3 w-3" aria-hidden />
              {selectedIntegration ? integrationInfo?.name : 'Integrations'}
            </button>
          )}
          {isOnAir && webrtc.roomId && (
            <div className="flex items-center gap-2 flex-wrap">
              {selectedIntegration && integrationInfo && (
                <span className="flex items-center gap-1.5 text-xs font-mono text-primary bg-primary/10 px-3 py-1.5 rounded-md">
                  <Radio className="h-3 w-3" aria-hidden />
                  Streaming on {integrationInfo.name}
                </span>
              )}
              <ShareLinks roomId={webrtc.roomId} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 items-start">
          {/* Left column: meters, transport, setup, mixer */}
          <div className="space-y-4 min-w-0">
            <LevelMeter
              left={audioAnalysis.left}
              right={audioAnalysis.right}
              label="Input Level"
            />

            <TransportBar
              isOnAir={isOnAir}
              goingOnAir={goingOnAir}
              canGoOnAir={signaling.connected}
              elapsedSeconds={elapsedSeconds}
              onGoOnAir={handleGoOnAir}
              onEndBroadcast={() => setEndConfirmOpen(true)}
              recording={recorder.recording}
              recordElapsed={recorder.elapsed}
              recordLabel={`Recording: ${formatClock(recorder.elapsed)} · ${formatFileSize(recorder.encodedBytes)}`}
              canRecord={Boolean(isOnAir ? mixer.mixedStream : previewStream)}
              onToggleRecording={handleToggleRecording}
              muted={micMuted}
              onToggleMute={handleToggleMute}
              listening={listening}
              onToggleListen={handleToggleListen}
              cueMode={cueMode}
              onToggleCue={handleToggleCue}
              limiterDb={limiterDb}
              onLimiterChange={handleLimiterChange}
            />

            {/* Audio setup: input source, system audio, quality */}
            <div className="panel !p-0">
              <Accordion type="single" collapsible defaultValue={isOnAir ? '' : 'setup'}>
                <AccordionItem value="setup" className="border-b-0">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Mic className="h-3.5 w-3.5" aria-hidden />
                      Audio Setup
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-3">
                    <div>
                      <div className="flex flex-col gap-0.5 mb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Mic className="h-3 w-3" aria-hidden />
                          Input Source
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Microphone or audio interface for your broadcast
                        </span>
                      </div>
                      <Select
                        value={selectedDevice}
                        onValueChange={setSelectedDevice}
                        disabled={isOnAir}
                      >
                        <SelectTrigger className="w-full bg-input border-border font-mono text-sm" aria-label="Audio input device">
                          <SelectValue placeholder="Select audio device…" />
                        </SelectTrigger>
                        <SelectContent>
                          {devices.map((d) => (
                            <SelectItem key={d.deviceId} value={d.deviceId} className="font-mono text-sm">
                              {d.label || `Device ${d.deviceId.slice(0, 8)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-border">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Monitor className="h-3 w-3" aria-hidden />
                          System Audio
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {systemAudioActive
                            ? (isOnAir ? 'Desktop / app audio mixed into your broadcast' : 'Connected. Set levels before going live.')
                            : 'Route desktop / app audio into your broadcast'}
                        </span>
                      </div>
                      <div className="flex justify-end sm:justify-start">
                        <button
                          onClick={handleToggleSystemAudio}
                          disabled={!isOnAir && !previewStream}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all shrink-0 ${
                            (!isOnAir && !previewStream) ? 'opacity-50 cursor-not-allowed' : ''
                          } ${
                            systemAudioActive
                              ? 'bg-primary/20 text-primary'
                              : 'bg-secondary text-muted-foreground hover:text-foreground'
                          }`}
                          title={systemAudioActive ? 'Stop system audio' : 'Share system audio'}
                        >
                          {systemAudioActive ? (
                            <>
                              <MonitorOff className="h-3 w-3" aria-hidden />
                              Stop System
                            </>
                          ) : (
                            <>
                              <Monitor className="h-3 w-3" aria-hidden />
                              Connect Audio
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-border">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Zap className="h-3 w-3" aria-hidden />
                          Audio Quality
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {qualityMode === 'high' && '510 kbps stereo: pristine broadcast quality'}
                          {qualityMode === 'auto' && (
                            <>
                              Adapts to connection health, currently{' '}
                              <span className={webrtc.effectiveQuality === 'high' ? 'text-primary' : 'text-yellow-500'}>
                                {webrtc.effectiveQuality === 'high' ? 'high quality' : 'low bandwidth'}
                              </span>
                            </>
                          )}
                          {qualityMode === 'low' && '32 kbps mono: saves bandwidth on slow connections'}
                        </span>
                      </div>
                      <Select value={qualityMode} onValueChange={handleQualityChange}>
                        <SelectTrigger className="w-[92px] h-7 bg-secondary border-border text-xs font-mono shrink-0 self-start sm:self-center" aria-label="Audio quality">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high" className="text-xs font-mono">High</SelectItem>
                          <SelectItem value="auto" className="text-xs font-mono">Auto</SelectItem>
                          <SelectItem value="low" className="text-xs font-mono">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            {/* Mixer: always visible */}
            <div className="panel" ref={mixerPanelRef}>
              <div className="panel-header flex items-center gap-1.5 mb-3">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                Mixer
              </div>
              <MixerBoard
                channels={channelStates}
                onChange={handleChannelChange}
                duckActive={mixer.duckActive}
              />
            </div>
          </div>

          {/* Right column: tabbed side panel */}
          <div ref={sidePanelRef} className="min-w-0 lg:sticky lg:top-4">
            <SidePanel
              active={sideTab}
              onTabChange={(id) => setSideTab(id as SideTab)}
              tabs={[
                {
                  id: 'sounds',
                  label: 'Sounds',
                  icon: Music,
                  content: (
                    <SoundBoard
                      connectElement={mixer.connectElement}
                      triggerRef={soundboardTriggerRef}
                      onPadPlayback={(title, playing) => addLog(playing ? `▶ ${title}` : `■ ${title}`)}
                    />
                  ),
                },
                {
                  id: 'effects',
                  label: 'Effects',
                  icon: Sparkles,
                  content: (
                    <EffectsBoard
                      engine={micEffects}
                      presets={presets}
                      onApplyPreset={handleApplyPreset}
                      onSavePresetOpen={() => setSavePresetOpen(true)}
                      onRequestDeletePreset={(name) => setDeletePresetName(name)}
                      getAnalyserData={audioAnalysis.getAnalyserData}
                      onLog={(msg) => addLog(msg)}
                    />
                  ),
                },
                {
                  id: 'tracks',
                  label: 'Tracks',
                  icon: ListMusic,
                  content: (
                    <TrackList
                      tracks={trackList}
                      alwaysShow
                      bare
                      roomId={webrtc.roomId ?? undefined}
                      topContent={
                        <NowPlayingInput
                          value={nowPlaying}
                          onChange={handleNowPlayingChange}
                          onCommit={(meta: TrackMeta) => {
                            if (isOnAir) {
                              signaling.send({ type: 'add-track', ...meta });
                              addLog(`Added to track list: ${meta.text || meta.title || 'Unknown'}`, 'info');
                            } else {
                              toast.info('Go on air first to add tracks');
                            }
                          }}
                          disabled={!isOnAir}
                        />
                      }
                    />
                  ),
                },
                {
                  id: 'log',
                  label: 'Log',
                  icon: ScrollText,
                  content: (
                    <div className="space-y-4">
                      <EventLog entries={logs} roomId={webrtc.roomId ?? undefined} listenerCount={isOnAir ? listenerCount : undefined} />
                      <HealthPanel
                        stats={webrtc.stats}
                        connectionState={webrtc.connectionState}
                        iceConnectionState={webrtc.iceConnectionState}
                        signalingState={webrtc.signalingState}
                        peerConnected={webrtc.peerConnected}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex bg-card border-t border-border"
        aria-label="Console sections"
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={item.onSelect}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-mono uppercase tracking-wider ${
                item.active ? 'text-primary' : 'text-muted-foreground'
              }`}
              aria-label={item.label}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>

      <Footer />

      <IntegrationsSheet
        open={integrationsOpen}
        onOpenChange={setIntegrationsOpen}
        selectedIntegration={selectedIntegration}
        onSelectIntegration={setSelectedIntegration}
      />

      {/* End broadcast confirmation */}
      <ConfirmDialog
        open={endConfirmOpen}
        onOpenChange={setEndConfirmOpen}
        title="End broadcast?"
        description={
          <>
            You are {formatClock(elapsedSeconds)} on air with {listenerCount} listener{listenerCount === 1 ? '' : 's'} connected.
            {recorder.recording && ' Recording continues until you save it.'}
          </>
        }
        confirmLabel="End broadcast"
        destructive
        onConfirm={handleEndBroadcast}
      />

      {/* Preset delete confirmation */}
      <ConfirmDialog
        open={deletePresetName !== null}
        onOpenChange={(open) => { if (!open) setDeletePresetName(null); }}
        title="Delete preset?"
        description={deletePresetName ? `"${deletePresetName}" will be removed permanently.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deletePresetName) handleDeletePreset(deletePresetName);
          setDeletePresetName(null);
        }}
      />

      {/* System audio info modal */}
      <Dialog open={systemAudioInfoOpen} onOpenChange={setSystemAudioInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" aria-hidden />
              System Audio
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              To capture audio from your computer, your browser will ask you to share your screen. This is how browsers provide access to system audio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-1">
            <div className="rounded-lg bg-primary/5 border border-primary/10 p-3 space-y-2.5">
              <p className="text-sm font-medium text-foreground">When the sharing dialog appears:</p>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>
                  Select <strong className="text-foreground">"Entire Screen"</strong> to capture all system audio (Spotify, Music, etc.)
                </li>
                <li>
                  Toggle <strong className="text-foreground">"Share system audio"</strong> on. This is the important part.
                </li>
                <li>
                  Click <strong className="text-foreground">Share</strong>
                </li>
              </ol>
            </div>

            <p className="text-xs text-muted-foreground/80">
              <strong className="text-muted-foreground">Nothing on your screen is being shared or recorded.</strong>{' '}
              We capture at the lowest possible quality (1x1 pixel) and immediately discard the video. Only the audio is mixed into your broadcast.
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setSystemAudioInfoOpen(false)}
              className="px-4 py-2 rounded-md text-sm font-medium bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSystemAudioConfirm}
              className="px-4 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Got it, continue
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Start new broadcast: download/copy previous data before starting */}
      <Dialog open={startBroadcastDialogOpen} onOpenChange={setStartBroadcastDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start New Broadcast</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              You have logs and/or a track list from your previous broadcast. Would you like to download them before starting a new one?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              Logs and track listings remain available in the room link for 24 hours post broadcast. Listeners can still view them and chat.
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  let mp3Blob: Blob | null = null;
                  if (recorder.recording) {
                    mp3Blob = await recorder.stopRecordingAndGetBlob();
                    recordingAfterBroadcastRef.current = false;
                    micEffects.removeFromChain();
                    localStream?.getTracks().forEach((t) => t.stop());
                    setLocalStream(null);
                    mixer.disconnectMic();
                    if (systemAudioActive) {
                      mixer.disconnectSystemAudio();
                      systemAudioStreamRef.current = null;
                      setSystemAudioActive(false);
                    }
                  }
                  await downloadBroadcastZip(logs, trackList, webrtc.roomId ?? undefined, mp3Blob);
                  toast('Download started');
                }}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
              >
                <Download className="h-4 w-4" aria-hidden />
                {recorder.recording ? 'Stop Recording & Download ZIP' : 'Download Logs & Track List (ZIP)'}
              </button>
              <button
                onClick={() => {
                  if (webrtc.roomId) copyText(receiveLinkFor(webrtc.roomId), 'Room link');
                }}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy Room Link (24h access)
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
            <div className="flex gap-2">
              <button
                onClick={handleContinuePreviousBroadcast}
                className="flex-1 px-4 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-opacity"
              >
                Continue Previous Broadcast
              </button>
              <button
                onClick={handleStartBroadcastContinue}
                className="flex-1 px-4 py-2 rounded-md text-sm font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
              >
                Start New Broadcast
              </button>
            </div>
            <button
              onClick={() => setStartBroadcastDialogOpen(false)}
              className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <PreBroadcastModal
        open={preBroadcastOpen}
        onOpenChange={setPreBroadcastOpen}
        onStart={handlePreBroadcastStart}
        onSkip={handlePreBroadcastSkip}
      />

      {/* Broadcast recovery dialog */}
      <Dialog open={recoveryDialogOpen} onOpenChange={(open) => { if (!open) handleDismissRecovery(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resume Broadcast?</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              It looks like your previous broadcast (<span className="font-mono text-foreground">{recoveryRoomId?.slice(0, 12)}</span>) is still active. Stream listeners are hearing silence while waiting for you to return.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleDismissRecovery}
              className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
            >
              Start Fresh
            </button>
            <button
              onClick={handleRecoverBroadcast}
              className="flex-1 px-4 py-2.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Resume Broadcast
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Save current effects as a preset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <input
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Preset name…"
              maxLength={40}
              autoFocus
              aria-label="Preset name"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex justify-end">
              <button
                onClick={handleSavePreset}
                disabled={newPresetName.trim().length === 0}
                className="bg-primary text-primary-foreground rounded-md px-6 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Keyboard shortcuts dialog */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-4 w-4" aria-hidden />
              Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Active while on air. Disabled when typing in inputs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            {SHORTCUT_MAP.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{s.description}</span>
                <kbd className="bg-secondary border border-border rounded px-2 py-0.5 text-xs font-mono text-foreground">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Chat FAB: visible when on air */}
      <ChatPanel signaling={signaling} active={isOnAir} />
    </div>
  );
};

export default Broadcaster;
