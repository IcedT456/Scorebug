#!/bin/bash
# Same as start.command, but lets your phone control the board over wifi.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get the LTS installer from https://nodejs.org then double-click this again."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
LAN=1 node server.js
