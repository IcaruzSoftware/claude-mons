/**
 * Linux e2e probe — drives the REAL X pointer with xdotool against a running claude-mons instance
 * and asserts hover, left-click, drag, click-through and right-click at the OS input layer (not
 * CDP synthetic events, since the bug being verified is below Chromium). See
 * docs/runbooks/linux-e2e.md. Node >= 22 (global fetch/WebSocket), no npm deps.
 *
 * Reads over the DevTools Protocol from the pet renderer's debug-only `window.__monsProbe()` hook
 * to locate the sprite in screen space and confirm the model reacted; reads the app's
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
const swaymsg = (...args) => sh('swaymsg', args);

// --- pointer input backend -------------------------------------------------------------------
// The bug under test lives below Chromium, so we drive OS pointer input, not CDP synthetic events.
// x11: xdotool warps the X pointer via XTEST. wayland-xwayland: a persistent virtual-pointer client
// (scripts/linux-e2e/vpointer.c, started by run.sh) holds a real pointer device on sway's seat and
// takes commands over a FIFO; sway forwards its motion/buttons to XWayland and then the app, exactly
// as on a real Wayland session. XTEST cannot do this under XWayland, so xdotool would move nothing
// (see docs/runbooks/linux-e2e.md). Buttons are named 'left'/'right'; each backend maps its own way.

function makeInput(mode) {
  if (mode === 'wayland-xwayland') {
    const fifo = process.env.VP_FIFO;
    const send = (cmd) => { try { appendFileSync(fifo, cmd + '\n'); } catch { /* daemon gone */ } };
    const btn = (b) => (b === 'right' ? 'right' : 'left');
    return {
      move: (x, y) => send(`move ${Math.round(x)} ${Math.round(y)}`),
      down: (b) => send(`down ${btn(b)}`),
      up: (b) => send(`up ${btn(b)}`),
      click: (b) => send(`click ${btn(b)}`),
    };
  }
  const btn = (b) => (b === 'right' ? '3' : '1');
  return {
    move: (x, y) => xdotool('mousemove', String(x), String(y)),
    down: (b) => xdotool('mousedown', btn(b)),
    up: (b) => xdotool('mouseup', btn(b)),
    click: (b) => xdotool('click', btn(b)),
  };
}
const input = makeInput(MODE);

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
    await sleep(150);
  }
  return false;
}

