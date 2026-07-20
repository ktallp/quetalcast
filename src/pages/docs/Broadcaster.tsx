export default function DocsBroadcaster() {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground leading-relaxed [&_strong]:text-foreground space-y-10">
      <p className="text-base">
        The broadcaster console is where you run your show. Everything you need while live sits on
        one screen: level meter and transport on the left, and a tabbed side panel (Sounds,
        Effects, Tracks, Log) on the right.
      </p>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">The console at a glance</h2>
        <img
          src="/docs-img/console-offair.png"
          alt="The console before going live: level meter, Go On Air transport, Audio Setup, mixer, and the Sounds tab with pad banks"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Status bar</strong> (top): your on-air state, room ID, a REC indicator while
            recording, the on-air timer, and the current listener count. You never have to scroll
            to find your vitals.
          </li>
          <li>
            <strong>Left column</strong>: the input level meter, the transport (Go On Air, Rec,
            Mute, Listen, Cue, Limit), the collapsible Audio Setup, and the always-visible Mixer.
          </li>
          <li>
            <strong>Right column</strong>: a tabbed panel with Sounds, Effects, Tracks, and Log.
            Your last-used tab is remembered.
          </li>
        </ul>
        <p className="mt-2">
          The level meter works as soon as you select a microphone, so you can check levels before
          going live. Green is good, yellow is getting loud, red is too hot. A <strong>CLIP</strong>{' '}
          warning means your audio is maxing out.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Going on air</h2>
        <p>
          Press <strong>Go On Air</strong>. The button shows a pending state ("Requesting mic…")
          while your browser asks for microphone access, then a settings modal lets you set a{' '}
          <strong>stream title</strong>, <strong>description</strong>, and a custom{' '}
          <strong>receive URL</strong> slug (for example <code>/receive/elpasorocks</code>). Click{' '}
          <strong>Save &amp; Start</strong> to go live, or <strong>Skip</strong> to start with
          defaults. Title and description are remembered for next time.
        </p>
        <img
          src="/docs-img/console-onair.png"
          alt="The console while live: End Broadcast with timer, REC indicator, listener count, Receive link and Stream link buttons, and DUCK buttons in the mixer"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
        <p className="mt-2">
          While live, the Go On Air button becomes <strong>End Broadcast</strong> with the elapsed
          time on it. Ending asks for confirmation and reminds you how long you have been on air
          and how many listeners are connected, so a stray click can't kill your show.
        </p>
        <p className="mt-2">
          If you have data from a previous broadcast, a dialog appears first: download logs and
          track list as a ZIP (including the MP3 if you were recording), copy the old room link
          (valid for 24 hours), continue the previous broadcast, or start fresh.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Transport controls</h2>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Rec</strong>: record the broadcast as a 320 kbps MP3. Works before and during
            the broadcast. See Recording below.
          </li>
          <li>
            <strong>Mute</strong>: silences all channels going to listeners. (Space)
          </li>
          <li>
            <strong>Listen</strong>: hear what your listeners hear. On air only. (L)
          </li>
          <li>
            <strong>CUE</strong>: preview sound pads privately; they play for you but not for
            listeners. On air only. (C)
          </li>
          <li>
            <strong>Limit</strong>: the output limiter ceiling (0, -3, -6, or -12 dB). Keeps
            peaks from clipping no matter what you throw at the mix.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Audio Setup</h2>
        <p>
          The <strong>Audio Setup</strong> panel is expanded before you go live and collapses out
          of the way once you're on air. It holds:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Input Source</strong>: your microphone or audio interface. The level meter
            responds as soon as you pick one.
          </li>
          <li>
            <strong>System Audio</strong>: route desktop or app audio (Spotify, a browser tab,
            anything) into your broadcast. Your browser asks for screen share with audio; the
            video is discarded immediately and nothing on screen is recorded.
          </li>
          <li>
            <strong>Audio Quality</strong>: High (510 kbps stereo), Auto (adapts to connection
            health), or Low (32 kbps mono for slow connections).
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Mixer</h2>
        <p>
          The mixer is always visible with one strip per channel: <strong>Mic</strong>,{' '}
          <strong>Sound Pads</strong>, and <strong>System Audio</strong> (grayed out until
          connected). Each strip has:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>LED meter</strong>: a vertical LED ladder showing the live audio level on that
            channel, not the slider position.
          </li>
          <li>
            <strong>M / S buttons</strong>: mute or solo the channel.
          </li>
          <li>
            <strong>Headphone monitor</strong>: hear that channel locally through your
            speakers/headphones without affecting the broadcast. Handy in reverse too: turn the
            pads monitor off to fire clips at listeners without hearing them yourself.
          </li>
          <li>
            <strong>DUCK</strong> (Sound Pads and System Audio): auto-ducking. See below.
          </li>
          <li>
            <strong>Volume slider</strong> and a <strong>pan knob</strong>. Drag or mouse-wheel
            the knob, double-click to re-center, or use the arrow keys when it's focused. On
            phones the knob is replaced by simple L / C / R buttons.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Ducking</h3>
        <p>
          Turn on <strong>DUCK</strong> on a music channel and it automatically dips by about 9 dB
          whenever you speak, then eases back up when you stop. It's the classic radio move: talk
          over the intro without touching a fader. The DUCK button pulses while ducking is
          actively pulling the channel down.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Sounds</h2>
        <p>
          The <strong>Sounds</strong> tab holds your pads: three banks (<strong>A</strong>,{' '}
          <strong>B</strong>, <strong>C</strong>) of 10 pads each. Tap an empty pad to load an
          audio file. Once loaded:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>Tap to play or stop. A progress ring shows how far through the clip you are.</li>
          <li>Keys <strong>1 to 9 and 0</strong> trigger pads 1 to 10 in the active bank.</li>
          <li>Drag pads to reorder them within a bank.</li>
          <li>Loop icon: repeat the clip continuously.</li>
          <li>Gear icon: rename the pad or boost its volume up to 300%.</li>
          <li>X: remove the clip. Removal asks for confirmation.</li>
        </ul>
        <p className="mt-2">
          Pads are mixed into your broadcast through the Sound Pads channel. Use{' '}
          <strong>CUE</strong> to preview clips privately before playing them on air. Your pads,
          banks, and settings are saved locally and restored on reload.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Effects</h2>
        <img
          src="/docs-img/console-effects.png"
          alt="The Effects tab: Voice section with Sound check and Hold to bypass, gate and compressor meters, FX Pads with Q/W/E/T keycaps, Manual Effects, and Presets"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
        <p>
          The <strong>Effects</strong> tab processes your mic only; sound pads and system audio are
          never affected. It's split into three groups.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Voice</h3>
        <p>
          The always-useful processing chain: <strong>Enhance</strong> (noise gate, rumble filter,
          clarity), <strong>Tone</strong> (bass, mids, treble), <strong>Compressor</strong> (evens
          out your volume), and <strong>De-esser</strong> (tames harsh "s" sounds). Click a chip to
          toggle it, or the small gear to adjust its settings. Two live meters show what the chain
          is doing: a gate indicator that reads <strong>OPEN</strong> or <strong>CLOSED</strong>,
          and a compressor gain-reduction bar with the current reduction in dB.
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Hold to bypass</strong>: press and hold to hear your raw, unprocessed mic.
            Release to bring the processing back. Great for a quick before/after comparison.
          </li>
          <li>
            <strong>Sound check</strong> (optional): a ten-second measurement that tunes the noise
            gate and compressor for your room and mic. Stay quiet for 3 seconds, then speak for 6
            seconds; review the results and choose <strong>Apply settings</strong> or{' '}
            <strong>Skip</strong>. It never runs on its own.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">FX Pads</h3>
        <p>
          Momentary performance effects: <strong>Radio Voice</strong>, <strong>Big Room</strong>,{' '}
          <strong>Slapback</strong>, and <strong>Pitch Drop</strong>. Hold a pad (or its key:{' '}
          <strong>Q</strong>, <strong>W</strong>, <strong>E</strong>, <strong>T</strong>) to apply
          the effect while held; release and the tail rings out naturally. A quick tap latches the
          effect on until you tap again.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Manual Effects</h3>
        <p>
          <strong>Pitch</strong>, <strong>Delay</strong>, and <strong>Reverb</strong> stay in
          the chain while enabled. Toggle them like the Voice chips, and use the gear to tune each
          one.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Presets</h3>
        <p>
          The presets row saves and recalls effect profiles. Click a preset to apply it, use{' '}
          <strong>Save current…</strong> to store your own, and the trash icon to delete one
          (deletion asks for confirmation). Built-ins can't be deleted. Saved presets belong to
          your account, so they follow you between browsers and devices.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Tracks &amp; Now Playing</h2>
        <p>
          The <strong>Tracks</strong> tab has the Now Playing search at the top: Deezer
          autocomplete for artist and song, or type freeform text. While on air, committing a
          track adds it to the track list, sends it to all listeners in real time, and pushes it
          to any connected integration. The current track is highlighted with a spinning disc;
          click any track for details, and download the list as CSV with the icon next to the
          title.
        </p>
        <p className="mt-2">
          <strong>Setlist</strong>: the same search works before you go on air. Off-air commits
          queue into a setlist that keeps each track's full metadata (art, album, ISRC) and
          survives reloads. Once you're live, press <strong>Mark played</strong> on a row the
          moment it airs to publish it to the live track list, or remove rows you skipped. This
          is also the cleanest way to feed the compliance reports, since queued tracks arrive
          fully identified.
        </p>
        <p className="mt-2">
          <strong>Auto-identify</strong>: if the server has an AcoustID key configured, a
          checkbox appears in the broadcast settings dialog, "Automatically identify songs for
          reporting". It is off by default and applies to that session only; the ear icon in the
          console header toggles it mid-show, and it always resets when the broadcast ends.
          Recognized songs are matched to their ISRC, album, and label through Deezer and added
          to the track list. If there's no key on the server, neither control appears.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Show report</h2>
        <p>
          When you end a broadcast, a report opens with the listener curve (sampled once a
          minute), the peak and average listener counts, time on air, and how many tracks you
          played. Download the per-minute listener counts as CSV from the same dialog.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Hardware look</h2>
        <p>
          The gauge icon in the console header switches the console to an optional hardware
          skin: analog VU needles with real ballistics in place of the LED bars, sound pads
          styled as broadcast carts with color stripes and label strips, backlit latching
          switches for Rec, Mute, Listen, and Cue, and an LED elapsed-time display in the status
          bar. It is purely cosmetic, off by default, and remembered per browser. The mixer
          strips also show a small amber <strong>DUCK</strong> indicator whenever auto-duck is
          actively dipping music under your voice, in either look.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Recording</h2>
        <p>
          Press <strong>Rec</strong> in the transport to capture a 320 kbps stereo MP3. While
          recording, the button shows the elapsed time and a <strong>REC</strong> indicator pulses
          in the status bar. Start before going on air to capture your mic from the moment you hit
          record, or during the broadcast to capture the full mix. When you stop, the MP3 downloads
          in your browser.
        </p>
        <p className="mt-2">
          Ending the broadcast does not stop the recording: it continues until you stop it
          yourself or save it through the ZIP download in the start-new-broadcast dialog, so you
          never lose a take by ending the show first.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Sharing your broadcast</h2>
        <p>
          Once live, two copy buttons appear in the header. They point to different things:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Receive link</strong>: the listener page (<code>/receive/&lt;room&gt;</code>)
            for people tuning in with a browser. It has the Now Playing display, volume control,
            track list, and chat. Live browser slots are limited to 4 per room; extra listeners are
            offered the stream player instead.
          </li>
          <li>
            <strong>Stream link</strong>: the raw MP3 stream URL (<code>/stream/&lt;room&gt;</code>)
            for VLC, RadioDJ, and any media player that accepts HTTP audio. Use this one for radio
            software or when you expect a bigger audience; it scales well beyond the browser
            slots.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Keyboard shortcuts</h2>
        <p>
          Active while on air, and disabled whenever you're typing in a text field. Press{' '}
          <strong>?</strong> or click the keyboard icon in the header to see this list in the app.
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-4 font-semibold text-foreground">Key</th>
                <th className="py-2 font-semibold text-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-4"><code>Space</code></td>
                <td className="py-2">Toggle mute</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-4"><code>R</code></td>
                <td className="py-2">Toggle recording</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-4"><code>L</code></td>
                <td className="py-2">Toggle listen</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-4"><code>C</code></td>
                <td className="py-2">Toggle cue mode</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-4"><code>1</code> to <code>9</code>, <code>0</code></td>
                <td className="py-2">Trigger sound pads 1 to 10 (active bank)</td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-4"><code>Q</code> / <code>W</code> / <code>E</code> / <code>T</code></td>
                <td className="py-2">
                  Hold for Radio Voice / Big Room / Slapback / Pitch Drop FX (release to let the
                  tail ring out)
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4"><code>?</code></td>
                <td className="py-2">Show or hide the shortcuts reference</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">On mobile</h2>
        <p>
          On phones the console stacks into one column and a bottom tab bar
          (<strong>Mix</strong>, <strong>Pads</strong>, <strong>FX</strong>,{' '}
          <strong>Tracks</strong>, <strong>Log</strong>) jumps you straight to each section. Pan
          knobs become touch-friendly L / C / R buttons.
        </p>
        <img
          src="/docs-img/console-mobile.png"
          alt="The mobile console with the bottom tab bar: Mix, Pads, FX, Tracks, and Log"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Good to know</h2>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Everything survives restarts</strong>: broadcasts, track lists, and chat
            history are stored server-side, so a server restart or deploy won't wipe your show.
          </li>
          <li>
            <strong>Broadcast recovery</strong>: if your browser crashes or your connection drops,
            the server feeds silence to connected media players for up to 10 minutes. Reopen the
            console and you'll be offered <strong>Resume Broadcast</strong>; your audio replaces
            the silence and stream listeners never disconnect.
          </li>
          <li>
            <strong>Layout is saved</strong>: mixer settings, effects, pads, quality mode, and
            your selected input device are stored locally and restored on reload.
          </li>
          <li>
            <strong>Logout is global</strong>: logging out signs you out everywhere, not just in
            the current browser.
          </li>
        </ul>
      </section>
    </div>
  );
}
