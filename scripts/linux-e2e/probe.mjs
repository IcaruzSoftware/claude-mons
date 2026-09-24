/**
 * Linux e2e probe — drives the REAL X pointer with xdotool against a running claude-mons instance
 * and asserts hover, left-click, drag, click-through and right-click at the OS input layer (not
 * CDP synthetic events, since the bug being verified is below Chromium). See
 * docs/runbooks/linux-e2e.md. Node >= 22 (global fetch/WebSocket), no npm deps.
 *
 * Reads over the DevTools Protocol from the pet renderer's debug-only `window.__monsProbe()` hook
 * to locate the sprite in screen space and to confirm the behaviour model reacted; reads the app's
 * CLAUDE_MONS_DEBUG stdout (APP_LOG) as the authoritative "did OS input reach the renderer" oracle;
 * captures screenshots, `xwininfo -shape`, `xprop` and `xev` output as artifacts.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.CLAUDE_MONS_DEBUG_PORT ?? '9333';
const ART = process.env.ARTIFACT_DIR ?? '.';
const APP_LOG = process.env.APP_LOG ?? join(ART, 'app.log');
const XEV_LOG = process.env.XEV_LOG ?? join(ART, 'xev.log');
const MODE = process.env.MODE ?? 'unknown';
const SUMMARY = process.env.SUMMARY_FILE ?? join(ART, 'summary.md');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- shell helpers ---------------------------------------------------------------------------

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (e) {
    return e.stdout ? String(e.stdout) : '';
  }
}
const xdotool = (...args) => sh('xdotool', args).trim();

function screenshot(name) {
  const path = join(ART, name);
  const r = spawnSync('import', ['-silent', '-window', 'root', path], { stdio: 'ignore' });
  if (r.status !== 0) spawnSync('bash', ['-c', `xwd -root -silent | convert xwd:- '${path}'`], { stdio: 'ignore' });
  return name;
}

function fileTextSafe(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// --- app log tailing (the OS-input oracle) ---------------------------------------------------

function logSize() { try { return statSync(APP_LOG).size; } catch { return 0; } }
function logSince(offset) { return fileTextSafe(APP_LOG).slice(offset); }
async function waitForLog(offset, needle, secs) {
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    if (logSince(offset).includes(needle)) return true;
    await sleep(200);
  }
  return false;
}

// --- CDP ------------------------------------------------------------------------------------

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`).catch(() => null);
  if (!res) return [];
  return (await res.json()).filter((t) => t.type === 'page');
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error(`cannot connect ${url}`)));
  });
}
let nextId = 1;
function rpc(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalIn(nameFrag, expr) {
  const all = await targets();
  const t = all.find((x) => x.url.includes(`/${nameFrag}/`) || x.url.includes(`${nameFrag}/index.html`));
  if (!t) return { found: false, value: undefined };
  const ws = await connect(t.webSocketDebuggerUrl);
  try {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { found: true, value: undefined };
    return { found: true, value: r.result.value };
  } finally {
    ws.close();
  }
}
async function petProbe() {
  const r = await evalIn('pet', 'JSON.stringify(window.__monsProbe ? window.__monsProbe() : null)');
  try { return r.value ? JSON.parse(r.value) : null; } catch { return null; }
}
async function windowVisible(nameFrag) {
  const r = await evalIn(nameFrag, "document.visibilityState");
  return r.found && r.value === 'visible';
}

// --- pointer aiming --------------------------------------------------------------------------

function spriteCenter(p) {
  const s = p?.spriteScreen;
  if (!s) return null;
  return { x: Math.round(s.x + s.w / 2), y: Math.round(s.y + s.h / 2) };
}
async function aimAtSprite() {
  const p = await petProbe();
  const c = spriteCenter(p);
  if (c) xdotool('mousemove', String(c.x), String(c.y));
  return { p, c };
}
/** Keep the pointer on the sprite for `ms`, re-aiming so a walking pet stays under the cursor. */
async function keepOnSprite(ms) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    const { c } = await aimAtSprite();
    if (c) last = c;
    await sleep(200);
  }
  return last;
}

// --- window / X evidence ---------------------------------------------------------------------

function petWindowId() {
  const out = xdotool('search', '--name', '^claude-mons pet$');
  return out.split('\n').filter(Boolean).pop() || '';
}
function captureXEvidence(tag, winId) {
  if (!winId) return;
  writeFileSync(join(ART, `xwininfo-${tag}.txt`), sh('xwininfo', ['-id', winId, '-stats', '-shape']));
  writeFileSync(join(ART, `xprop-${tag}.txt`), sh('xprop', ['-id', winId]));
}

