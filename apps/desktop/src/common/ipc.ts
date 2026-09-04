/**
 * IPC contract between the Electron main process and the renderer windows.
 * Channel names and payload types live here and nowhere else.
 */

export const IPC = {
  /** renderer(pet) -> main: the pet renderer finished booting. */
  petReady: 'pet:ready',
  /** main -> renderer(pet): static configuration for the pet window. */
  petConfig: 'pet:config',
} as const;

export interface PetConfig {
  /** Integer pixel scale for the sprite (2, 3 or 4). */
  spriteScale: number;
  /** App version, for display. */
  version: string;
}
