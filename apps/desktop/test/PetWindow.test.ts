import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    above = false;
    visible = false;
    destroyed = false;
    bounds: typeof display.bounds;
    webContents = { send: vi.fn() };
    constructor(options: typeof display.bounds) {
      super();
      this.bounds = options;
    }
    isDestroyed = () => this.destroyed;
    isVisible = () => this.visible;
    isAlwaysOnTop = () => this.above;
    setAlwaysOnTop = vi.fn((above: boolean) => {
      this.above = above;
    });
    moveTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setMenu = vi.fn();
    setShape = vi.fn();
    getBounds = () => this.bounds;
    setBounds = vi.fn((bounds: typeof display.bounds) => {
      this.bounds = bounds;
    });
    showInactive = vi.fn(() => {
      this.visible = true;
    });
  },
  screen: { getDisplayMatching: () => display },
}));

async function createPet(platform: NodeJS.Platform) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  vi.resetModules();
  const { PetWindow } = await import('../src/main/windows/PetWindow.ts');
  const pet = new PetWindow(
    display as Electron.Display,
    { x: 960, y: 1040 },
    {
      spriteScale: 2,
      focusable: platform !== 'linux',
    },
  );
  // Native state controls let the test emulate a WM clearing ABOVE or hiding the pet.
  const win = pet.win as unknown as EventEmitter & {
    above: boolean;
    visible: boolean;
    destroyed: boolean;
    setAlwaysOnTop: ReturnType<typeof vi.fn>;
    moveTop: ReturnType<typeof vi.fn>;
  };
  vi.clearAllMocks();
  return { pet, win };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pet topmost recovery', () => {
  it('does not restack an already topmost Linux pet on show, mode changes or the timer', async () => {
    const { pet, win } = await createPet('linux');
    pet.show();
    pet.enterMotion();
    pet.retargetMotion();
    pet.enterFollow({ x: 960, y: 1040 });
    pet.enterBattle({ x: 960, y: 1040 });
    pet.enterFollow({ x: 960, y: 1040 });
    vi.advanceTimersByTime(15000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it('restores Linux ABOVE after the WM removes it, then stops reasserting', async () => {
    const { pet, win } = await createPet('linux');
    pet.show();
    win.above = false;
    vi.advanceTimersByTime(15000);
    expect(win.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, 'screen-saver');
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it.each(['win32', 'darwin'] as const)(
    'keeps explicit topmost recovery on %s',
    async (platform) => {
      const { pet, win } = await createPet(platform);
      pet.show();
      pet.enterMotion();
      pet.enterFollow({ x: 960, y: 1040 });
      const immediateCalls = win.moveTop.mock.calls.length;
      expect(immediateCalls).toBe(3);
      vi.advanceTimersByTime(5000);
      const expectedCalls = immediateCalls + (platform === 'win32' ? 1 : 0);
      expect(win.moveTop).toHaveBeenCalledTimes(expectedCalls);
      expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(expectedCalls);
    },
  );

  it('does not recover hidden or destroyed pets and clears the timer on close', async () => {
    const { win } = await createPet('linux');
    win.above = false;
    vi.advanceTimersByTime(5000);
    win.visible = true;
    win.destroyed = true;
    vi.advanceTimersByTime(5000);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    win.emit('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
