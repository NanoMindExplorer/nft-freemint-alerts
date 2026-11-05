#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// Webhook: env > secrets.env > config.json
CFG.webhookUrl =
  process.env.DISCORD_WEBHOOK_URL ||
  (() => {
    const f = path.join(__dirname, 'secrets.env');
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^\s*DISCORD_WEBHOOK_URL\s*=\s*(\S+)\s*$/);
        if (m) return m[1];
      }
    }
    return CFG.webhookUrl || '';
  })();

const ONCE = process.argv.includes('--once');
const STATE_FILE = path.join(__dirname, 'state.json');
const RES_DIR = path.join(__dirname, 'results');
fs.mkdirSync(RES_DIR, { recursive: true });

const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { datt: {}, nc: {}, started: Date.now() };

function saveState() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, STATE_FILE);
}

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Discord ----------------

const LABEL_COLORS = {
  merah: 0xED4245,
  kuning: 0xFEE75C,
  hijau: 0x57F287,
};

function fmtTs(unix) {
  return Math.floor(unix) ? `<t:${Math.floor(unix)}:F>` : null;
}

function fmtRel(unix) {
  return `<t:${Math.floor(unix)}:R>`;
}

async function postDiscord(payload) {
  if (!CFG.webhookUrl) return false;
  const url = CFG.webhookUrl;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const wait = (body.retry_after || 1) * 1000;
        log(`discord 429, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        log(`discord ${res.status}: ${t.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e) {
      log(`discord fetch error: ${e.message}`);
      await sleep(attempt * 2000);
    }
  }
  return false;
}

// ---------------- datt.my (MintRadar) ----------------

const FINDING_TEXT = {
  TIDAK_DISAHKAN: 'Source tidak terverifikasi (tidak bisa dibaca siapa pun)',
  PROKSI: 'Kontrak proxy yang bisa diupgrade',
  KEKAL_DANA: 'Alamat hard-coded bisa memindahkan dana',
  KEKAL_KUASA: 'Alamat hard-coded memegang hak istimewa',
  OWNER_DANA: 'Owner bisa menarik dana',
  OWNER_UBAH: 'Owner bisa mengubah aturan',
  DILEPASKAN: 'Ownership sudah renounced',
  AGENT_ID: 'Mint hanya untuk pemegang Binance Agent ID',
};

