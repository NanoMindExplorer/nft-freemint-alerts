#!/usr/bin/env bash
# Mulai monitor. Aman dijalankan berulang (tidak dobel proses).
D=/root/nft-alerts
if [ -f "$D/bot.pid" ] && kill -0 "$(cat $D/bot.pid)" 2>/dev/null; then
  echo "sudah jalan (pid $(cat $D/bot.pid))"; exit 0
fi
if pgrep -f "node bot.js" >/dev/null 2>&1; then
  echo "sudah jalan (node bot.js)"; exit 0
fi
nohup setsid bash "$D/run.sh" </dev/null >/dev/null 2>&1 &
echo $! > "$D/bot.pid"
echo "start dengan pid $(cat $D/bot.pid)"
