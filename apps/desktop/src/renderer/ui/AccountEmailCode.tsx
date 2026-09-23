import { useEffect, useRef, useState } from 'preact/hooks';
import type { AccountOpResult } from '../../common/ipc.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `account:link-refresh` poll cadence and cutoff while the code step is visible (`linkFallback`). */
const LINK_POLL_INTERVAL_MS = 5000;
const LINK_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Confirmation-link fallback, wired up only for the account-*linking* flow (Settings' "link an
 * email" widget): the free-tier default mailer's "confirm email change" mail carries only a link,
 * not a code (`docs/runbooks/auth-email-config.md`). When passed, the code step shows a hint and an
 * "I clicked the link" button calling `onRefresh` (`account:link-refresh`), and the widget also
 * auto-polls the same call every `LINK_POLL_INTERVAL_MS` for up to `LINK_POLL_TIMEOUT_MS` so linking
 * completes itself once the player clicks the link, without pressing anything. Not used for the
 * sign-in-on-a-new-device flow — `verifySignInCode` only ever accepts the typed code, so there is no
 * link to fall back to there; pass `signinHint` for that case instead.
 */
export interface LinkFallback {
  hint: string;
  buttonCta: string;
  checkingCta: string;
  notYetMsg: string;
  linkedPrefix: string;
  onRefresh: () => Promise<AccountOpResult>;
}

/**
 * Shared email -> 6-digit-code widget for account linking (`docs/architecture/flows/account-linking.md`):
 * used by both the Settings "Account" section (link an email, or sign in to switch accounts) and
 * Onboarding's "Already have a mon? Sign in" sub-step. Purely presentational: the caller decides
 * what `onRequestCode`/`onVerify` actually do and what happens after a successful verify (the
 * caller's own `UiSnapshot` update is what changes the view, e.g. leaving Onboarding or showing the
 * linked email in Settings).
 */
export function AccountEmailCode({
  sendCta,
  verifyCta,
  resendCta,
  codePlaceholder = '6-digit code',
  autoFocus = false,
  defaultEmail = '',
  onRequestCode,
  onVerify,
  linkFallback,
  signinHint,
}: {
  sendCta: string;
  verifyCta: string;
  resendCta: string;
  codePlaceholder?: string;
  autoFocus?: boolean;
  /** Pre-fills the email field (signed-out re-sign-in prompts for the linked email). */
  defaultEmail?: string;
  onRequestCode: (email: string) => Promise<AccountOpResult>;
  onVerify: (email: string, code: string) => Promise<AccountOpResult>;
  linkFallback?: LinkFallback;
  signinHint?: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkingLink, setCheckingLink] = useState(false);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);

  // `linkFallback` is a fresh object literal from the caller on every render; a ref lets the poll
  // effect below read the latest `onRefresh`/copy without re-running (and so resetting its timer)
  // on every unrelated re-render, e.g. the panel's once-a-second snapshot push while it's visible.
  const fallbackRef = useRef(linkFallback);
  fallbackRef.current = linkFallback;
  const linkedRef = useRef(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const codeValid = /^\d{6}$/.test(code.trim());

  const send = async () => {
    if (!emailValid || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await onRequestCode(email.trim());
    setBusy(false);
    if (r.ok) {
      setStep('code');
      setMsg('Code sent — check your email.');
    } else {
      setMsg(r.error);
    }
  };

  const verify = async () => {
    if (!codeValid || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await onVerify(email.trim(), code.trim());
    setBusy(false);
    if (!r.ok) setMsg(r.error);
    // on success the caller's own snapshot update takes over the view; nothing else to do here.
  };

  /** Checks `account:link-refresh` once; records and reports a just-confirmed email. */
  const checkLink = async (): Promise<boolean> => {
    if (linkedRef.current) return true;
    const fb = fallbackRef.current;
    if (!fb) return false;
    const r = await fb.onRefresh();
    if (r.account && !r.account.anonymous && r.account.email) {
      linkedRef.current = true;
      setLinkedEmail(r.account.email);
      return true;
    }
    return false;
  };

  const clickedLink = async () => {
    const fb = fallbackRef.current;
    if (!fb || checkingLink) return;
    setCheckingLink(true);
    setMsg(null);
    const ok = await checkLink();
    setCheckingLink(false);
    if (!ok) setMsg(fb.notYetMsg);
  };

  // Auto-poll while the code field is visible, so linking completes itself after a link click even
  // if the player never presses "I clicked the link". Stops on success (`checkLink` resolving true),
  // after `LINK_POLL_TIMEOUT_MS`, or when the code step closes / this widget unmounts.
  useEffect(() => {
    if (step !== 'code' || !fallbackRef.current) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > LINK_POLL_TIMEOUT_MS) {
        clearInterval(id);
        return;
      }
      void checkLink().then((ok) => {
        if (ok) clearInterval(id);
      });
    }, LINK_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [step]);

  if (linkedEmail) {
    return (
      <div class="account-flow hint">
        {linkFallback?.linkedPrefix ?? ''}
        {linkedEmail}
      </div>
    );
  }

  return (
    <div class="account-flow">
      {step === 'email' ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            class="nick"
            type="email"
            autoFocus={autoFocus}
            placeholder="you@example.com"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
          />
          <button class="primary" disabled={!emailValid || busy} onClick={() => void send()}>
            {busy ? 'Sending…' : sendCta}
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              class="nick"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              placeholder={codePlaceholder}
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void verify();
              }}
            />
            <button class="primary" disabled={!codeValid || busy} onClick={() => void verify()}>
              {busy ? 'Verifying…' : verifyCta}
            </button>
            <button disabled={busy} onClick={() => void send()}>
              {resendCta}
            </button>
          </div>
          {linkFallback && (
            <div class="hint">
              {linkFallback.hint}{' '}
              <button disabled={checkingLink} onClick={() => void clickedLink()}>
                {checkingLink ? linkFallback.checkingCta : linkFallback.buttonCta}
              </button>
            </div>
          )}
          {signinHint && <div class="hint">{signinHint}</div>}
        </>
      )}
      {msg && <div class="hint">{msg}</div>}
    </div>
  );
}
