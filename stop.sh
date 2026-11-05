#!/usr/bin/env bash
# Hentikan semuanya: supervisor + node bot.js
pkill -f "bash /root/nft-alerts/run.sh" 2>/dev/null
pkill -f "node bot.js" 2>/dev/null
rm -f /root/nft-alerts/bot.pid
echo "stopped"
