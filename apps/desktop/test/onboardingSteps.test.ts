import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_FIRST_STEP,
  ONBOARDING_LAST_STEP,
  ONBOARDING_STEP_COUNT,
  canGoBack,
  canGoNext,
  clampOnboardingStep,
  nextOnboardingStep,
  prevOnboardingStep,
  type OnboardingStep,
} from '../src/renderer/panel/onboardingSteps.ts';

describe('onboardingSteps', () => {
  it('has five steps, 0-indexed', () => {
    expect(ONBOARDING_STEP_COUNT).toBe(5);
    expect(ONBOARDING_FIRST_STEP).toBe(0);
    expect(ONBOARDING_LAST_STEP).toBe(4);
  });

  it('advances one step at a time and clamps at the last step', () => {
    let step: OnboardingStep = 0;
    step = nextOnboardingStep(step);
    expect(step).toBe(1);
    step = nextOnboardingStep(nextOnboardingStep(step));
    expect(step).toBe(3);
    step = nextOnboardingStep(step);
    expect(step).toBe(4);
    expect(nextOnboardingStep(step)).toBe(4); // clamped, no sixth step
  });

  it('retreats one step at a time and clamps at the first step', () => {
    let step: OnboardingStep = 4;
    step = prevOnboardingStep(step);
    expect(step).toBe(3);
    step = prevOnboardingStep(prevOnboardingStep(step));
    expect(step).toBe(1);
    step = prevOnboardingStep(step);
    expect(step).toBe(0);
    expect(prevOnboardingStep(step)).toBe(0);
  });

  it('reports Back/Next availability at the edges', () => {
    expect(canGoBack(0)).toBe(false);
    expect(canGoBack(1)).toBe(true);
    expect(canGoNext(4)).toBe(false);
    expect(canGoNext(3)).toBe(true);
  });

  it('clamps an arbitrary step number into range (e.g. a dev flag)', () => {
    expect(clampOnboardingStep(-3)).toBe(0);
    expect(clampOnboardingStep(0)).toBe(0);
    expect(clampOnboardingStep(3)).toBe(3);
    expect(clampOnboardingStep(4)).toBe(4);
    expect(clampOnboardingStep(99)).toBe(4);
  });
});
