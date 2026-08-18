import { Link } from 'react-router-dom';

export default function DocsOverview() {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground leading-relaxed [&_strong]:text-foreground">
      <p className="text-base">
        QueTal Cast is a real-time audio broadcasting app for low-latency, high-quality streaming
        from a single broadcaster to multiple listeners. Built with WebRTC, React, and Node.js.
      </p>

      <img
        src="/docs-img/console-onair.png"
        alt="The broadcaster console while live: End Broadcast button with timer, mixer, and the tabbed side panel"
        className="rounded-lg border border-border my-4"
        loading="lazy"
      />

      <h2 className="text-lg font-semibold text-foreground mt-8 mb-3">Quick links</h2>
      <ul className="space-y-2 list-none pl-0">
        <li>
          <Link to="/docs/broadcaster" className="text-primary hover:underline">
            Broadcaster
          </Link>
          {': '}
          The console: transport, mixer, sound pads, effects, track list, recording, sharing
        </li>
        <li>
          <Link to="/docs/receiver" className="text-primary hover:underline">
            Receiver
          </Link>
          {': '}
          Tuning in, volume, connection status, track list, chat
        </li>
        <li>
          <Link to="/docs/admin" className="text-primary hover:underline">
            Admin &amp; Users
          </Link>
          {': '}
          Rooms dashboard, creating users, roles, invite links
        </li>
        <li>
          <Link to="/docs/integrations" className="text-primary hover:underline">
            Integrations &amp; Shortcuts
          </Link>
          {': '}
          Icecast, Shoutcast, Radio.co, keyboard shortcuts
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground mt-8 mb-3">Getting started</h2>
      <ol className="list-decimal list-inside space-y-2 pl-1">
        <li>Log in with your credentials.</li>
        <li>
          Open <strong>Audio Setup</strong> and pick your input source. The level meter at the top
          shows your input right away so you can check levels before going live.
        </li>
        <li>
          Click <strong>Go On Air</strong>. The button shows a pending state while your browser
          requests the mic, then the console switches to its live state.
        </li>
        <li>
          Share your broadcast with the two copy buttons in the header: <strong>Receive link</strong>{' '}
          opens the listener page in a browser, and <strong>Stream link</strong> is the MP3 URL for
          VLC, RadioDJ, and other media players.
        </li>
      </ol>

      <h2 className="text-lg font-semibold text-foreground mt-8 mb-3">Tech stack</h2>
      <ul className="space-y-2 list-none pl-0">
        <li>
          <strong>React + TypeScript</strong>
          {': '}
          Frontend UI built with Vite for fast development and optimized production builds
        </li>
        <li>
          <strong>Web Audio API</strong>
          {': '}
          Full audio mixing graph with per-channel gain, pan, mute/solo, headphone monitors,
          auto-ducking, output limiting, and a real-time voice chain (enhance, tone, compressor,
          de-esser) plus momentary and manual effects
        </li>
        <li>
          <strong>WebRTC</strong>
          {': '}
          Peer-to-peer audio streaming with Opus codec (up to 510 kbps stereo), per-listener adaptive quality with packet redundancy on lossy links,
          and automatic reconnection
        </li>
        <li>
          <strong>WebSockets</strong>
          {': '}
          Signaling for WebRTC, live chat, metadata relay, and built-in audio stream relay
        </li>
        <li>
          <strong>Node.js + Express</strong>
          {': '}
          Signaling server with session auth, user accounts, room management, TURN credential
          proxy, and integration relay
        </li>
        <li>
          <strong>SQLite</strong>
          {': '}
          Server-side persistence for rooms, track lists, chat history, users, and sessions, so
          broadcasts survive server restarts and deploys
        </li>
        <li>
          <strong>MediaRecorder + FFmpeg</strong>
          {': '}
          Built-in audio relay: browser captures WebM/Opus, server transcodes to MP3 via FFmpeg with
          Icecast-compatible ICY headers, served at <code>/stream/:roomId</code> for VLC, RadioDJ,
          and other media players
        </li>
        <li>
          <strong>lamejs</strong>
          {': '}
          Client-side MP3 encoding for integration streams (Icecast, Shoutcast, Radio.co)
        </li>
        <li>
          <strong>AudioWorklet</strong>
          {': '}
          Energy-efficient recording (320 kbps MP3), pitch shifting, noise gate processing, and
          integration streaming off the main thread
        </li>
        <li>
          <strong>Deezer API + AcoustID</strong>
          {': '}
          Autocomplete search for Now Playing metadata with album artwork, and optional automatic
          song identification
        </li>
        <li>
          <strong>Tailwind CSS + shadcn/ui</strong>
          {': '}
          Utility-first styling with accessible, composable UI primitives
        </li>
        <li>
          <strong>Fly.io</strong>
          {': '}
          Production deployment via multi-stage Docker build with a WebSocket-aware proxy and a
          mounted volume for the database
        </li>
      </ul>
    </div>
  );
}
