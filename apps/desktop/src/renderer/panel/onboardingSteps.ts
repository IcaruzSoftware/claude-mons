/**
 * Pure step arithmetic for the onboarding wizard (`apps/desktop/src/renderer/panel/views/Onboarding.tsx`).
 * Kept dependency-free so it is unit-testable without Preact/Electron.
 */

export const ONBOARDING_STEP_COUNT = 5;
export type OnboardingStep = 0 | 1 | 2 | 3 | 4;

export const ONBOARDING_FIRST_STEP: OnboardingStep = 0;
export const ONBOARDING_LAST_STEP: OnboardingStep = (ONBOARDING_STEP_COUNT - 1) as OnboardingStep;

/** Clamps to the last step; there is no step past "choose your nation". */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  return Math.min(step + 1, ONBOARDING_LAST_STEP) as OnboardingStep;
}

/** Clamps to the first step. */
export function prevOnboardingStep(step: OnboardingStep): OnboardingStep {
  return Math.max(step - 1, ONBOARDING_FIRST_STEP) as OnboardingStep;
}

export function canGoBack(step: OnboardingStep): boolean {
  return step > ONBOARDING_FIRST_STEP;
}

export function canGoNext(step: OnboardingStep): boolean {
  return step < ONBOARDING_LAST_STEP;
}

/** Clamps an arbitrary number (e.g. a dev flag) to a valid step. */
export function clampOnboardingStep(step: number): OnboardingStep {
  return Math.min(
    Math.max(Math.trunc(step), ONBOARDING_FIRST_STEP),
    ONBOARDING_LAST_STEP,
  ) as OnboardingStep;
}
