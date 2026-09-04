import type { PetApi } from './pet.ts';

declare global {
  interface Window {
    mons: PetApi;
  }
}

export {};
