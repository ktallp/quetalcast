# QueTal Cast

Real-time audio broadcasting application built with WebRTC, React, and Node.js. Designed for low-latency, high-quality audio streaming from a single broadcaster to multiple listeners.

## Features

- **High-fidelity audio** — Opus codec at up to 510 kbps stereo with adaptive quality (High / Auto / Low)
- **Sounds**: three banks (A/B/C) of ten pads with MP3 loading, drag-to-reorder, playback progress rings, loop toggle, per-pad volume (up to 300%), keycap hints, and broadcast mixing
- **Mic effects**: a Voice chain (Enhance with noise gate, tone/EQ, compressor with live gain-reduction meter, de-esser) with hold-to-bypass comparison and an optional ten-second sound check; momentary FX pads (Radio Voice, Big Room, Slapback, Pitch Drop) with hold-to-apply, tap-to-latch, and ring-out tails; manual Voice Shift, Delay, and Reverb effects with per-effect settings
- **Auto-duck**: music channels (Sound Pads, System Audio) can automatically dip about 9 dB under the mic while you speak, with a gentle release
- **Audio presets** — Save and recall effect profiles (effects only, not mixer). In effects panel. 3 built-in presets (Podcast Voice, DJ Mode, Lo-Fi) plus unlimited custom presets stored in localStorage
- **Stereo VU meter** — Calibrated dBFS metering with peak hold. At top of page; works as soon as you select a mic (preview stream) so you can level-check before going live
- **Output limiter** — Selectable ceiling (0 dB, -3 dB, -6 dB, -12 dB)
- **Broadcast timer** — Elapsed time display while on air
- **Console layout**: two-column desktop console with a persistent transport bar (Go On Air with pending state, End Broadcast with confirmation, Record, Mute, Listen, Cue, Limiter), a collapsible Audio Setup panel (input selector, system audio, quality), an always-visible Mixer with channel strips for Mic, Sound Pads, and System Audio (level LEDs, mute, solo, per-channel headphone monitor, duck, keyboard-accessible pan), and a tabbed side panel (Sounds, Effects, Tracks, Log). Mobile gets a bottom tab bar and touch-friendly pan controls. Visible pre-broadcast so you can dial in before going live
- **Layout persistence** — Broadcaster layout is saved to localStorage and restored on reload: sound pads, mixer strip settings (including per-channel monitor states), effects state/parameters, quality mode, and selected input device
- **System audio** — Route desktop or application audio into the broadcast via screen share audio capture. Connect before going on air; level and pan control are in the Mixer Board
- **Live chat** — Bidirectional chat via floating action button (full-screen on mobile, floating panel on desktop). Users provide a display name before chatting. Chat history is sent to new receivers on join. Join/leave system messages appear when someone joins or leaves the chat (with their name). Unread badge on FAB when chat is closed; browser tab title flashes when new messages arrive until viewed. Rate-limited to 1 message per second, max 280 characters
- **Listener count** — Real-time count of connected listeners displayed in the Event Log header during broadcast
- **Now playing** — Broadcaster sets stream metadata with Deezer-powered autocomplete (artist + song search with album art). Visible to all listeners in real time. Metadata is also forwarded to external integration streams (Icecast/Shoutcast)
- **Track list** — Chronological history of every track played. Always visible (collapsible). Now Playing search at top when on air. New receivers get full history on join. CSV download (icon next to title) includes room ID. Event log also has CSV download next to title
- **Auto-identify**: automatic song identification using AcoustID/Chromaprint. Ear icon toggle in the console header (shown when `ACOUSTID_API_KEY` is configured); recognized songs are added to the track list and ICY metadata
- **Local recording** — Record your broadcast as a 320 kbps stereo MP3, auto-downloaded when you stop. Start recording before going on air to capture from the moment you hit record. If you end the broadcast while recording, recording continues until you stop it or click Download ZIP in the modal. Recording also continues when you start a new broadcast — use the Record button or Download ZIP to stop and save. Uses AudioWorklet + Web Worker for energy-efficient encoding
- **Keyboard shortcuts**: Space (mute), R (record), L (listen), C (cue), 1–0 (sound pads, active bank), Q/W/E/T (hold for momentary FX), ? (help). Active while on air, disabled when typing in inputs
- **User accounts**: owners create DJ and Owner accounts from the admin Users tab with 24-hour invite links (`/join/<token>`); users set their own passwords, sessions are revocable server-side, and disabling a user signs them out immediately
- **Admin dashboard**: live stats (rooms, listeners now, peak today, uptime), per-room listener counts, peaks, durations, and actions (open, copy link, end room), plus per-room listener analytics sampled every minute
- **Persistence**: rooms, track lists, chat history, saved URLs, users, and sessions live in SQLite on a mounted volume, so post-broadcast history and recovery survive server restarts and deploys
- **Listener volume**: in-app volume slider and mute on the receiver page, persisted between visits, plus a plain-language connection status with a technical-details disclosure and a room-full handoff to the MP3 stream
- **Custom receive URLs** — Set a custom slug for your receive URL (e.g. `/receive/elpasorocks` or `/receive/farmers-market`) instead of an auto-generated hex ID. Lowercase letters, numbers, and hyphens, 3–40 characters. Previously used slugs are stored server-side and shown as suggestions with live/available status indicators. Slugs can be freely reused across broadcasts (blocked only while a room with that slug is live)
- **Integrations** — Stream to external platforms (Icecast, Shoutcast, Radio.co) via server-side relay. Configurable stream quality: bitrate (128/192/256/320 kbps) and channels (stereo/mono), defaulting to stereo 192 kbps. Test connection, remember credentials + quality settings in localStorage. Room is still created for chat and metadata. Now Playing metadata is automatically pushed to the external server's admin API. Mount points should use `.mp3` extension for best compatibility with RadioDJ, VLC, and other players. Proper Icecast headers (`ice-audio-info`, `ice-bitrate`, `ice-channels`, `ice-samplerate`) are sent for reliable format detection. For internet-radio.com (Centova Cast), use mount point `/stream.mp3` and stop AutoDJ before going live if needed — see docs for details
- **Per-channel headphone monitor** — Each mixer channel strip has a headphone toggle that controls local monitoring independently. Hear or silence any channel (Mic, Pads, System Audio) through your speakers without affecting what listeners hear. Pads monitor is on by default; toggle it off to play soundboard clips to listeners without hearing them yourself. Monitor states are persisted to localStorage
- **Stream URL sharing** — Every broadcast exposes a Stream URL on the receiver page — both integration-based (Icecast/Shoutcast) and a built-in HTTP relay. The relay serves MP3 via server-side FFmpeg transcoding (WebM→MP3) with Icecast-compatible ICY headers, so the URL works in RadioDJ, VLC, internet-radio.com, and any media player that accepts standard HTTP audio streams. If the broadcaster disconnects, the server feeds silent MP3 frames for up to 10 minutes to keep VLC/RadioDJ connected while waiting for the broadcaster to return. The relay is hardened for long-running streams with error-resilient writers, FFmpeg lifecycle safety, and proxy buffering bypass
- **Broadcast recovery** — If the broadcaster accidentally closes the browser or loses connection, reopening the page detects the previous broadcast and prompts to resume it. The stream stays alive (silence keepalive) so media player listeners don't have to reconnect
- **Pre-broadcast settings** — Clicking "Go On Air" opens a settings modal where you can set a stream title (shown as station name in media players), description (included in stream headers), and custom receive URL. Skip to start immediately with defaults; title and description are remembered in localStorage
- **Multi-receiver** — Up to 4 concurrent listeners per room
- **TURN relay** — Dynamic credential fetching via Metered.ca (or static config)
- **Auto-reconnect** — Receivers automatically reconnect on connection drops with exponential backoff (up to 5 attempts). Manual retry available after max attempts
- **Room persistence** — When a broadcast ends, the room ID in the broadcaster status bar is hidden and a new room is created when starting a new broadcast. The previous room remains visible on the receiver page for 24 hours post-broadcast to show events, track list, and chat. CSV exports (event log and track list) include the room ID for reference
- **Post-broadcast flow** — Logs, track list, and chat are not purged until a new broadcast is started. When starting a new broadcast with existing data, a dialog offers to download logs and track list as a ZIP (including MP3 if recording was active), copy the room link (24h access), continue the previous broadcast (rejoin same room, keep logs and track list), or start a new broadcast

