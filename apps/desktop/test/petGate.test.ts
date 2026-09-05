import { describe, expect, it } from 'vitest';
import { canRevealPet, canStimulatePet } from '../src/main/petGate.ts';

describe('canRevealPet', () => {
  it('refuses to reveal before a nation is chosen, even once the window is ready', () => {
    expect(canRevealPet({ nation: null, windowReady: true, userVisible: true })).toBe(false);
  });

  it('refuses to reveal before the window has fired ready-to-show', () => {
    expect(canRevealPet({ nation: 'fire', windowReady: false, userVisible: true })).toBe(false);
  });

  it('refuses to reveal while the user has hidden the pet', () => {
    expect(canRevealPet({ nation: 'fire', windowReady: true, userVisible: false })).toBe(false);
  });

  it('reveals once a nation is chosen, the window is ready, and the user has not hidden it', () => {
    expect(canRevealPet({ nation: 'water', windowReady: true, userVisible: true })).toBe(true);
  });
});

describe('canStimulatePet', () => {
  it('ignores stimuli while no nation is chosen', () => {
    expect(canStimulatePet(null)).toBe(false);
  });

  it('forwards stimuli once a nation is set', () => {
    expect(canStimulatePet('earth')).toBe(true);
    expect(canStimulatePet('air')).toBe(true);
  });
});