async function pollDatt() {
  try {
    const res = await fetch(CFG.datt.indexUrl, { headers: { 'User-Agent': 'nft-alerts/1.0' } });
    if (!res.ok) throw new Error(`index HTTP ${res.status}`);
    const data = await res.json();
    const contracts = Array.isArray(data.contracts) ? data.contracts : [];
    log(`datt index: ${contracts.length} contracts (generated_at ${data.generated_at})`);

    const fresh = contracts.filter((c) => c && c.address && !state.datt[c.address]);
    if (!fresh.length) return;

    for (const c of fresh) {
      const addr = c.address.toLowerCase();
      state.datt[addr] = Date.now();
    }
    saveState();

    if (!state.dattWarmed) {
      // first run: jangan spam; cukup catat semua sebagai sudah terlihat
      state.dattWarmed = true;
      saveState();
      log(`datt: seeded ${contracts.length} existing contracts, no backfill spam`);
      return;
    }

    // kontrak benar-benar baru -> ambil detail lalu blast
    const toAnnounce = fresh.slice(0, 6);
    for (const c of toAnnounce) {
      const addr = c.address.toLowerCase();
      let detail = null;
      try {
        const r = await fetch(CFG.datt.detailUrl.replace('{address}', addr), {
          headers: { 'User-Agent': 'nft-alerts/1.0' },
        });
        if (r.ok) detail = await r.json();
      } catch (e) {
        log(`datt detail ${addr}: ${e.message}`);
      }

      const label = (detail?.label || c.label || '').toLowerCase();
      const color = LABEL_COLORS[label] || 0x99aab5;
      const labelIcon = label === 'merah' ? '\u{1F534}' : label === 'kuning' ? '\u{1F7E1}' : label === 'hijau' ? '\u{1F7E2}' : '\u{26AA}';
      const name = detail?.name || c.name || 'Unnamed contract';
      const findings = Array.isArray(detail?.findings) ? detail.findings : [];
      const findingLines = findings
        .slice(0, 8)
        .map((f) => `• **${f.code}**${f.function ? ` (\`${f.function}()\`)` : ''} — ${FINDING_TEXT[f.code] || f.text || ''}`)
        .join('\n');

      const verdict =
        label === 'merah'
          ? '⚠️ **Hati-hati**: kontrak berisiko. Jangan bayar apa pun sebelum membaca source-nya sendiri.'
          : label === 'kuning'
            ? '🟡 Relatif normal untuk kebanyakan mint — cek fungsi owner yang tercantum sebelum bayar.'
            : label === 'hijau'
              ? '🟢 Tidak ada fungsi istimewa di source verified — tetap bukan jaminan; cek harga & supply sendiri.'
              : null;

      const fields = [
        { name: 'Chain', value: (detail?.chain || 'bsc').toUpperCase(), inline: true },
        { name: 'Label', value: `${labelIcon} ${label || 'unknown'}`, inline: true },
        { name: 'Diperiksa', value: detail?.checked_at ? fmtTs(detail.checked_at) : '—', inline: true },
        { name: 'Kontrak', value: '`' + addr + '`', inline: false },
      ];
      if (findingLines) fields.push({ name: 'Temuan', value: findingLines, inline: false });
      if (Array.isArray(detail?.privileged_functions) && detail.privileged_functions.length)
        fields.push({
          name: 'Fungsi Istimewa',
          value: '`' + detail.privileged_functions.join('`, `') + '`',
          inline: false,
        });

      const links = [
        `[Buka di MintRadar](${CFG.datt.pageUrl.replace('{address}', addr)})`,
        detail?.source ? `[Source (Sourcify)](${detail.source})` : null,
        `[BscScan](https://bscscan.com/address/${addr})`,
      ]
        .filter(Boolean)
        .join(' • ');

      const embed = {
        title: `${labelIcon} ${name}`,
        url: CFG.datt.pageUrl.replace('{address}', addr),
        color,
        description: [verdict, links].filter(Boolean).join('\n\n'),
        fields,
        footer: { text: 'MintRadar • datt.my • radar mint BNB Chain' },
        timestamp: new Date().toISOString(),
      };
      await postDiscord({ embeds: [embed], username: 'MintRadar Alerts' });
      log(`datt: announced ${addr} (${label})`);
      await sleep(1500);
    }
    if (fresh.length > 6) {
      await postDiscord({
        content: `🎯 ${fresh.length} mint baru berdetak di radar sekaligus — ${fresh.slice(0, 8).map((c) => `[${(c.name || 'unnamed').slice(0, 24)}](https://datt.my/c/${c.address.toLowerCase()}/)`).join(', ')}${fresh.length > 8 ? ' …' : ''}`,
        username: 'MintRadar Alerts',
      });
    }
  } catch (e) {
    log(`datt poll error: ${e.message}`);
  }
}

// ---------------- nftcalendar.io (tag freemint) ----------------

function parseFreeMintPage(md) {
  const events = [];
  const lines = md.split('\n');
  let lastImg = null;
  let lastDesc = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const img = line.match(/\[!\[[^\]]*\]\((https:\/\/nftcalendar\.io\/storage\/[^)]+)\)\]\((https:\/\/nftcalendar\.io\/event\/[^)]+\/?)\)/);
    if (img) {
      lastImg = img[1];
      continue;
    }
    const title = line.match(/^##\s*\[([^\]]+)\]\((https:\/\/nftcalendar\.io\/event\/[^)]+\/?)\)\s*$/);
    if (!title) continue;
    const url = title[2].replace(/\/$/, '') + '/';
    let date = '';
    let desc = '';
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const l = lines[j].trim();
      if (!date && /^\w{3} \d{1,2}, \d{4} –/.test(l)) date = l;
      else if (/^\w{3} \d{1,2}, \d{4} – \w{3} \d{1,2}, \d{4}$/.test(l)) date = l;
      if (!date && /^(Aug|Sep|Oct|Nov|Dec|Jan|Feb) \d{1,2}, \d{4}/.test(l)) date = l;
      if (date && l && !/^\[|^##|^---|verified/.test(l) && !/^\w{3} \d{1,2}, \d{4}/.test(l)) {
        desc = l;
        break;
      }
      if (date && date.length && /^\[!\[/.test(l)) break;
    }
    events.push({ title: title[1].trim(), url, image: lastImg, date, desc: lastDesc || desc });
    lastDesc = null;
  }
  return events;
}

async function fetchViaProxy(url) {
  const target = CFG.nftcalendar.jinaProxy + url;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(target, {
        headers: { 'X-No-Cache': 'true', 'User-Agent': 'nft-alerts/1.0' },
      });
      if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      log(`proxy ${url} attempt ${attempt}: ${e.message}`);
      await sleep(3000 * attempt);
    }
  }
  return null;
}

