#!/usr/bin/env node
'use strict';

// Verifikasi PAT fine-grained untuk memicu workflow:
//   node tools/test-trigger.js github_pat_XXXX
// Sukses = HTTP 204. 401 = token salah/salah repo. 403 = izin Actions tidak Read+Write.

const TOKEN = process.argv[2] || process.env.TRIGGER_PAT;

if (!TOKEN) {
  console.error('Pemakaian: node tools/test-trigger.js <PAT>');
  process.exit(1);
}

const res = await fetch(
  'https://api.github.com/repos/NanoMindExplorer/nft-freemint-alerts/actions/workflows/nft-alerts.yml/dispatches',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nft-alerts',
    },
    body: JSON.stringify({ ref: 'master' }),
  }
);

console.log(`HTTP ${res.status} ${res.statusText}`);
if (res.status === 204) {
  console.log('OK — workflow_dispatch berhasil. Token ini benar & membawa izin Actions.');
} else if (res.status === 401) {
  console.log('Token salah / kedaluwarsa / bukan token itu. Cek kembali saat menyalin.');
} else if (res.status === 403) {
  console.log('Token valid tapi izin Actions belum "Read and write", atau repo/permissions salah.');
} else if (res.status === 422) {
  console.log('Syarat salah — pastikan Ref = master dan nama file workflow .yml benar.');
} else {
  const t = await res.text();
  console.log(t.slice(0, 400));
}
