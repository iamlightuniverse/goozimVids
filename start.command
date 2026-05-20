#!/bin/bash

BOLD='\033[1m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  printf "${BOLD}${RED}✖  Node.js is required to run this app.${RESET}\n"
  echo ""
  printf "${BOLD}Install it here  ➜  \e]8;;https://nodejs.org/en/download/current\e\\https://nodejs.org/en/download/current\e]8;;\e\\${RESET}\n"
  echo ""
  printf "${BOLD}Once installed, double-click start.command again.${RESET}\n"
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  echo ""
  exit 0
fi

# cd to the directory containing this script
cd "$(dirname "$0")"

# Install dependencies on first run
if [ ! -d "node_modules" ]; then
  printf "${BOLD}Installing dependencies (first run only)...${RESET}\n"
  npm install
  echo ""
fi

# Open browser after a short delay
(sleep 2 && open http://localhost:3000) &

printf "${BOLD}Starting Goozim Videos...${RESET}\n"
echo ""

npm run dev:all
