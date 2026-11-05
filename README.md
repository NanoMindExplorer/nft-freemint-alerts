# NFT Freemint Alerts → Discord

Monitor realtime yang mengirim peringatan mint NFT dari dua sumber ke webhook Discord.

## Sumber & strategi

| Sumber | Endpoint | Interval | Catatan |
|---|---|---|---|
| datt.my (MintRadar) | `data/kontrak/index.json` + `kontrak/<addr>.json` | 60 detik | Data JSON resmi untuk agen; batas situs "poll max 1x/menit". Radar mint BNB Chain dengan label keamanan: 🔴 merah (berbahaya), 🟡 kuning (owner bisa ubah/withdraw), 🟢 hijau (bersih) |
| nftcalendar.io | `/tag/freemint/` (via proxy `r.jina.ai`) + halaman detail tiap event baru | 5 menit | Situs diblokir Cloudflare; render markdown lewat proxy pembaca. Detail event diambil perlahan (delay 5 dtk) supaya hemat rate-limit |

## Cara kerja

1. Tiap siklus, polling data mentah.
2. Bandingkan dengan `state.json` (baseline). Saat pertama jalan, semua data lama di-seed **tanpa diborong** ke Discord → hanya kejadian BARU yang diumumkan ke depan.
3. Item baru dikirim sebagai embed Discord:
   - datt.my: nama kontrak, alamat, chain, label berwarna sesuai risiko, daftar temuan (withdraw/owner/proxy dsb.), tautan ke halaman kontrak.
   - nftcalendar.io: judul, rentang tanggal drop, blockchain & marketplace (dari detail), cuplikan deskripsi, gambar banner, tautan event.
4. Rate-limit Discord (429) ditangani dengan retry Sesuai `retry_after`. Error jaringan di-retry dengan backoff.

## Operasi

### GitHub Actions (jalur utama, repo public + cron `*/5`)

- Workflow: `.github/workflows/nft-alerts.yml` — tiap 5 menit: `node bot.js --once` (satu siklus poll), lalu `state.json` di-commit lagi ke repo sebagai memori bank antar-run. Dedup dijamin lintas-run.
- Webhook berada di GitHub Secret `DISCORD_WEBHOOK_URL` (tidak ada di dalam file apa pun).
- Repo public = menit Actions gratis untuk standard runner.
- **Catatan delay**: cron Actions adalah best-effort (~5–15 menit), bukan realtime absolut.
- Tips: skedul bisa nonaktif otomatis setelah 60 hari tampak "tidak aktif" — apabila kosong, jalankan `gh workflow run "nft freemint alerts"` sekali untuk menghidupkannya kembali (`workflow_dispatch`).

### Daemon lokal (opsional, paling realtime datt.my: 60 detik)

```bash
bash /root/nft-alerts/start.sh   # mulai (supervisor auto-restart)
bash /root/nft-alerts/stop.sh    # hentikan
tail -f /root/nft-alerts/bot.log # log
```

Hidupkan CHUKA SATU jalur saja. Lokal, state.json tidak di-sync — bila daemon dan Actions berjalan bersamaan dua sumber bisa mengumumkan hal yang sama.

USB/VM asli Ubuntu + systemd: `/etc/systemd/system/nft-alerts.service` telah dibuat → `systemctl daemon-reload && systemctl enable --now nft-alerts`.

## Konfigurasi

- `config.json` — endpoint, interval (webhook **tidak** disimpan di sini).
- `secrets.env` (gitignored) — `DISCORD_WEBHOOK_URL` untuk local run.
- `state.json` — baseline dedup; pada CI, file ini dipulihkan berulang tiap siklus.
- `bot.js` — `--once` untuk satu siklus (dipakai CI), default daemon loop.
