export default function DocsReceiver() {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground leading-relaxed [&_strong]:text-foreground space-y-10">
      <p className="text-base">
        The receiver page is for listeners. Open the link shared by the broadcaster, tap once to
        start audio, and you're in.
      </p>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Joining a broadcast</h2>
        <p>
          Open the link shared by the broadcaster; it takes you straight to their broadcast. If you
          only have a Room ID, paste it into the field and press <strong>Join</strong>. When the
          broadcast is ready you'll see a big <strong>Tap to Listen</strong> button: browsers
          require one tap before they'll play audio, and that's it.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Now Playing &amp; volume</h2>
        <img
          src="/docs-img/receiver.png"
          alt="The listener page: Now Playing hero with album art, volume slider and mute, a Streaming well status pill with Technical details toggle, track list, and copy-link buttons"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
        <p>
          Once you're listening, a <strong>Now Playing</strong> hero shows the current track with
          large album art, updated in real time as the broadcaster changes tracks. Below it:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Volume slider</strong>: set your listening level without touching your system
            volume.
          </li>
          <li>
            <strong>Mute button</strong>: one tap to silence, one tap to bring it back.
          </li>
        </ul>
        <p className="mt-2">
          Your volume and mute state are remembered between visits.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Connection status</h2>
        <p>
          A small status pill tells you how the stream is doing in plain language:{' '}
          <strong>Streaming well</strong>, <strong>Buffering…</strong>, or{' '}
          <strong>Reconnecting</strong>. If your connection drops, the app retries automatically
          with increasing delays; after repeated failures you get a manual{' '}
          <strong>Try again</strong> button.
        </p>
        <p className="mt-2">
          Curious about the numbers? Click <strong>Technical details</strong> to reveal the level
          meter, connection health stats (speed, jitter, delay, packet loss), and the event log.
          They stay hidden by default so the page stays clean.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Track list</h2>
        <p>
          The track list shows every track played, with album artwork, duration, and release year.
          The current track is highlighted at the top. If you join mid-broadcast you still see the
          full history. Click any track for details, or download the list as CSV with the icon in
          the header. The copy icon on each row copies "Artist · Title · time" to your clipboard,
          the fastest answer to "what was that song?".
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Live chat</h2>
        <p>
          A chat button sits in the bottom-right corner (full-screen panel on mobile, floating
          card on desktop). The first time you open it you'll be asked for a display name. You see
          the full chat history when you join, and messages from the broadcaster and other
          listeners in real time. Messages are capped at 280 characters, one per second. An unread
          badge appears when you have new messages and the browser tab title flashes until you
          open the chat.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Sharing &amp; the stream URL</h2>
        <p>
          Once joined, two copy buttons appear in the header:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Receive link</strong>: this page's URL, for sharing with friends who'll listen
            in a browser.
          </li>
          <li>
            <strong>Stream link</strong>: a direct MP3 audio URL for media players. Paste it into{' '}
            <strong>VLC</strong> (Media → Open Network Stream), <strong>RadioDJ</strong> (Options →
            Track Import → Internet Stream), or any player that accepts HTTP audio streams.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">If the room is full</h2>
        <p>
          Each room allows 4 live browser listeners at a time. If you arrive when all slots are
          taken, you aren't turned away: the page hands you a built-in player connected to the MP3
          stream, which scales to many more listeners. You can keep listening there, or copy the
          stream URL into your own media player.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">When the broadcast ends</h2>
        <p>
          When the broadcaster goes off air you'll see a message. The room link stays valid for{' '}
          <strong>24 hours</strong>, so you can still browse the track list and keep chatting.
          Use <strong>Retry this broadcast</strong> if you expect them back, or paste a different
          Room ID to join another broadcast.
        </p>
        <p className="mt-2">
          If the station has archiving turned on, ended shows also get a permanent page at{' '}
          <code>/show/&lt;room&gt;</code> with the full recording, a track list you can click to
          jump around the audio, and the chat replayed in step with playback.
        </p>
      </section>
    </div>
  );
}
