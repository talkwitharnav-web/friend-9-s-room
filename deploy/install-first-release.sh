#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 || $# -ne 2 ]]; then
  echo "Usage: sudo bash install-first-release.sh COMMIT_SHA ARCHIVE_SHA256" >&2
  exit 1
fi

revision=$1
checksum=$2
if [[ ! $revision =~ ^[a-f0-9]{40}$ || ! $checksum =~ ^[a-f0-9]{64}$ ]]; then
  echo "Expected a full Git commit and SHA-256 digest." >&2
  exit 1
fi

archive="/home/itsvibed/friend9-upload-${revision}.tar"
release="/opt/friend9-room/releases/${revision}"
unit=/etc/systemd/system/friend9-room.service

# First installation only: never replace another deployment or a live listener.
if [[ -e /opt/friend9-room/current || -L /opt/friend9-room/current || -e $unit || -e $release ]]; then
  echo "A room deployment already exists. Inspect it; this installer will not overwrite it." >&2
  exit 1
fi
if [[ -n $(ss -H -ltn 'sport = :3009') ]]; then
  echo "Port 3009 is occupied. No process has been stopped." >&2
  exit 1
fi
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status

install -d -m 0755 /opt/friend9-room /opt/friend9-room/releases "$release"
tar --extract --file "$archive" --directory "$release" --no-same-owner --no-same-permissions
/usr/bin/node --check "$release/server.mjs"
/usr/bin/node --check "$release/public/room.js"
runuser -u nobody -- /usr/bin/node --test "$release/test/server.test.mjs"
systemd-analyze verify "$release/deploy/friend9-room.service"

ln -s "$release" /opt/friend9-room/current
install -m 0644 "$release/deploy/friend9-room.service" "$unit"
systemctl daemon-reload
systemctl enable --now friend9-room.service

response=$(curl --fail --silent --show-error --max-time 5 \
  --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:3009/health)
if [[ $response != '{"status":"ok","service":"friend9-room"}' ]]; then
  echo "The new room did not return its expected health response. Inspect friend9-room.service." >&2
  exit 1
fi
systemctl is-enabled friend9-room.service
systemctl is-active friend9-room.service
printf 'Room release is running: %s\n' "$revision"
echo "The tunnel has not been changed. Publish its two scoped routes separately."
