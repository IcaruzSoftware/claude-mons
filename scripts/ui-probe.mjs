/**
 * ui-probe — drive a running claude-mons renderer over the Chrome DevTools Protocol.
 *
 * Start the app with a remote debugging port and a throwaway profile first; see
 * docs/runbooks/verify-a-ui-change.md. Node >= 22 only (global fetch and WebSocket), no deps.
 *
 *   node scripts/ui-probe.mjs targets
 *   node scripts/ui-probe.mjs eval  <window> "<javascript expression>"
 *   node scripts/ui-probe.mjs click <window> "<css selector>"
 *   node scripts/ui-probe.mjs text  <window> "<css selector>"
 *
 * <window> is a substring of the renderer URL: panel, pet, hovercard or reminder.
 */

const PORT = process.env.CLAUDE_MONS_DEBUG_PORT ?? '9333';
const [cmd, windowName, arg] = process.argv.slice(2);

const usage = () => {
  console.error(
    'usage: node scripts/ui-probe.mjs targets | (eval|click|text) <panel|pet|hovercard|reminder> <arg>',
  );
  process.exit(2);
};

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`).catch(() => null);
  if (!res) {
    console.error(
      `no DevTools endpoint on 127.0.0.1:${PORT}. Start the app with --remote-debugging-port=${PORT}.`,
    );
    process.exit(1);
  }
  return (await res.json()).filter((t) => t.type === 'page');
}

async function pick(name) {
  const all = await targets();
  const hit = all.find((t) => t.url.includes(`/${name}/`) || t.url.includes(`${name}/index.html`));
  if (!hit) {
    console.error(
      `no "${name}" window is open. Open targets: ${all.map((t) => t.url).join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  return hit;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)));
  });
}

let nextId = 1;
function send(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
}

/**
 * Resolves a CSS selector, or `text=LABEL` for the first button-like element with that label —
 * labels survive a redesign that renames every class, so prefer them in runbook steps.
 */
const resolver = (selector) =>
  selector.startsWith('text=')
    ? `[...document.querySelectorAll('button, a, [role=button], summary')].find(
         (e) => e.innerText.trim().toLowerCase() === ${JSON.stringify(
           selector.slice(5).trim().toLowerCase(),
         )})`
    : `document.querySelector(${JSON.stringify(selector)})`;

/** Waits up to 2 s for the element to appear: a view rendered after an IPC snapshot is not instant. */
async function waitForBox(ws, selector) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const box = await evaluate(
      ws,
      `(() => { const el = ${resolver(selector)};
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                 visible: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 }; })()`,
    );
    if (box) return box;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Dispatches real mouse events at the element's center: Preact handlers only fire for those. */
async function click(ws, selector) {
  const box = await waitForBox(ws, selector);
  if (!box) throw new Error(`no element matches ${selector} (waited 2 s)`);
  if (!box.visible) throw new Error(`${selector} is present but not on screen (${JSON.stringify(box)})`);
  const base = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  await new Promise((r) => setTimeout(r, 150));
  return box;
}

if (cmd === 'targets') {
  for (const t of await targets()) console.info(t.url);
  process.exit(0);
}
if (!['eval', 'click', 'text'].includes(cmd) || !windowName || !arg) usage();

const target = await pick(windowName);
const ws = await connect(target.webSocketDebuggerUrl);
try {
  if (cmd === 'eval') console.info(JSON.stringify(await evaluate(ws, arg), null, 2));
  if (cmd === 'click') console.info(`clicked ${arg} at ${JSON.stringify(await click(ws, arg))}`);
  if (cmd === 'text') {
    await waitForBox(ws, arg);
    console.info(await evaluate(ws, `(${resolver(arg)})?.innerText ?? '(no match)'`));
  }
} finally {
  ws.close();
}
