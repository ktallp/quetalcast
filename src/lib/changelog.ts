/**
 * Changelog entries — curated list of meaningful releases.
 * `items` = features / enhancements, `fixes` = bug fixes / minor improvements.
 */

export interface ChangelogEntry {
  date: string;
  version: string;
  items: string[];
  fixes?: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-17',
    version: '0.7.2',
    items: [
      'Stream relay keepalive: the MP3 output is now frame-aligned and paced, so a hiccup on the broadcaster\'s connection is filled with silence at the real-time rate instead of pausing the byte stream (which is what made RadioDJ drop it); players get the last four seconds on connect so their buffer starts full, and the silence keeps flowing through a browser restart or dropped link until the broadcaster resumes',
      'The Stats panel has a Relay line (Feeding with player count, or Stalled with the duration) and the event log records relay stalls and resumes; the listener page shows an estimated mic-to-speaker Latency instead of a raw round trip, and the broadcaster\'s figure is labelled RTT',
    ],
    fixes: [
      'A dropped signaling connection while on air silently killed the stream relay for the rest of the show and stopped new listeners from joining; the console now rejoins the room and restarts the relay when the socket comes back, and an owner\'s resume takes over even if the server still holds the previous session',
      'The selected input device is restored after a browser restart: device enumeration no longer overwrites the saved choice with the first device, and the input is matched by name when the browser hands out new IDs. The log reminds you when system audio was connected last time',
      'The mixer now runs at a fixed 48 kHz instead of following the output device\'s rate, and if the OS restarts the input device mid-show (sample rate changed in the audio settings, interface replugged) the console reconnects the same input automatically instead of going silent',
    ],
  },
  {
    date: '2026-08-17',
    version: '0.7.1',
    items: [
      'Auto quality now adapts per listener through four tiers (510, 128, 64, 32 kbps) and switches on audio redundancy (RED) for the lower tiers, so bursty loss on cellular and tethered links is repaired instead of heard; a listener climbs back up once its link has been clean for a while, and one bad link no longer drags every listener down',
      'Listeners deepen their playback buffer while a link is dropping or jittery and shrink it again once it settles',
    ],
    fixes: [
      'Auto quality compared the cumulative lost-packet counter against a five-packet limit, so it dropped to 32 kbps mono a minute into almost any session and could never come back; it now uses the loss rate over the last ten seconds',
      'The Stats panel shows loss as a percentage over the last ten seconds instead of the all-time packet count (the count is in the tooltip), the Stream line reads "Lossy" instead of "Good" when loss is heavy, and the receiver Delay figure is no longer stuck at 0 ms',
      'The receiver echoes the Opus parameters (stereo, bitrate, FEC) into its answer, which is where the encoder actually reads them from',
    ],
  },
  {
    date: '2026-07-19',
    version: '0.7.0',
    items: [
      'Setlist: the track search now works off-air and builds a show plan; queued tracks keep their full metadata and publish to the live track list with "Mark played" once you are on air',
      'Show report: when a broadcast ends, a report shows the listener curve, peak, average, time on air, and tracks played, with a CSV export of the per-minute listener counts',
      'SoundExchange compliance: a new owner-only Compliance tab in Admin builds Reports of Use per quarter (artist, title, ISRC, album, label, performances), tracks aggregate tuning hours from a new listener session log, flags tracks missing an ISRC with a two-click Deezer fix-up, and exports a playlist CSV',
      'Show archive: optionally record every broadcast server-side and publish a public page at /show/<room> with the recording, a click-to-jump track list, and chat replayed in step with playback; retention is capped from the new Archives tab',
      'Auto-identify is now strictly per-session: off by default, enabled by a checkbox in the broadcast settings dialog ("Automatically identify songs for reporting") or the ear toggle, and always reset when the broadcast ends; identified songs are matched to ISRCs via Deezer for reporting',
      'Hardware look: an optional console skin (gauge icon in the header, off by default) with analog VU needles, cart-style sound pads, backlit latching transport switches, and an LED elapsed-time display',
      'Track rows can be tapped to copy "Artist · Title · time" for answering "what was that song?"',
      'Mixer strips show an amber DUCK indicator while auto-duck is actively dipping music under the mic',
      'The ON AIR badge is now a proper lamp: lit from within and readable across a room',
    ],
    fixes: [
      'Auto-identified tracks now carry their song title, album, label, and ISRC into the track list and persisted history (previously only the display text survived)',
      'Track metadata (ISRC, label, duration, song title) is now persisted to the database instead of living only in server memory',
    ],
  },
  {
    date: '2026-07-18',
    version: '0.6.2',
    items: [
      'Saved effect presets now belong to your account instead of the browser, so they follow you between devices; presets saved before this release migrate automatically on next use',
      'Broadcaster chat messages are sent under your username, no display-name prompt',
    ],
    fixes: [
      'The pitch effect chip no longer wraps to two lines (renamed from Voice Shift to Pitch)',
    ],
  },
  {
    date: '2026-07-18',
    version: '0.6.1',
    items: [
      'Owners can change an existing user\'s role between DJ and Owner from the admin Users tab',
    ],
    fixes: [
      'Admin link in the console header for signed-in broadcasters',
      'Issuing a password reset link no longer signs the user out; old sessions are revoked only when the new password is actually set',
      'Reset-link dialog wording now matches what actually happens',
      'Invite and reset link dialogs no longer overflow the card on long URLs',
      'Log out buttons in the console and admin headers (with a confirmation while on air or recording), plus a Console link on the admin page',
    ],
  },
  {
    date: '2026-07-18',
    version: '0.6.0',
    items: [
      'Redesigned broadcaster console: two-column layout with a persistent transport bar, always-visible mixer, and tabbed side panel (Sounds, Effects, Tracks, Log)',
      'Listener volume control: in-app volume slider and mute on the receiver page, remembered between visits',
      'Now Playing hero on the listener page with large album art and a plain-language connection status ("Streaming well"), technical stats behind a disclosure',
      'Copy the receive link and the stream link independently from both the broadcaster and receiver pages',
      'Effects reworked into Voice and FX: hold-to-bypass comparison, live compressor gain-reduction meter, gate open/closed indicator, and a new de-esser',
      'Momentary FX pads (Radio Voice, Big Room, Slapback, Pitch Drop) with hold-to-apply, tap-to-latch, natural ring-out tails, and Q/W/E/T keys',
      'Auto-duck: music channels dip automatically under your voice while you speak (per-channel toggle in the mixer)',
      'Optional ten-second sound check that measures your room and tunes the noise gate and compressor for you',
      'Sound pad banks (A/B/C), drag-to-reorder, playback progress rings, and keyboard hints on every pad',
      'User accounts: owners can create DJ and owner accounts from the new admin Users tab, with 24-hour invite links and per-user disable/delete',
      'Rebuilt admin dashboard: live stats (rooms, listeners, peak, uptime), per-room listener counts, peak, duration, and end-room action',
      'Auto-identify is back: an ear toggle recognizes songs playing in your broadcast and adds them to the track list (requires an AcoustID key)',
      'Room-full handoff: when the live room is full, listeners get a built-in player for the MP3 stream instead of a rejection',
      'Mobile console navigation: bottom tab bar and touch-friendly pan controls',
    ],
    fixes: [
      'Broadcasts, track lists, chat history, and saved URLs now survive server restarts and deploys (SQLite persistence with a mounted volume on Fly.io)',
      'The Fly.io machine no longer stops while idle, and health checks now watch the server',
      'Logout now revokes the session server-side; disabling a user kicks them immediately',
      'The server refuses to start in production with default secrets',
      'Icecast/Shoutcast streams reconnect automatically with backoff if the external server drops',
      'Go On Air shows a pending state while the mic is being requested; End Broadcast asks for confirmation',
      'Deleting pads, presets, and saved URLs now asks for confirmation',
      'The admin page works in production (it no longer targets a hardcoded dev port)',
      'Integration streaming migrated off the deprecated ScriptProcessorNode to an AudioWorklet',
      'Music search endpoints are rate limited; session cookies are marked Secure in production',
      'Screen-reader support across the console: labels on all icon buttons and a keyboard-accessible pan knob',
    ],
  },
  {
    date: '2026-02-19',
    version: '0.5.0',
    items: [
      'Stream relay now serves MP3 via server-side FFmpeg transcoding (WebM→MP3) with Icecast-compatible ICY headers for universal player support',
      'Pre-broadcast settings modal: set stream title, description, and custom URL before going on air — title and description persist in localStorage',
      'Silence keepalive: relay stream feeds silent MP3 frames for up to 10 minutes when the broadcaster disconnects so VLC/RadioDJ don\'t drop the connection',
      'Broadcast recovery: if the browser closes unexpectedly, reopening the page detects the previous broadcast and prompts to resume it',
      'Room slug history moved to server-side file persistence; slug picker shows live/available status indicators',
      'Stream title and description included in ICY headers (icy-name, icy-description) for media player display',
      'Changelog moved to dedicated /changelog page with version timeline and separate fixes section',
      'Version number displayed in footer',
    ],
    fixes: [
      'Server hardened for long-running streams: error-resilient IcyWriter with dead flag, FFmpeg stdin EPIPE handling, process lifecycle race condition fixes',
      'Graceful shutdown handler (SIGTERM/SIGINT) cleans up FFmpeg processes, relay listeners, and WebSocket connections on deploy',
      'X-Accel-Buffering: no header on stream endpoint for Nginx/Fly.io proxy compatibility',
      'Integration WebSocket connections now have ping keepalive to prevent proxy timeout on long streams',
      'FFmpeg probesize increased from 32 to 4096 bytes for reliable WebM header detection',
      'CORS middleware allows DELETE method for room slug management',
      'Silence keepalive runs for full 10-minute timeout regardless of stream URL listener count',
      'Room slug reclaim during silence keepalive window properly cleans up timers and relay listeners',
      'Room TTL expiry defensively cleans up FFmpeg processes and relay listeners',
      'Stream listener abrupt disconnects handled via error events on req and res',
      'relayHeader only stored in WebM fallback mode to prevent overwrite on broadcaster rejoin',
      'Headphones button matches mute/solo button size on mixer strips',
      'Global controls (Mute, Listen, CUE, Limit) moved from top of Audio Controls to Mixer Board header for better grouping',
    ],
  },
  {
    date: '2026-02-16',
    version: '0.4.0',
    items: [
      'Built-in HTTP audio relay: every broadcast gets a /stream/:roomId URL for VLC, RadioDJ, and other media players',
      'Per-channel headphone monitor buttons on mixer strips — hear or silence any channel locally without affecting listeners',
      'Custom receive URLs with slug picker (e.g. /receive/elpasorocks) — lowercase letters, numbers, hyphens, 3–40 chars',
      'Receiver share links split into browser link and media player stream URL with copy button',
      'Sound pad persistence across page reloads; pad play events logged in event log',
    ],
    fixes: [
      'Relay uses signaling WebSocket for binary audio instead of a separate connection',
      'VLC stream: Safari mono handling, proper WebM init segment forwarding',
      'Fixed TDZ error with useRelayStream hook initialization order',
      'Fixed 500 error on /stream/:roomId caused by em dash in icy-name header',
      'Stream endpoint excluded from SPA catch-all route',
    ],
  },
  {
    date: '2026-02-13',
    version: '0.3.3',
    items: [],
    fixes: [
      'internet-radio.com (Centova Cast) streaming compatibility improvements',
    ],
  },
  {
    date: '2026-02-12',
    version: '0.3.2',
    items: [
      'Mixer strip redesign: channel strips with level sliders, mute, solo, pan knobs, and LED signal meters',
      'Physical fader-style slider thumb on mixer strips',
      'LED-style volume indicators on mixer strip labels',
      'Draggable pan knobs with visual feedback',
      'Broadcaster layout persistence: mixer strips, effects, sound pads, quality mode, and input device saved to localStorage',
      'Mixer strip order: Mic, Sound Pads, System Audio',
    ],
    fixes: [
      'Mono mic inputs normalized to dual-channel before mixer for correct stereo metering',
      'Mono left-only meter fixed with speaker-aware bus mixing',
      'Volume and pan readouts display correctly on mixer strips',
    ],
  },
  {
    date: '2026-02-12',
    version: '0.3.1',
    items: [
      'internet-radio.com (Centova Cast) setup notes in docs and README',
    ],
    fixes: [
      'Stereo analyser gracefully falls back to mono duplication on iOS',
      'Mobile layout: stats panel 2-column, receiver mirrors broadcast panel order',
      'Mono input level meter, mixer mobile layout, and stats unit display fixes',
      'Icons added to Sounds / Effects accordion in collapsed state',
    ],
  },
  {
    date: '2026-02-12',
    version: '0.3.0',
    items: [
      'System audio capture: route desktop or application audio into the broadcast via screen share',
      'Auto-identify songs via AcoustID/Chromaprint audio fingerprinting',
      'Chat history sent to new receivers on join; join/leave system messages with participant names',
      'Unread chat badge on FAB; browser tab title flashes on new messages',
      'Docs page replaces help modal with dedicated sections for Broadcaster, Integrations, and Receiver',
      'Community profile files: code of conduct, contributing guide, security policy, issue/PR templates',
      'Recording continues after broadcast ends; MP3 included in ZIP download',
      'Collapsible mixer controls and audio controls panels',
    ],
    fixes: [
      'Autocomplete dropdown no longer clipped by accordion overflow',
      'Chat join/leave messages only fire when someone actually sends their first message',
    ],
  },
  {
    date: '2026-02-11',
    version: '0.2.4',
    items: [
      'Track list with Deezer-powered search, album artwork, and rich metadata (album, year, ISRC, BPM, label, contributors)',
      'Track detail modal with full metadata on click',
      'CSV download for track list and event log (includes room ID)',
      'Now Playing metadata automatically pushed to external integration server admin API',
    ],
    fixes: [
      'Tracks only added on explicit commit (Enter or Deezer selection) instead of on blur',
      'Track times shown in user local timezone instead of server time',
      'Chat FAB shown on receiver as soon as room is joined',
    ],
  },
  {
    date: '2026-02-11',
    version: '0.2.3',
    items: [
      'Broadcaster integrations: stream to Icecast, Shoutcast, or Radio.co via server-side relay',
      'Configurable stream quality: bitrate (128/192/256/320 kbps) and channels (stereo/mono)',
      'Energy-efficient local MP3 recorder using AudioWorklet + Web Worker at 320 kbps',
      'Bidirectional live chat with name prompt, full-screen on mobile, floating panel on desktop',
      'Real-time listener count displayed in broadcaster Stats panel',
      'Now Playing stream metadata visible to all receivers in real time',
      'Keyboard shortcuts: Space (mute), R (record), L (listen), C (cue), 1–0 (sound pads), ? (help)',
      'Audio presets: save and recall effect profiles with 3 built-in presets (Podcast Voice, DJ Mode, Lo-Fi)',
      'Receiver auto-reconnect on connection drop with exponential backoff (up to 5 attempts)',
    ],
  },
  {
    date: '2026-02-11',
    version: '0.2.2',
    items: [
      'TURN server support: Metered.ca dynamic credentials or static TURN config',
      'WebSocket heartbeat (25s ping) to prevent proxy timeout',
      'Mic effects: Compressor with threshold, ratio, and gain controls',
      'Mic effects: Enhance with noise gate, rumble filter, and clarity boost',
      'Pitch shifter AudioWorklet for real-time voice modification',
      'HMAC-signed stateless session tokens replace in-memory sessions',
      'Open-source release: MIT license, KTAL-LP favicon and OpenGraph image',
      'VITE_DEBUG env variable to toggle frontend debug logging',
    ],
    fixes: [
      'CUE mode mutes WebRTC output instead of broadcast bus so mic monitoring works',
      'Effect parameters apply immediately on slider change (removed Save button)',
    ],
  },
  {
    date: '2026-02-11',
    version: '0.2.1',
    items: [
      'Audio quality presets: High (510 kbps stereo Opus CBR), Auto (adaptive), Low (32 kbps mono)',
      'Security hardening: authenticated WebSocket broadcaster actions, locked broadcaster slot',
      'Multi-receiver support: up to 4 concurrent listeners per room',
    ],
    fixes: [
      'Expired sessions handled gracefully after server restart',
      'Receiver meter fixed to show both channels correctly',
      'VU meter scale labels aligned and peak readout added',
    ],
  },
  {
    date: '2026-02-11',
    version: '0.2.0',
    items: [
      'Stereo VU meter with calibrated dBFS scale, separate L/R channels, and peak hold',
      'Output limiter with selectable ceiling (0, -3, -6, -12 dB) and brickwall clipper',
      'Broadcast elapsed timer',
      'Mic effects panel with tabbed Sounds / Effects UI',
    ],
  },
  {
    date: '2026-02-11',
    version: '0.1.1',
    items: [
      'Footer with SpecialOPS credit and Help modal',
      'Receiver retry link on errored connection page',
      'User-friendly off-air state replacing dev server message',
    ],
    fixes: [
      'Cue mode: mute entire broadcast output so receiver hears nothing',
      'Room IDs shortened to 7 characters',
      'Mobile zoom on input focus prevented',
      'Off-air message for errored connections and footer positioning',
      'User-facing text rewritten to be friendly and non-technical',
    ],
  },
  {
    date: '2026-02-10',
    version: '0.1.0',
    items: [
      'Initial release: WebRTC audio broadcasting from one broadcaster to listeners',
      'Soundboard: 5x2 pad grid with MP3 loading, loop toggle, per-pad volume (up to 300%), and broadcast mixing',
      'Mixer controls: mic volume, mute, listen, and cue mode',
      'Audio input device selector with custom shadcn Select',
      'Server-side auth with ADMIN_PASSWORD environment variable',
      'Fly.io deployment with multi-stage Dockerfile',
    ],
    fixes: [
      'Fixed Go On Air not working due to stale closure race condition',
      'Fixed receiver level meter not showing output',
    ],
  },
];
