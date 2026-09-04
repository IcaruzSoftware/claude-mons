import type { PetApi, UiApi } from './index.ts';

declare global {
  interface Window {
    mons: PetApi;
    monsUi: UiApi;
  }
}

export {};
