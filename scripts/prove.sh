#!/bin/sh
# Serve this folder on loopback, run the page proof against it, and stop the
# server whether the proof passed, failed, timed out or was interrupted.
#   sh scripts/prove.sh /play/ [shots folder]
set -u
cd "$(dirname "$0")/.." || exit 1
port=${PORT:-8791}
python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT INT TERM HUP
sleep 1
# a limit of its own, so a hung browser cannot outlive the call
perl -e 'alarm 150; exec @ARGV' node scripts/page-proof.mjs "http://127.0.0.1:$port" "$@"
