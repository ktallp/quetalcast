export default function DocsAdmin() {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground leading-relaxed [&_strong]:text-foreground space-y-10">
      <p className="text-base">
        The admin dashboard lives at <code>/admin</code>. Any logged-in user (owner or DJ) can open
        it and see the Rooms tab; the Users tab is owners only.
      </p>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Rooms</h2>
        <img
          src="/docs-img/admin-rooms.png"
          alt="The admin Rooms tab: live stats for rooms, listeners, peak, and uptime, plus a table of rooms with per-room actions"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
        <p>
          The Rooms tab refreshes itself every few seconds. At the top, four live stats:{' '}
          <strong>Live Rooms</strong>, <strong>Listeners Now</strong>, <strong>Peak Today</strong>,
          and <strong>Server Uptime</strong>. Below them, every room with its status (Live or
          Ended), current listeners (browser and stream combined), peak listeners, and duration.
        </p>
        <p className="mt-2">Each room has quick actions:</p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Open</strong>: opens the listener page for that room in a new tab.
          </li>
          <li>
            <strong>Copy link</strong>: copies the listener link to your clipboard.
          </li>
          <li>
            <strong>End room</strong> (owners only, live rooms only): disconnects the broadcaster
            and all listeners. You'll be asked to confirm, because this can't be undone.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Users</h2>
        <img
          src="/docs-img/admin-users.png"
          alt="The admin Users tab: user list with role chips, last-active times, per-user actions, and a Create User button"
          className="rounded-lg border border-border my-4"
          loading="lazy"
        />
        <p>
          Owners manage accounts from the Users tab. Each user shows their role, status (Active or
          Disabled), and when they were last active.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Roles</h3>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Owner</strong>: full access. Can broadcast, manage users, and end any room.
          </li>
          <li>
            <strong>DJ</strong>: can broadcast and view the Rooms tab, but can't manage users or
            end other people's rooms.
          </li>
        </ul>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Creating a user</h3>
        <p>
          Click <strong>Create User</strong>, choose a username (3 to 30 characters: lowercase
          letters, numbers, and hyphens) and a role. You never set their password. Instead, you
          get an <strong>invite link</strong> to share with them; they open it at{' '}
          <code>/join/&lt;token&gt;</code> and set their own password. Invite links expire after{' '}
          <strong>24 hours</strong>; if one expires unused, just generate a new one with the reset
          action.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">Managing users</h3>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Change role</strong> (shield icon): promote a DJ to Owner or turn an Owner back
            into a DJ. Confirmed before it happens, and the last remaining Owner can't be demoted.
          </li>
          <li>
            <strong>Reset password</strong> (key icon): generates a fresh 24-hour link where the
            user sets a new password. Handy for forgotten passwords and expired invites alike.
            Nothing changes until the link is used; once the new password is set, their old
            sessions are signed out.
          </li>
          <li>
            <strong>Disable</strong> (ban icon): the user can no longer sign in, and any active
            sessions are kicked immediately. Confirmed before it happens, and you can re-enable
            them later.
          </li>
          <li>
            <strong>Delete</strong> (trash icon): permanently removes the account. Confirmed
            before it happens; this can't be undone.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Compliance</h2>
        <p>
          The owner-only <strong>Compliance</strong> tab prepares SoundExchange Reports of Use.
          Pick a quarter and it aggregates every persisted track into unique recordings with
          artist, title, ISRC, album, marketing label, spins, and performances (listeners whose
          sessions overlapped each play), plus aggregate tuning hours from the listener session
          log the server keeps for both browser and media-player listeners.
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 pl-1">
          <li>
            <strong>Service name and license category</strong> are set once at the top and stamped
            onto every export.
          </li>
          <li>
            <strong>Need ISRC</strong> counts tracks that lack both an ISRC and an album + label
            pair. The <strong>Fix</strong> button on each one searches Deezer and attaches the
            right recording's metadata in two clicks. Freeform and auto-identified entries are the
            usual culprits.
          </li>
          <li>
            <strong>Download Report of Use</strong> exports a tab-delimited file with
            SoundExchange's field names; <strong>Playlist CSV</strong> exports one row per spin.
          </li>
        </ul>
        <p className="mt-2">
          Verify the current ROU template and your license category against your SoundExchange
          agreement before filing. The tab prepares the data; it is not legal advice.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Archives</h2>
        <p>
          The owner-only <strong>Archives</strong> tab turns on server-side recording: every
          broadcast's relay MP3 is teed to the data volume and published at{' '}
          <code>/show/&lt;room&gt;</code> as a public page with the recording, a click-to-jump
          track list, and chat replay. A retention cap (default 10 shows) deletes the oldest
          recordings automatically; individual archives can be opened or deleted from the list.
          Archiving applies to broadcasts started after it is switched on.
        </p>
      </section>
    </div>
  );
}
