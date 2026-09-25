import type { PetConfig } from '../../common/ipc.ts';
import { PetLoop } from './loop.ts';

const canvas = document.getElementById('pet') as HTMLCanvasElement;
let loop: PetLoop | null = null;

function bindPointer(linux: boolean): void {
  const send = (
    type: 'down' | 'up' | 'move' | 'leave' | 'contextmenu',
    e: PointerEvent | MouseEvent,
  ) => window.mons.sendPointer({ type, button: e.button, x: e.clientX, y: e.clientY });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    send('down', e);
  });
  canvas.addEventListener('pointerup', (e) => {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    send('up', e);
  });
  canvas.addEventListener('pointercancel', (e) => send('up', e));
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    send('contextmenu', e);
  });
  // Safety: if the button was released outside our window we may never see pointerup.
  window.addEventListener('blur', () => {
    window.mons.sendPointer({ type: 'up', button: 0, x: 0, y: 0 });
  });

  // Linux drives hover and drag from real DOM pointer events, because screen.getCursorScreenPoint()
  // is unreliable under (X)Wayland (see ADR 0020). Pointer motion only reaches this window over the
  // input shape (the sprite) or while a drag holds pointer capture — exactly when the main process
  // needs it. Throttled to ~60 Hz to avoid flooding IPC.
  if (linux) {
    let lastMove = 0;
    canvas.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - lastMove < 16) return;
      lastMove = now;
      send('move', e);
    });
    canvas.addEventListener('pointerleave', (e) => send('leave', e));
    canvas.addEventListener('pointerout', (e) => send('leave', e));
  }
}

window.mons.onConfig((config: PetConfig) => {
  if (!loop) {
    loop = new PetLoop(canvas, config);
    loop.start();
    bindPointer(config.linux);
  } else {
    loop.applyConfig(config);
  }
  // Debug-only hook the Linux e2e harness reads over the DevTools Protocol to locate the sprite
  // and confirm the model reacted to real X input (see docs/runbooks/linux-e2e.md).
  if (config.debug) {
    (window as unknown as { __monsProbe?: () => unknown }).__monsProbe = () => loop?.probe();
  }
});

window.mons.onWindowMoved((g) => loop?.setGeometry(g));
window.mons.onStimulus((s) => loop?.push(s));
window.mons.onWorld((w) => loop?.push({ type: 'world:bounds', ...w }));
window.mons.onBattlePlay((b) => loop?.playBattle(b));
window.addEventListener('resize', () => loop?.resize());

window.mons.ready();