// --- steps -----------------------------------------------------------------------------------

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.info(`[probe] ${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

async function main() {
  // 0. Wait until the sprite has a screen-space hitbox.
  let p0 = null;
  for (let i = 0; i < 60; i++) {
    p0 = await petProbe();
    if (p0?.spriteScreen) break;
    await sleep(500);
  }
  const winId = petWindowId();
  writeFileSync(join(ART, 'probe-initial.json'), JSON.stringify({ probe: p0, winId }, null, 2));
  captureXEvidence('rest', winId);
  screenshot('00-rest.png');
  if (!p0?.spriteScreen) {
    record('setup', false, 'pet renderer never reported a sprite hitbox (window.__monsProbe null)');
    return finish();
  }
  record('setup', true, `sprite at ${JSON.stringify(spriteCenter(p0))}, window ${winId}`);

  // 1. hover -> hover card
  {
    const off = logSize();
    const c = await keepOnSprite(1800);
    captureXEvidence('hover', winId);
    screenshot('01-hover.png');
    const trackOver = logSince(off).includes('"over":true');
    const hoverLog = logSince(off).includes('[pet] hover true');
    const card = await windowVisible('hovercard');
    record('hover', (trackOver || hoverLog) && card,
      `trackOver=${trackOver} hoverLog=${hoverLog} hoverCardVisible=${card} aimed=${JSON.stringify(c)}`);
  }

  // 2. left click -> panel visible
  {
    const off = logSize();
    await aimAtSprite();
    xdotool('click', '1');
    const reached = await waitForLog(off, '[pet] pointer down 0', 3);
    await sleep(800);
    const panel = await windowVisible('panel');
    screenshot('02-click.png');
    record('left-click', reached && panel, `pointerReachedRenderer=${reached} panelVisible=${panel}`);
  }

  // 3. drag -> anchor moves
  {
    const before = (await petProbe())?.pos?.x ?? null;
    const start = spriteCenter(await petProbe());
    if (start) {
      xdotool('mousemove', String(start.x), String(start.y));
      xdotool('mousedown', '1');
      for (let i = 1; i <= 10; i++) {
        xdotool('mousemove', String(start.x + i * 20), String(start.y));
        await sleep(40);
      }
      xdotool('mouseup', '1');
    }
    // let it land
    for (let i = 0; i < 20; i++) {
      const st = (await petProbe())?.state;
      if (st && !/drag|fall/.test(st)) break;
      await sleep(150);
    }
    const after = (await petProbe())?.pos?.x ?? null;
    screenshot('03-drag.png');
    const moved = before != null && after != null && Math.abs(after - before) >= 60;
    record('drag', moved, `anchorX ${before} -> ${after} (start ${JSON.stringify(start)})`);
  }

  // 4. click-through: a click on a transparent part of the pet window reaches the window beneath.
  {
    const p = await petProbe();
    const g = p?.geometry;
    const xevId = xdotool('search', '--name', '^Event Tester$').split('\n').filter(Boolean)[0] || '';
    let detail = 'no xev/geometry';
    let pass = false;
    if (g && xevId) {
      // Park the pet away from the corner we test, then place xev beneath the whole pet window.
      xdotool('windowmove', xevId, String(g.x - 40), String(g.y - 60));
      xdotool('windowsize', xevId, String(g.width + 80), String(g.height + 120));
      await sleep(400);
      // A transparent corner of the pet window well away from the (bottom-centre) sprite.
      const tx = g.x + 8;
      const ty = g.y + 8;
      const offLog = logSize();
      const xevBefore = fileTextSafe(XEV_LOG).length;
      xdotool('mousemove', String(tx), String(ty));
      xdotool('click', '1');
      await sleep(600);
      const xevGot = fileTextSafe(XEV_LOG).slice(xevBefore).includes('ButtonPress');
      const petGot = logSince(offLog).includes('[pet] pointer down');
      pass = xevGot && !petGot;
      detail = `xevReceivedClick=${xevGot} petSwallowed=${petGot} at (${tx},${ty})`;
    }
    screenshot('04-clickthrough.png');
    record('click-through', pass, detail);
  }

  // 5. right click -> context menu / tray popup
  {
    const off = logSize();
    await aimAtSprite();
    xdotool('click', '3');
    const reached =
      (await waitForLog(off, '[pet] pointer contextmenu', 3)) ||
      logSince(off).includes('[pet] pointer down 2');
    await sleep(500);
    screenshot('05-rightclick.png');
    record('right-click', reached, `contextEventReachedRenderer=${reached}`);
  }

  finish();
}

function finish() {
  writeFileSync(join(ART, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  let md = `\n## Linux e2e — ${MODE}\n\n`;
  md += `**${passed}/${results.length} checks passed**\n\n`;
  md += `| Step | Result | Detail |\n|---|---|---|\n`;
  for (const r of results) md += `| ${r.name} | ${r.pass ? '✅ pass' : '❌ fail'} | ${r.detail.replace(/\|/g, '\\|')} |\n`;
  appendFileSync(SUMMARY, md);
  console.info(md);
  const allPass = results.length > 0 && results.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  record('probe-error', false, String(e?.stack ?? e));
  finish();
});
