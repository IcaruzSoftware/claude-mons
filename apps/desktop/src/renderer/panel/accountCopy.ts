/**
 * Copy for account linking UI (Settings' Account section, Onboarding's "Already have a mon?"
 * sub-step). Kept separate from `onboardingCopy` (`apps/desktop/src/renderer/panel/views/Onboarding.tsx`)
 * since this copy is shared by both `Settings.tsx` and `Onboarding.tsx`.
 */
export const accountCopy = {
  link: {
    title: 'Use this mon on another computer',
    hint: 'Link an email to your account — no password, just a 6-digit code by mail.',
    sendCta: 'Send code',
    verifyCta: 'Verify',
    resendCta: 'Send a new code',
    codePlaceholder: '6-digit code',
  },
  linked: {
    signOutCta: 'Sign out on this device',
    signOutConfirm:
      'Sign out and return to a fresh anonymous mon on this device? Your linked mon stays on the server; only this device forgets it.',
    signOutCancel: 'Cancel',
  },
  switchAccount: {
    link: 'Already using claude-mons elsewhere? Sign in instead',
    warning:
      "This replaces the mon on this device with the one linked to that email. This device's current mon is not deleted — it stays on the server, orphaned — but nothing on this device will show it again.",
    confirmCta: "Replace this device's mon",
    cancelCta: 'Cancel',
  },
  onboardingSignin: {
    link: 'Already have a mon? Sign in',
    title: 'Sign in to your mon',
    lead: 'Enter the email you linked from another device — this skips choosing a nation.',
    back: 'Back',
  },
};