const NC_MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseNcDateRange(s) {
  if (!s) return null;
  const rx = /(\w{3}) (\d{1,2}), (\d{4})/g;
  const parts = [...s.matchAll(rx)].map((m) => {
    const t = Date.UTC(+m[3], NC_MONTHS[m[1] in NC_MONTHS ? m[1] : 'Jan'], +m[2], 0, 0, 0) / 1000;
    return Math.floor(t);
  });
  if (!parts.length) return null;
  const start = Math.min(...parts);
  const end = Math.max(...parts) + 86399;
  return { start, end };
}

async function announceNcEvent(ev, withDetail) {
  let chain = null;
  let marketplace = null;
  let shortDesc = ev.desc || '';
  if (withDetail) {
    const md = await fetchViaProxy(ev.url);
    if (md) {
      const bc = md.match(/### Blockchain:\s*\n+\s*\[([^\]]+)\]/);
      if (bc) chain = bc[1];
      const mk = md.match(/### Marketplace:\s*\n+\s*\[([^\]]+)\]/);
      if (mk) marketplace = mk[1];
      const start = md.indexOf('## ' + ev.title);
      if (start >= 0) {
        const body = md.slice(start + ev.title.length + 4, start + 2500 + ev.title.length);
        const cleaned = body
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('[') && !l.startsWith('###') && !/^https/.test(l) && l !== 'verified')
          .slice(0, 3)
          .join(' ');
        if (cleaned) shortDesc = cleaned.slice(0, 500);
      }
    }
  }
  const rng = parseNcDateRange(ev.date);
  const now = Math.floor(Date.now() / 1000);
  const fields = [
    {
      name: 'Konteks waktu',
      value: rng
        ? rng.start > now
          ? `Mulai ${fmtTs(rng.start)} (${fmtRel(rng.start)}), berakhir ${fmtTs(rng.end)}`
          : rng.end < now
            ? `Sudah berakhir — ${fmtTs(rng.end)} (seulement arsip)`
            : `**Berjalan sekarang** \u2014 berakhir ${fmtRel(rng.end)} (${fmtTs(rng.end)})`
        : ev.date || '\u2014',
      inline: false,
    },
  ];
  const embed = {
    title: `\u{1F4A5} Freemint NFT baru: ${ev.title}`,
    url: ev.url,
    color: 0x00b0f4,
    fields,
    footer: { text: 'NFT Calendar \u2022 tag #freemint' },
    timestamp: new Date().toISOString(),
  };
  if (chain) fields.push({ name: 'Blockchain', value: chain, inline: true });
  if (marketplace) fields.push({ name: 'Marketplace', value: marketplace, inline: true });
  const links = `[Laman drop](${ev.url})`;
  embed.description = [shortDesc ? shortDesc.slice(0, 400) : null, links].filter(Boolean).join('\n\n') || undefined;
  if (ev.image) embed.image = { url: ev.image };
  await postDiscord({ embeds: [embed], username: 'Freemint Alerts' });
  log(`nc: announced ${ev.title} -> ${ev.url}`);
}

async function pollNftCalendar() {
  const md = await fetchViaProxy(CFG.nftcalendar.tagUrl);
  if (!md) return;
  const events = parseFreeMintPage(md);
  log(`nc freemint page: ${events.length} events`);
  if (!events.length) return;

  const fresh = events.filter((e) => !state.nc[e.url]);
  for (const e of events) state.nc[e.url] = state.nc[e.url] || 0;

  if (!state.ncWarmed) {
    state.ncWarmed = true;
    for (const e of events) state.nc[e.url] = Date.now();
    saveState();
    log(`nc: seeded ${events.length} existing events, no backfill spam`);
    return;
  }
  saveState();

  for (const [i, ev] of fresh.slice(0, 5).entries()) {
    state.nc[ev.url] = Date.now();
    const withDetail = fresh.length <= 3 && i < 3;
    await announceNcEvent(ev, withDetail);
    if (withDetail) await sleep(CFG.nftcalendar.detailDelayMs);
  }
  saveState();

  if (fresh.length > 5)
    await postDiscord({
      content: `🎯 +${fresh.length - 5} drop freemint lain di <https://nftcalendar.io/tag/freemint/> — ${fresh.slice(5).map((e) => `[${e.title}](${e.url})`).join(', ')}`,
      username: 'Freemint Alerts',
    });
}

// ---------------- status (sekali, permanen) ----------------

async function postStartupStatus() {
  if (state.postedStatus || !CFG.webhookUrl) return;
  state.postedStatus = true;
  saveState();
  const mode = ONCE ? 'GitHub Actions (cron */5)' : 'daemon lokal';
  const dattCount = Object.keys(state.datt).length;
  const ncCount = Object.keys(state.nc).length;
  const embed = {
    title: '📡 Monitor Freemint aktif',
    color: 0x5865F2,
    fields: [
      {
        name: 'Sumber 1 — MintRadar (datt.my)',
        value: `${dattCount} kontrak mint BNB Chain terpantau\n${mode === 'daemon lokal' ? 'Frekuensi: 60 detik' : 'Frekuensi: tiap siklus cron */5'}`,
        inline: false,
      },
      {
        name: 'Sumber 2 — NFT Calendar',
        value: `${ncCount} drop pada tag #freemint terpantau\nFrekuensi: 5 menit`,
        inline: false,
      },
    ],
    description: '\ud83d\udccc *Semua item lama di-"seed" sebagai baseline — tidak diborong. Mulai sekarang, hanya kontrak & drop **BARU** yang diumumkan di sini.*',
    footer: { text: 'nft-alerts' },
    timestamp: new Date().toISOString(),
  };
  await postDiscord({ embeds: [embed], username: 'Freemint Alerts' });
  log('startup status posted');
}

// ---------------- main ----------------

async function main() {
  log(`starting nft-alerts (node ${process.version}, mode: ${ONCE ? 'once' : 'daemon'})`);
  if (!CFG.webhookUrl) log('WARNING: no webhook URL configured!');

  if (ONCE) {
    if (CFG.datt.enabled) await pollDatt();
    if (CFG.nftcalendar.enabled) await pollNftCalendar();
    await postStartupStatus();
    saveState();
    log('once-mode done');
    return;
  }

  await postStartupStatus();

  const dattLoop = async () => {
    for (;;) {
      if (CFG.datt.enabled) await pollDatt();
      await sleep(CFG.datt.intervalMs);
    }
  };
  const ncLoop = async () => {
    for (;;) {
      if (CFG.nftcalendar.enabled) await pollNftCalendar();
      await sleep(CFG.nftcalendar.intervalMs);
    }
  };
  await Promise.all([dattLoop(), ncLoop()]);
}

process.on('unhandledRejection', (e) => log('unhandledRejection', e?.message || String(e)));

module.exports = { pollDatt, pollNftCalendar, state, saveState, postDiscord };

if (require.main === module) main().catch((e) => {
  log('fatal', e);
  process.exit(1);
});