// --- CDP ------------------------------------------------------------------------------------

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`).catch(() => null);
  if (!res) return [];
  return (await res.json().catch(() => [])).filter((t) => t.type === 'page');
}
async function appAlive() { return (await targets()).length > 0; }
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
  let ws;
  try {
    ws = await connect(t.webSocketDebuggerUrl);
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { found: true, value: undefined };
    return { found: true, value: r.result.value };
  } catch {
    return { found: false, value: undefined };
  } finally {
    ws?.close();
  }
}
async function petProbe() {
  const r = await evalIn('pet', 'JSON.stringify(window.__monsProbe ? window.__monsProbe() : null)');
  try { return r.value ? JSON.parse(r.value) : null; } catch { return null; }
}
/** A window is "visible" if its DevTools target exists and reports visibilityState 'visible'. */
async function windowVisible(nameFrag) {
  const r = await evalIn(nameFrag, 'document.visibilityState');
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
  if (c) input.move(c.x, c.y);
  return { p, c };
}

// --- window / X evidence ---------------------------------------------------------------------

/** Find the pet's X window by matching the CDP-reported geometry (Electron's X WM_NAME is not a
 *  reliable lookup key on every WM). */
function petWindowId(geometry) {
  if (!geometry) return '';
  const ids = new Set(
    xdotool('search', '--name', 'claude-mons').split('\n').filter(Boolean)
      .concat(xdotool('search', '--all', '--onlyvisible', '').split('\n').filter(Boolean)),
  );
  for (const id of ids) {
    const g = sh('xdotool', ['getwindowgeometry', '--shell', id]);
    const x = Number(/X=(-?\d+)/.exec(g)?.[1]);
    const y = Number(/Y=(-?\d+)/.exec(g)?.[1]);
    const w = Number(/WIDTH=(\d+)/.exec(g)?.[1]);
    if (Math.abs(x - geometry.x) <= 2 && Math.abs(y - geometry.y) <= 2 && Math.abs(w - geometry.width) <= 2)
      return id;
  }
  return '';
}
function captureXEvidence(tag, winId) {
  if (!winId) { writeFileSync(join(ART, `xwininfo-${tag}.txt`), '(pet X window id not found)\n'); return; }
  writeFileSync(join(ART, `xwininfo-${tag}.txt`), sh('xwininfo', ['-id', winId, '-stats', '-shape']));
  writeFileSync(join(ART, `xprop-${tag}.txt`), sh('xprop', ['-id', winId]));
}

/** The X server's own idea of the pointer (XQueryPointer) — what the real mouse would report. */
function getMouseLoc() {
  const s = sh('xdotool', ['getmouselocation', '--shell']);
  const x = Number(/X=(-?\d+)/.exec(s)?.[1]);
  const y = Number(/Y=(-?\d+)/.exec(s)?.[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
/** The cursor the APP last saw via screen.getCursorScreenPoint(), parsed from its debug log. */
function latestAppCursor() {
  const lines = fileTextSafe(APP_LOG).split('\n').filter((l) => l.includes('[pet] track'));
  const last = lines.at(-1);
  const m = last && /"cursor":\{"x":(-?\d+),"y":(-?\d+)\}/.exec(last);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
/** True if the app's DevTools target for `nameFrag` exists at all (created), regardless of visibility. */
async function windowExists(nameFrag) {
  const all = await targets();
  return all.some((t) => t.url.includes(`/${nameFrag}/`) || t.url.includes(`${nameFrag}/index.html`));
}

// --- steps -----------------------------------------------------------------------------------

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.info(`[probe] ${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

/** Wait until the pet is a settled, non-transitional egg with a stable sprite position. */
async function waitStable() {
  let lastX = null, stable = 0, p = null;
  for (let i = 0; i < 60; i++) {
    p = await petProbe();
    const c = spriteCenter(p);
    if (p && c && !/drag|fall|hatch|celebrate/.test(p.state)) {
      if (lastX !== null && Math.abs(c.x - lastX) <= 1) stable++;
      else stable = 0;
      lastX = c.x;
      if (stable >= 3) return p;
    }
    await sleep(400);
  }
  return p;
}

async function main() {
  const p0 = await waitStable();
  const winId = petWindowId(p0?.geometry);
  writeFileSync(join(ART, 'probe-initial.json'), JSON.stringify({ probe: p0, winId }, null, 2));
  captureXEvidence('rest', winId);
  screenshot('00-rest.png');
  if (!p0?.spriteScreen) {
    record('setup', false, 'pet renderer never reported a stable sprite hitbox (window.__monsProbe null)');
    return finish();
  }
  record('setup', true, `state=${p0.state} sprite=${JSON.stringify(spriteCenter(p0))} window=${JSON.stringify(p0.geometry)} xid=${winId || 'n/a'}`);

  // Evidence (not a scored check): warp the X pointer and record whether xdotool actually moved it
  // (getmouselocation) and, for a cursor-polling build, whether the app tracked it. On the fixed
  // Linux build there are no `[pet] track` lines (cursor polling is gone by design, ADR 0020), so
  // appPolledCursor is null here — the six checks below prove input works via the shape model.
  {
    const target = { x: 500, y: 500 };
    input.move(target.x, target.y);
    await sleep(800);
    const diag = { backend: MODE === 'wayland-xwayland' ? 'vpointer' : 'xdotool', target,
      xServerPointer: getMouseLoc(), appPolledCursor: latestAppCursor() };
    if (MODE === 'wayland-xwayland') { try { diag.swaySeats = JSON.parse(swaymsg('-t', 'get_seats')); } catch { diag.swaySeats = null; } }
    writeFileSync(join(ART, 'cursor-diagnostic.json'), JSON.stringify(diag, null, 2));
  }

  // 1. hover -> hover card (kept on the sprite for >HOVER_DELAY_MS while polling for the card).
  {
    const off = logSize();
    let cardEver = false, aimed = null;
    const end = Date.now() + 3500;
    while (Date.now() < end) {
      const { c } = await aimAtSprite();
      if (c) aimed = c;
      if (await windowVisible('hovercard')) { cardEver = true; break; }
      await sleep(200);
    }
    captureXEvidence('hover', winId);
    screenshot('01-hover.png');
    const trackOver = logSince(off).includes('"over":true');
    const hoverLog = logSince(off).includes('[pet] hover true');
    record('hover', (trackOver || hoverLog) && cardEver,
      `trackOver=${trackOver} hoverLog=${hoverLog} hoverCardVisible=${cardEver} aimed=${JSON.stringify(aimed)}`);
  }

  // 2. left click -> pointer reaches renderer AND the panel window opens.
  {
    let clickReached = false;
    for (let attempt = 0; attempt < 4 && !clickReached; attempt++) {
      if (!(await appAlive())) break;
      const off = logSize();
      await aimAtSprite();
      input.click('left');
      clickReached = await waitForLog(off, '[pet] pointer down 0', 2);
    }
    await sleep(800);
    // Panel opens via onClick -> panel.toggle -> panel.show, which creates the panel window; its
    // DevTools target existing is a reliable "it opened" signal even when a headless WM reports a
    // shown-but-unfocused window's visibilityState inconsistently.
    const panelOpened = (await windowExists('panel')) || (await windowVisible('panel'));
    screenshot('02-click.png');
    record('left-click', clickReached && panelOpened, `pointerReachedRenderer=${clickReached} panelOpened=${panelOpened}`);
  }

  // 3. drag -> anchor moves. Retry the grab until the mousedown reaches the renderer.
  {
    const before = (await petProbe())?.pos?.x ?? null;
    let grabbed = false, start = null;
    for (let attempt = 0; attempt < 5 && !grabbed; attempt++) {
      start = (await aimAtSprite()).c;
      if (!start) break;
      const off = logSize();
      input.down('left');
      grabbed = await waitForLog(off, '[pet] pointer down 0', 1);
      if (!grabbed) { input.up('left'); await sleep(200); }
    }
    if (grabbed && start) {
      for (let i = 1; i <= 12; i++) { input.move(start.x + i * 18, start.y); await sleep(40); }
    }
    input.up('left');
    for (let i = 0; i < 25; i++) { const st = (await petProbe())?.state; if (st && !/drag|fall/.test(st)) break; await sleep(150); }
    const after = (await petProbe())?.pos?.x ?? null;
    screenshot('03-drag.png');
    const moved = before != null && after != null && Math.abs(after - before) >= 60;
    record('drag', moved, `grabReachedRenderer=${grabbed} anchorX ${before} -> ${after} start=${JSON.stringify(start)}`);
  }

  // 4. click-through: a click on a transparent part of the pet window reaches the window beneath.
  {
    const p = await petProbe();
    const g = p?.geometry;
    const xevId = xdotool('search', '--name', '^Event Tester$').split('\n').filter(Boolean)[0] || '';
    let detail = 'no xev/geometry', pass = false;
    if (g && xevId) {
      xdotool('windowmove', xevId, String(Math.max(0, g.x - 40)), String(Math.max(0, g.y - 60)));
      xdotool('windowsize', xevId, String(g.width + 80), String(g.height + 120));
      await sleep(400);
      const tx = g.x + 8, ty = g.y + 8; // transparent corner, far from the bottom-centre sprite
      const offLog = logSize();
      const xevBefore = fileTextSafe(XEV_LOG).length;
      input.move(tx, ty);
      input.click('left');
      await sleep(600);
      const xevGot = fileTextSafe(XEV_LOG).slice(xevBefore).includes('ButtonPress');
      const petGot = logSince(offLog).includes('[pet] pointer down');
      pass = xevGot && !petGot;
      detail = `xevReceivedClick=${xevGot} petSwallowed=${petGot} at (${tx},${ty}) window=${JSON.stringify(g)}`;
    }
    screenshot('04-clickthrough.png');
    record('click-through', pass, detail);
  }

  // 5. right click -> context menu / tray popup.
  {
    let reached = false;
    for (let attempt = 0; attempt < 5 && !reached; attempt++) {
      const off = logSize();
      await aimAtSprite();
      input.click('right');
      reached =
        (await waitForLog(off, '[pet] pointer contextmenu', 2)) ||
        logSince(off).includes('[pet] pointer down 2');
    }
    await sleep(400);
    screenshot('05-rightclick.png');
    record('right-click', reached, `contextEventReachedRenderer=${reached}`);
  }

  finish();
}

function finish() {
  writeFileSync(join(ART, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  let md = `\n## Linux e2e — ${MODE}\n\n**${passed}/${results.length} checks passed**\n\n`;
  md += `| Step | Result | Detail |\n|---|---|---|\n`;
  for (const r of results) md += `| ${r.name} | ${r.pass ? '✅ pass' : '❌ fail'} | ${r.detail.replace(/\|/g, '\\|')} |\n`;
  appendFileSync(SUMMARY, md);
  console.info(md);
  const allPass = results.length > 0 && results.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

// Guard: if the app has died, say so plainly instead of failing every step opaquely.
appAlive().then((alive) => {
  if (!alive) { record('app-alive', false, 'no DevTools page targets — app did not start or crashed'); return finish(); }
  return main();
}).catch((e) => { record('probe-error', false, String(e?.stack ?? e)); finish(); });
