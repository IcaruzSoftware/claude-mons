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
    /**
     * Fallback for the free-tier default mailer, which sends only a confirmation link, not the
     * code (`docs/runbooks/auth-email-config.md`). Shown next to the code field so linking still
     * completes without custom SMTP.
     */
    fallbackHint:
      'No code in the mail? Click the confirmation link inside it, then press "I clicked the link".',
    fallbackCta: 'I clicked the link',
    fallbackChecking: 'Checking…',
    fallbackNotYet: 'Not confirmed yet — check the inbox, then try again.',
    linkedPrefix: 'Linked to ',
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
  /**
   * Shown next to the code field for both sign-in entry points (Settings' "sign in instead" and
   * Onboarding's "Already have a mon? Sign in"): unlike linking, signing in has no confirmation-link
   * fallback — `verifySignInCode` only ever accepts the typed code — so the free-tier default
   * mailer's missing code blocks this path until custom SMTP is configured
   * (`docs/runbooks/auth-email-config.md`).
   */
  signinFallbackHint:
    'Signing in on a new device needs the 6-digit code by mail. With the default mailer that code is not delivered yet — ask the project owner to configure custom SMTP.',
};
