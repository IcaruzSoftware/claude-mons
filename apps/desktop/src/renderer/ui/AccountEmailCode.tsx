import { useState } from 'preact/hooks';
import type { AccountOpResult } from '../../common/ipc.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  onRequestCode,
  onVerify,
}: {
  sendCta: string;
  verifyCta: string;
  resendCta: string;
  codePlaceholder?: string;
  autoFocus?: boolean;
  onRequestCode: (email: string) => Promise<AccountOpResult>;
  onVerify: (email: string, code: string) => Promise<AccountOpResult>;
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      )}
      {msg && <div class="hint">{msg}</div>}
    </div>
  );
}
