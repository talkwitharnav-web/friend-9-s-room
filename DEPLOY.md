# Deploying the room

This project is separate from Gurukul, RSVP, Restaurant, and the Router.
**Never rebuild, restart, or redeploy those apps to publish this page.**
Do not modify the Router's visible page; this is an unlisted Easter egg.

## Installation

The room's system service and both hostname rules were installed on
**2026-09-09**. The Router's visible page is unchanged. The temporary
`friend9-route-replica-20260909.service` was retired after the persistent
connector registered and both hosts served the room and its exact assets.
The private pre-room tunnel backup is retained at
`/etc/cloudflared/config.pre-friend9-20260909.yml`; inspect its contents and
current routing before using it for a future rollback.

| Setting | Value |
|---|---|
| Serving-code revision, September 9, 2026 | `20292da5d3f4c7bbd0c008316618c74458e90906` |
| Service | `friend9-room.service` |
| Listen address | `127.0.0.1:3009` |
| Release directories | `/opt/friend9-room/releases/<full-commit-sha>` |
| Selected release | `/opt/friend9-room/current` |
| Local health | `http://127.0.0.1:3009/health` |
| Tunnel service | Existing `rsvp-cloudflared.service` |
| Tunnel config | Existing `/etc/cloudflared/config.yml` |

Use the owner's documented SSH access from Gurukul-Testing's
`PRODUCTION_VM.md`. Do not copy credentials into this repository or use an
application's admin/database credentials. The VM is shared infrastructure;
Docker, databases, workers, unrelated tunnels, and other web services stay
untouched.

For a **reviewed, committed and pushed** first release, export that exact
commit with `git archive --format=tar`. Calculate the archive's SHA-256
locally, transfer it over SSH to
`/home/itsvibed/friend9-upload-<full-commit-sha>.tar`, and transfer the reviewed
`deploy/install-first-release.sh` separately. Then run on the VM:

```bash
sudo bash /home/itsvibed/friend9-install-first-release.sh COMMIT_SHA ARCHIVE_SHA256
```

Export the installer from that same Git commit, not a Windows working copy
with CRLF line endings. A Git ZIP export plus `Expand-Archive` preserves its
committed LF bytes when transferring the script separately.

This is deliberately a **first-install-only** script. It refuses an existing
release, service, selected-release link, or occupied port. It verifies the
archive digest, runs the HTTP tests as an unprivileged user, validates the
unit, and enables only `friend9-room.service`. It deletes no files and changes
no tunnel rules. A failure leaves artifacts available for inspection rather
than attempting a broad cleanup or stopping an unknown process.

The installer changes into the readable release directory before running the
unprivileged tests. Starting Node's test subprocesses from the operator's
private home instead fails with `spawn /usr/bin/node EACCES`; do not fix that
by weakening home permissions or running the tests as root.

For later releases, stage another immutable commit directory, review the
explicit selected-release change, and verify the new archive digest.
Extract only into a new root-owned directory, change into it, and run the
HTTP tests as `nobody` before publication. Confirm the managed service and
the existing `current` symlink still identify the expected previous release.
Publish a new symlink atomically, replacing only that owned pointer, then
restart only this room's service. Retain every previous release directory
and all of its files. Never overwrite files inside a serving release or
repurpose the first-install script to clobber an existing install.

The selected pointer and the actual running process must agree:

```bash
readlink -f /opt/friend9-room/current
systemctl show friend9-room.service -p MainPID -p WorkingDirectory -p ActiveState
sudo readlink /proc/MAIN_PID/cwd
curl --fail http://127.0.0.1:3009/health
```

Use the freshly reported PID, never one copied from old notes. A source-only
documentation commit does not need another service restart.

## Exact route ownership

Both public hostnames need this rule **before their RSVP catch-all**:

```yaml
- hostname: itsvibed.com
  path: ^/(friend9s-room|public/friend9s-room)(/|$)
  service: http://127.0.0.1:3009
- hostname: www.itsvibed.com
  path: ^/(friend9s-room|public/friend9s-room)(/|$)
  service: http://127.0.0.1:3009
```

Insert each rule within its own hostname's existing group, not after an
earlier catch-all. Do not replace the existing rules, tunnel ID, or credential
file. The server sends a **302**, never a permanently cached redirect, from
`/friend9s-room` to `/public/friend9s-room`. All CSS, JavaScript, illustration
and favicon requests stay beneath the canonical prefix.

The `/health` path is local only because the ingress rule does not claim it.
Unrecognized paths beneath the room return the room's 404, not a different
app's document.

## Publishing the tunnel change

Follow Gurukul-Testing's current `DEPLOYMENT.md` replica procedure, not its
historical runbook. Never SIGHUP or restart the only healthy connector.

1. Record both hostnames' existing page/health responses and the other apps'
   service PIDs. Positively identify any other connector before touching it.
2. Keep a private, byte-for-byte copy of the current config on the VM. Patch
   only the two room rules in a separate candidate. Validate the candidate
   and exercise ingress rule selection for the room, its assets, both existing
   apps, admin denies, and lookalike prefixes.
3. Start a temporary same-tunnel replica with the candidate, using a verified
   free loopback metrics port. Require `/ready` to report registered
   connections before changing the main instance.
4. Publish the candidate preserving config ownership/permissions. Validate
   the resulting live file, then restart only `rsvp-cloudflared.service`.
   Require the main connector to become ready.
5. Follow the public redirect and load every asset on apex and www. Recheck
   existing pages and admin denies. Retire only the replica created by this
   operation once the main instance is healthy, then repeat the public checks.

For rollback, first make a last-known-good-config replica healthy. Restore
**this operation's** config backup, validate, restart and verify the main
connector, and only then retire the rollback replica. Never discard the last
working connector. Existing long-lived WebSocket connections may reconnect
during connector replacement; do not promise those sockets stay continuous.

The public page, redirect, assets, service enablement, selected release, and
unaffected sibling routes are all part of a successful deployment. A GitHub
push alone is not a deployment.
