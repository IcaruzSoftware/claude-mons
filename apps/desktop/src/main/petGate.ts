import type { Nation } from '@claude-mons/shared';

/**
 * Pure decision helpers for withholding the pet window and its stimuli until onboarding has
 * picked a nation. Kept dependency-free (no Electron) so they are unit-testable in isolation;
 * `PetHost` (`apps/desktop/src/main/PetHost.ts`) is the only caller.
 */

export interface PetRevealState {
  /** `null` until `App.chooseNation` (`apps/desktop/src/main/App.ts`) sets it. */
  nation: Nation | null;
  /** Has the `BrowserWindow` fired `ready-to-show` yet? */
  windowReady: boolean;
  /** The user's own show/hide-pet tray preference (independent of onboarding). */
  userVisible: boolean;
}

/** May the pet window be shown right now? All three conditions must hold. */
export function canRevealPet(state: PetRevealState): boolean {
  return state.nation !== null && state.windowReady && state.userVisible;
}

/** May a behavior stimulus (celebration, hatch, hook activity, …) be forwarded to the renderer? */
export function canStimulatePet(nation: Nation | null): boolean {
  return nation !== null;
}