## Architecture

```
┌──────────────┐     WebSocket      ┌──────────────┐     WebSocket      ┌──────────────┐
│  Broadcaster │ ◄────────────────► │   Signaling  │ ◄────────────────► │  Receiver(s) │
│   (React)    │                    │   Server     │                    │   (React)    │
└──────┬───────┘                    │  (Node.js)   │                    └──────┬───────┘
       │                            └──────┬───────┘                           │
       │                                   │                                   │
       │        WebRTC (Peer-to-Peer)      │    TURN relay (when needed)       │
       └───────────────────────────────────┼───────────────────────────────────┘
                                           │
                                    ┌──────┴───────┐
                                    │  TURN Server │
                                    │  (Metered)   │
                                    └──────────────┘
```

**Broadcaster audio graph (Web Audio API):**

```
Microphone ─► Mic Effects ─► Gain ─► Pan ──┐       ┌─► 🎧 Mic Monitor ─► Speakers
                                            ├───────┤
Sound Pads ─► Gain ─► Pan ────────────────┤       ├─► 🎧 Pads Monitor ─► Speakers
                                            ├───────┤
System Audio ─► Gain ─► Pan ──────────────┘       └─► 🎧 System Monitor ─► Speakers
                                    │
                                    ▼
                           Broadcast Bus (stereo) ─► Limiter ─► WebRTC / Relay
                                    │                             └─► VU Meter
                                    └─► Listen Gain ─► Speakers (full mix)
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)
- [FFmpeg](https://ffmpeg.org/) — required for the built-in MP3 stream relay (installed automatically in the Docker image; install locally for dev)

### 1. Clone and install

```bash
git clone https://github.com/specialopsio/quetalcast.git
cd quetalcast

