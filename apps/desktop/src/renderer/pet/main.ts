import type { PetConfig } from '../../common/ipc.ts';
import { PetLoop } from './loop.ts';

const canvas = document.getElementById('pet') as HTMLCanvasElement;
let loop: PetLoop | null = null;

function bindPointer(): void {
  const send = (type: 'down' | 'up' | 'move' | 'contextmenu', e: PointerEvent | MouseEvent) =>
    window.mons.sendPointer({ type, button: e.button, x: e.clientX, y: e.clientY });

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
}

window.mons.onConfig((config: PetConfig) => {
  if (!loop) {
    loop = new PetLoop(canvas, config);
    loop.start();
  } else {
    loop.applyConfig(config);
  }
});

window.mons.onWindowMoved((g) => loop?.setGeometry(g));
window.mons.onStimulus((s) => loop?.push(s));
window.mons.onWorld((w) => loop?.push({ type: 'world:bounds', ...w }));
window.addEventListener('resize', () => loop?.resize());

bindPointer();
window.mons.ready();
