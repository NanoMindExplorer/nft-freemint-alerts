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

## Operasi (Termux/proot)

```bash
bash /root/nft-alerts/start.sh   # mulai (supervisor auto-restart)
bash /root/nft-alerts/stop.sh    # hentikan
tail -f /root/nft-alerts/bot.log # log
```

Sebagai layanan resmi (VM/VPS Ubuntu asli dengan systemd):
`/etc/systemd/system/nft-alerts.service` sudah dibuat —
`systemctl daemon-reload && systemctl enable --now nft-alerts`.

## Konfigurasi

- `config.json` — webhook URL, interval, endpoint.
- `state.json` — baseline dedup. Hapus file ini + `state.dattWarmed`/`ncWarmed` akan reset, lalu semua data saat itu dianggap baseline.
- `bot.js` — kirim ke Discord, dua loop paralel (datt + nftcalendar).
