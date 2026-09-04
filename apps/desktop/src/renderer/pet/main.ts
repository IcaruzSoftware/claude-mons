import { HATCH_XP, levelProgress } from '@claude-mons/shared';

// Phase 0 smoke renderer: draws a placeholder egg on the canvas and proves that
// preload IPC and the shared package both work from the renderer.

const canvas = document.getElementById('pet') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLDivElement;
const ctx = canvas.getContext('2d');

function drawEgg(scale: number): void {
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // 12x14 placeholder egg drawn as pixel rows; '.' = transparent
  const rows = [
    '....xxxx....',
    '..xxwwwwxx..',
    '.xwwwwwwwwx.',
    '.xwwwwwwwwx.',
    'xwwwwwwwwwwx',
    'xwwwwwwwwwwx',
    'xwwwwwwwwwwx',
    'xwwwwwwwwwwx',
    'xwwwwwwwwwwx',
    '.xwwwwwwwwx.',
    '.xwwwwwwwwx.',
    '..xxwwwwxx..',
    '....xxxx....',
  ];
  const px = scale;
  const w = rows[0]!.length * px;
  const h = rows.length * px;
  const ox = Math.floor((window.innerWidth - w) / 2);
  const oy = Math.floor((window.innerHeight - h) / 2);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '.') continue;
      ctx.fillStyle = c === 'x' ? '#4a4a4a' : '#e9e4d6';
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }
}

window.mons.onConfig((config) => {
  drawEgg(config.spriteScale);
  const p = levelProgress(0);
  status.textContent = `claude-mons v${config.version} · egg · ${p.xpIntoLevel}/${HATCH_XP} XP`;
  window.addEventListener('resize', () => drawEgg(config.spriteScale));
});

window.mons.ready();
