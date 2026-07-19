export default function DocsIntegrations() {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground leading-relaxed [&_strong]:text-foreground space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Integrations</h2>
        <p>
          Before going on air, click the <strong>Integrations</strong> button to connect to an
          external streaming platform (Icecast, Shoutcast, or Radio.co). Enter your server
          credentials and use <strong>Test Connection</strong> to verify. You can save credentials
          and quality settings to localStorage with the "Remember" checkbox.
        </p>
        <p className="mt-2">
          When broadcasting with an integration, audio goes to the external platform, but a room is
          still created so listeners can access chat, track list, and now-playing metadata. Now
          Playing metadata is automatically forwarded to the external server's admin API so
          listeners on those platforms can see what's playing too.
        </p>
        <p className="mt-2">
          If the external Icecast/Shoutcast server drops mid-broadcast, the stream reconnects
          automatically with increasing delays. The event log shows when it's reconnecting and
          when the stream is back; only a hard failure (like wrong credentials) ends the stream.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Stream quality</h3>
        <p>
          The integration settings include <strong>Bitrate</strong> (128, 192, 256, or 320 kbps)
          and <strong>Channels</strong> (Stereo or Mono). The default is <strong>stereo at
          192 kbps</strong>. Stereo at 192+ kbps is recommended for best compatibility with
          RadioDJ, VLC, and other players.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Stream URL</h3>
        <p>
          When an integration is active, receivers see a <strong>Stream URL</strong> on the receiver
          page: this is the direct Icecast/Shoutcast listener URL. Copy it and paste into:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>RadioDJ</strong>: Options → Track Import → Track Type: Internet Stream → paste the URL
          </li>
          <li>
            <strong>VLC</strong>: Media → Open Network Stream → paste the URL
          </li>
          <li>
            <strong>Any media player</strong> that accepts standard HTTP audio streams
          </li>
        </ul>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Mount point naming</h3>
        <p>
          For best compatibility with RadioDJ, VLC, and other players, use a <code>.mp3</code>{' '}
          extension in your mount point (e.g. <code>/stream.mp3</code> instead of{' '}
          <code>/stream</code>). This helps players detect the audio format correctly. VLC in
          particular can misidentify the codec without the extension.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">internet-radio.com (Centova Cast)</h3>
        <p>
          internet-radio.com uses Centova Cast v3. Find your settings under <strong>Settings → Stream</strong> and{' '}
          <strong>Settings → Mount Points</strong>.
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Mount point</strong>: The default is <code>/stream</code>. Use <code>/stream.mp3</code> for best
            compatibility. Enter the exact mount from your control panel; listeners must connect to the same path.
          </li>
          <li>
            <strong>AutoDJ</strong>: If AutoDJ is running on the mount point, stop it before going live, or ensure
            source override is enabled so your live stream takes priority.
          </li>
          <li>
            <strong>Source password</strong>: Use the administrator/source password from Settings → Stream.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Built-in stream relay</h2>
        <p>
          Every broadcast (with or without an external integration) exposes a built-in stream URL
          at <code>/stream/:roomId</code>. The server captures the WebM/Opus audio from the
          broadcaster and transcodes it to MP3 in real time using FFmpeg, serving it with
          Icecast-compatible ICY headers. This URL works in:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li><strong>VLC</strong>: Media → Open Network Stream → paste the URL</li>
          <li><strong>RadioDJ</strong>: Options → Track Import → Internet Stream → paste the URL</li>
          <li><strong>internet-radio.com</strong> and other platforms that accept HTTP audio streams</li>
          <li><strong>Any media player</strong> that supports MP3 over HTTP</li>
        </ul>
        <p className="mt-2">
          The stream URL is shown on the receiver page. If FFmpeg is not available on the server,
          the relay falls back to serving raw WebM/Opus (works in VLC and browsers but not
          traditional radio software).
        </p>
        <p className="mt-2">
          If the broadcaster disconnects unexpectedly (browser crash, network issue), the server
          automatically feeds silent MP3 frames for up to <strong>10 minutes</strong> so media
          players stay connected. When the broadcaster returns and resumes, live audio replaces
          the silence seamlessly.
        </p>
        <p className="mt-2">
          The relay is hardened for long-running streams: individual listener failures are isolated
          so one disconnected player can't disrupt others, FFmpeg transcoding restarts cleanly on
          reconnect, and the server performs graceful shutdown during deploys to avoid orphaned
          processes.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Keyboard shortcuts</h2>
        <p>
          While on air, use these keys for hands-free control (disabled when typing in text
          inputs):
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Space</strong>: Toggle mute
          </li>
          <li>
            <strong>R</strong>: Toggle recording
          </li>
          <li>
            <strong>L</strong>: Toggle listen
          </li>
          <li>
            <strong>C</strong>: Toggle cue mode
          </li>
          <li>
            <strong>1–9, 0</strong>: Trigger sound pads 1–10 in the active bank
          </li>
          <li>
            <strong>Q / W / E / T</strong>: Hold for Radio Voice / Big Room / Slapback / Pitch
            Drop FX; release to let the tail ring out
          </li>
          <li>
            <strong>?</strong>: Show/hide shortcuts reference
          </li>
        </ul>
        <p className="mt-2">
          Click the keyboard icon next to "Broadcaster" in the header to see the full shortcut
          reference.
        </p>
      </section>
    </div>
  );
}
