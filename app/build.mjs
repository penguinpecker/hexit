// node build.mjs → the web app in dist/: the website (dist/index.html = /, and the info pages from site/) and the game
// (index.html → dist/play.html = /play), with hexit-chain.js, site.js, avatars.js, the fonts, icons and QR library.
// dist/vercel.json gives the clean URLs (/play, /faq, ...): deploy dist as it is.
import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const API = JSON.stringify(process.env.HEXIT_API || 'https://hexit-game-production.up.railway.app');
mkdirSync(here + 'dist', { recursive: true });
await build({
  absWorkingDir: here,
  entryPoints: ['src/chain.ts'],
  outfile: 'dist/hexit-chain.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none',
  define: { __HEXIT_API__: API },
  nodePaths: ['../packages/monad/node_modules'],   // `viem/accounts` resolves to @hexit/monad's own viem: one viem in the bundle
  logLevel: 'warning',
});
await build({   // DiceBear avatars, offline (index.html loads dist/avatars.js after boot)
  absWorkingDir: here, entryPoints: ['src/avatars.ts'], outfile: 'dist/avatars.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none', logLevel: 'warning',
});
await build({   // the website's live parts: hero board, market cards, stats, leaderboard (no wallet, no viem)
  absWorkingDir: here, entryPoints: ['src/site.ts'], outfile: 'dist/site.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none',
  define: { __HEXIT_API__: API }, logLevel: 'warning',
});
const game = readFileSync(here + 'index.html', 'utf8');
writeFileSync(here + 'dist/play.html', game);   // the game, at /play
cpSync(here + 'fonts', here + 'dist/fonts', { recursive: true }); cpSync(here + 'vendor', here + 'dist/vendor', { recursive: true });   // bundled fonts + QR lib (offline)
copyFileSync(here + 'manifest.webmanifest', here + 'dist/manifest.webmanifest'); cpSync(here + 'icons', here + 'dist/icons', { recursive: true });   // installable web app (no service worker)
// site/og.png (1200x630 share card) is the brand X header on the surface colour, made once with:
// ffmpeg -f lavfi -i color=c=0x1c0639:s=1200x630 -i brand/hexit-x-header-3000x1000.png -filter_complex "[1]scale=1200:400,format=rgba,
//   geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(Y,399-Y)/48)'[fg];[0][fg]overlay=0:115" -frames:v 1 app/site/og.png
for (const f of ['site.css', 'og.png']) copyFileSync(here + 'site/' + f, here + 'dist/' + f);
copyFileSync(here + 'vercel.json', here + 'dist/vercel.json');

// ---- the website: site/layout.html around each page of site/pages/. Facts come from deployment/monad.json and from the
// game itself (the legal texts and the three intro steps the owner approved), so there is one copy of each.
const d = JSON.parse(readFileSync(here + '../deployment/monad.json', 'utf8'));
const usd = (micro) => '$' + (Number(micro) / 1e6).toLocaleString('en-US', { minimumFractionDigits: Number(micro) % 1e6 ? 2 : 0 });
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const doc = (id) => game.match(new RegExp(`<template id="doc-${id}">([\\s\\S]*?)</template>`))[1];
const slides = [...game.matchAll(/<div class="slide">\s*<div class="art cut kinetic">\s*(<svg[\s\S]*?<\/svg>)\s*<\/div>\s*<div class="micro">([\s\S]*?)<\/div>\s*<h2 class="head">([\s\S]*?)<\/h2>\s*<p>([\s\S]*?)<\/p>/g)];
if (slides.length !== 3) throw new Error(`index.html: expected the 3 intro steps, found ${slides.length}`);
const V = {
  site: (process.env.HEXIT_SITE || 'https://hexit-app.vercel.app').replace(/\/$/, ''),
  chainId: d.chainId, game: d.game, usdc: d.usdc, ...d.roles,
  gameShort: short(d.game), usdcShort: short(d.usdc), relayerShort: short(d.roles.relayer), keeperShort: short(d.roles.keeper),
  recorderShort: short(d.roles.recorder), quoterShort: short(d.roles.quoter),
  grant: usd(d.params.grant), minStake: usd(d.params.minStake), maxStake: usd(d.params.maxStake), maxPayout: usd(d.params.maxPayout),
  maxOpen: d.params.maxOpen, gapMs: d.params.gapMs, voidAfterS: d.params.voidAfterMs / 1000, lockS: (5100 + d.params.lockMarginMs) / 1000,
  quoteMaxAgeS: d.params.quoteMaxAgeMs / 1000,
  ...Object.fromEntries(slides.flatMap((m, i) => [[`art${i + 1}`, m[1]], [`micro${i + 1}`, m[2]], [`step${i + 1}`, m[3]], [`text${i + 1}`, m[4]]])),
  terms: doc('terms'), privacy: doc('privacy'), cookies: doc('cookies'),
};
const fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (v[k] === undefined) throw new Error(`site: no value for {{${k}}}`); return v[k]; });
V.marketCards = fill(readFileSync(here + 'site/market-cards.html', 'utf8'), V);   // the same two cards on Home and Markets
// path, source, title (with " · Hexit" unless it is the home page), description
const PAGES = [
  ['/', 'home', 'Hexit · Tap trading on Monad testnet', 'Double-tap a hex on a live honeycomb of price. If the price line enters it, you win stake × multiplier. Every tap is a Monad testnet transaction, gas paid by Hexit.'],
  ['/how-it-works', 'how-it-works', 'How it works', 'The rules of Hexit: columns, hexes, multipliers, the lock, BOOM, dud and refund, settlement on Monad testnet, and how the signed price tape keeps it fair.'],
  ['/markets', 'markets', 'Markets', 'BTC/USD and MON/USD on one balance. Each market has its own honeycomb of live price.'],
  ['/leaderboard', 'leaderboard', 'Leaderboard', 'Hexit players ranked by profit and loss in test USDC: daily, weekly and all time.'],
  ['/faq', 'faq', 'FAQ', 'Test USDC, the browser wallet, gas, withdrawals and fairness: answers about playing Hexit on Monad testnet.'],
  ['/terms', 'legal', 'Terms of Use', 'Hexit testnet terms of use.', 'terms'],
  ['/privacy', 'legal', 'Privacy Policy', 'What Hexit stores and why.', 'privacy'],
  ['/cookies', 'legal', 'Cookie Policy', 'What Hexit keeps in your browser.', 'cookies'],
];
// "/" for a returning player (a wallet key in this browser, as chain.ts stores it) is the game, unless they came from a
// page of this site (the game's Home link, the site's nav): the same-origin referrer (Referrer-Policy in vercel.json)
const RETURNING = `<script>try{var k=localStorage.getItem('hexit.monad.key'),r=document.referrer;if(/^0x[0-9a-f]{64}$/i.test(k||'')&&!(r&&new URL(r).origin===location.origin))location.replace('/play')}catch(e){}</script>`;
const layout = readFileSync(here + 'site/layout.html', 'utf8');
for (const [path, src, title, desc, legal] of PAGES) {
  const body = fill(readFileSync(here + `site/pages/${src}.html`, 'utf8'), { ...V, doc: legal ? V[legal] : '' });
  const html = fill(layout, { ...V, path, body, desc, title: path === '/' ? title : `${title} · Hexit`, head: path === '/' ? RETURNING : '' })
    .replaceAll(`data-p="${path}"`, `data-p="${path}" aria-current="page"`);
  writeFileSync(here + 'dist/' + (path === '/' ? 'index' : path.slice(1)) + '.html', html);
}