# Install frontend dependencies
pnpm install

# Install server dependencies
cd server && pnpm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set ADMIN_PASSWORD and SESSION_SECRET
```

### 3. Run locally

```bash
# Terminal 1 — signaling server
cd server
pnpm run dev

# Terminal 2 — frontend
pnpm run dev
```

- Frontend: `http://localhost:5173`
- Server: `http://localhost:3001`

### 4. Use the app

1. Open `http://localhost:5173` and log in with your configured password
2. Expand **Audio Controls** and select your audio input device — the level meter at top shows input immediately so you can dial in
3. Optionally set a **custom receive URL** (e.g. `elpasorocks`) in the Receive URL panel — leave blank for an auto-generated ID
4. Click **Go On Air** — a room ID is generated and appended to the URL (`?room=...`)
5. Share the receiver link (Copy Receiver Link); listeners open it and click **Join**

## Deployment (Fly.io)

The project includes a multi-stage `Dockerfile` and `fly.toml` for [Fly.io](https://fly.io) deployment.

```bash
# Install Fly CLI: https://fly.io/docs/getting-started/installing-flyctl/
fly launch

# Create the persistent volume for the SQLite database (required: fly.toml
# mounts it at /data)
fly volumes create data --size 1 --region dfw

# Set secrets
fly secrets set SESSION_SECRET="your-random-secret"
fly secrets set ADMIN_PASSWORD="your-password"
fly secrets set METERED_APP_NAME="yourapp.metered.live"
fly secrets set METERED_API_KEY="your-metered-api-key"

# Deploy
fly deploy
```

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `ALLOWED_ORIGIN` | `*` | CORS origin (set to your domain in production) |
| `REQUIRE_TLS` | `false` | Require HTTPS for cookies |
| `SESSION_SECRET` | `dev-secret...` | Session cookie signing secret (must be changed for production; the server refuses to boot in production with the dev default) |
| `ADMIN_PASSWORD` | `admin` | Password seeded for the initial `admin` owner account on first boot (ignored once users exist) |
| `DATA_DIR` | `./data` | Directory for persistent data (SQLite database). Set to `/data` on Fly.io |
| `NODE_ENV` | (unset) | Set to `production` in deployments: forces Secure session cookies and enables the boot-time credential guard |
| `METERED_APP_NAME` | — | Metered.ca app name for dynamic TURN credentials |
| `METERED_API_KEY` | — | Metered.ca API key |
| `TURN_URL` | — | Static TURN server URL (alternative to Metered) |
| `TURN_USERNAME` | — | Static TURN username |
| `TURN_CREDENTIAL` | — | Static TURN credential |
| `ACOUSTID_API_KEY` | — | AcoustID API key for auto song identification ([get one free](https://acoustid.org/new-application)). *Optional — auto-identify is temporarily disabled.* |
| `LOG_DIR` | `server/logs` | Log file directory |
| `LOG_LEVEL` | `info` | Log level (error, warn, info, debug) |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_WS_URL` | auto-detected | WebSocket signaling URL |
| `VITE_DEBUG` | `false` | Enable verbose debug logging in browser console |

## Project Structure

```
├── src/                        # React frontend (Vite + TypeScript)
│   ├── components/
│   │   ├── ChatPanel.tsx       # Floating chat FAB + full-screen mobile overlay
│   │   ├── EffectsBoard.tsx    # Mic effects UI (enhance, tone, compressor, pitch, delay, reverb)
│   │   ├── IntegrationsSheet.tsx # External streaming platform config
│   │   ├── NowPlayingInput.tsx # Deezer autocomplete for now-playing metadata
│   │   ├── TrackList.tsx       # Chronological track history display
│   │   ├── SoundBoard.tsx      # 5x2 sound pad grid
│   │   ├── LevelMeter.tsx      # Stereo VU meter with dBFS scale
│   │   ├── StatusBar.tsx       # Room ID, timer, connection status
│   │   ├── HealthPanel.tsx     # RTT, packet loss, jitter display
│   │   ├── EventLog.tsx        # Connection event timeline with chat + CSV export
│   │   ├── Footer.tsx          # Credits and help modal
│   │   └── ui/                 # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useSignaling.ts     # WebSocket signaling with auto-reconnect
│   │   ├── useWebRTC.ts        # WebRTC peer connections + adaptive quality + auto-reconnect
│   │   ├── useAudioMixer.ts    # Web Audio API mixing graph with per-channel monitors
│   │   ├── useAudioAnalyser.ts # Audio level analysis
│   │   ├── useRelayStream.ts   # Built-in audio relay (WebM capture → server FFmpeg → MP3)
│   │   ├── useIntegrationStream.ts # MP3 encoding + WebSocket relay for integrations
│   │   ├── useAutoIdentify.ts  # AcoustID-based auto song identification (temporarily disabled in UI)
│   │   ├── useKeyboardShortcuts.ts # Keyboard shortcut bindings for broadcaster
│   │   ├── useMicEffects.ts    # Mic effect chain (enhance, compressor, pitch shift worklets)
│   │   └── useRecorder.ts      # AudioWorklet + Web Worker MP3 recording
│   ├── lib/
│   │   ├── auth.ts             # Client-side session management
│   │   ├── debug.ts            # VITE_DEBUG-gated console logging
│   │   ├── integrations.ts     # Integration platform registry + localStorage config
│   │   ├── presets.ts          # Audio preset definitions + localStorage management
│   │   ├── webrtc-stats.ts     # Stats parsing utilities
│   │   └── zip-export.ts       # ZIP export of event log + track list
│   └── pages/
│       ├── Login.tsx           # Broadcaster authentication
│       ├── Broadcaster.tsx     # Main broadcast control page
│       ├── Receiver.tsx        # Listener page
│       └── Admin.tsx           # Room management dashboard
├── server/                     # Node.js signaling server
│   ├── index.js                # Express + WebSocket + ICE config + chat/metadata relay + Deezer proxy
│   ├── audio-identify.js       # Chromaprint fingerprinting + AcoustID lookup
│   ├── integration-relay.js    # TCP source client + metadata updater for Icecast/Shoutcast
│   ├── room-manager.js         # Multi-receiver room management with metadata + track list
│   ├── auth.js                 # Session management with expiry
│   └── logger.js               # Pino JSON logging
├── public/
│   ├── lame.min.js             # lamejs library for Web Worker MP3 encoding
│   ├── mp3-encoder-worker.js   # Web Worker for 320 kbps MP3 encoding
│   ├── recorder-processor.js   # AudioWorklet for energy-efficient PCM capture
│   ├── pitch-shift-processor.js  # AudioWorklet for real-time pitch shifting
│   └── noise-gate-processor.js   # AudioWorklet for noise gate (Enhance effect)
├── data/                       # Persistent server data (gitignored)
│   └── room-slugs.json        # Custom room slug history
├── VERSION                     # Current version number (read by Vite + displayed in footer)
├── Dockerfile                  # Multi-stage production build
├── fly.toml                    # Fly.io deployment config
└── docker-compose.yml          # Local Docker setup
```

## Security

- **Session auth** — HTTP-only cookies with configurable secret and server-side expiry
- **WebSocket auth** — Broadcaster connections require valid session; receiver connections are open
- **Rate limiting** — WebSocket message throttling to prevent abuse
- **Payload limits** — Maximum WebSocket message size enforced
- **CORS** — Configurable allowed origin
- **SDP/ICE validation** — Relayed WebRTC data is validated before forwarding
- **HTTPS** — Required for `getUserMedia` in production; use a reverse proxy (Caddy, nginx) or Fly.io for TLS
- **Graceful shutdown** — SIGTERM/SIGINT cleanly stops FFmpeg transcoders, drains relay listeners, and closes WebSocket connections before exit

## TURN Server

WebRTC peer-to-peer connections can fail behind restrictive NATs or firewalls. A TURN relay server solves this.

**Recommended: [Metered.ca](https://www.metered.ca/)** — Set `METERED_APP_NAME` and `METERED_API_KEY` and the server will dynamically fetch temporary TURN credentials.

**Alternative:** Set `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` for a static TURN server.

If no TURN configuration is provided, the app falls back to STUN-only (Google STUN servers).

## License

[MIT](LICENSE) — built by [SpecialOPS](https://specialops.io)
