#!/usr/bin/env bash
# Supervisor: nyalakan bot dan hidupkan ulang otomatis jika mati.
# Jalankan dengan:  nohup bash run.sh >/dev/null 2>&1 &   (atau jalankan lewat start.sh)
cd "$(dirname "$0")"
while :; do
  node bot.js >> bot.log 2>&1
  echo "$(date -u +%FT%TZ) [supervisor] bot exited ($?), restarting in 10s" >> bot.log
  sleep 10
done
