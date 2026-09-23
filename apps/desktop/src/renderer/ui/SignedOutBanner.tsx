import { useState } from 'preact/hooks';
import type { UiSnapshot } from '../../common/ipc.ts';
import { accountCopy } from '../panel/accountCopy.ts';
import { AccountEmailCode } from './AccountEmailCode.tsx';

/**
 * Shown at the top of the panel when `UiSnapshot.account.signedOut` is true: a known account lost
 * its Supabase session (`docs/architecture/flows/account-linking.md#signed-out`). Sync is stopped
 * server-side; the player recovers by signing in again (linked accounts, prompted with the linked
 * email) or explicitly starting fresh (which does what used to happen silently on a lost session).
 */
export function SignedOutBanner({ s }: { s: UiSnapshot }) {
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [starting, setStarting] = useState(false);
  const nick = s.profile.nickname ?? 'your mon';
  const email = s.account.email;

  const startFresh = async () => {
    setStarting(true);
    await window.monsUi.account.startFresh();
    setStarting(false);
  };

  return (
    <div class="signed-out-banner">
      <div class="signed-out-msg">{accountCopy.signedOut.message(nick)}</div>
      {email ? (
        <AccountEmailCode
          defaultEmail={email}
          sendCta={accountCopy.link.sendCta}
          verifyCta={accountCopy.link.verifyCta}
          resendCta={accountCopy.link.resendCta}
          codePlaceholder={accountCopy.link.codePlaceholder}
          onRequestCode={(e) => window.monsUi.account.signinStart(e)}
          onVerify={(e, code) => window.monsUi.account.signinVerify(e, code)}
          signinHint={accountCopy.signinFallbackHint}
        />
      ) : (
        <div class="hint">{accountCopy.signedOut.notLinkedHint}</div>
      )}
      {!confirmFresh ? (
        <div class="signed-out-actions">
          <button disabled={starting} onClick={() => setConfirmFresh(true)}>
            {accountCopy.signedOut.startFreshCta}
          </button>
        </div>
      ) : (
        <div class="signed-out-confirm">
          <div class="hint">{accountCopy.signedOut.startFreshConfirm(nick)}</div>
          <div class="signed-out-actions">
            <button disabled={starting} onClick={() => setConfirmFresh(false)}>
              {accountCopy.signedOut.cancelCta}
            </button>
            <button class="primary" disabled={starting} onClick={() => void startFresh()}>
              {starting ? '…' : accountCopy.signedOut.startFreshConfirmCta}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
