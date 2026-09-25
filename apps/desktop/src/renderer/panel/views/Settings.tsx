import { useState } from 'preact/hooks';
import { NATION_INFO, validateNickname } from '@claude-mons/shared';
import type { UiSnapshot, UpdateStatusValue } from '../../../common/ipc.ts';
import { AccountEmailCode } from '../../ui/AccountEmailCode.tsx';
import {
  HOOK_STATUS_LABEL,
  hookStatusDotClass,
  hookStatusLabel,
  isHookConnected,
} from '../../ui/hookStatus.ts';
import { PixelPanel } from '../../ui/PixelPanel.tsx';
import { accountCopy } from '../accountCopy.ts';

function updateLabel(u: UpdateStatusValue): string {
  switch (u.kind) {
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking…';
    case 'available':
      return `Version ${u.version} is downloading.`;
    case 'downloaded':
      return `Version ${u.version} is ready to install.`;
    case 'up-to-date':
      return 'You are on the latest version.';
    case 'unsupported':
      return `Automatic updates unavailable (${u.reason}).`;
    case 'error':
      return `Update check failed: ${u.message}`;
  }
}

/** Pixel toggle switch (docs/design/ui-style.md Chrome: the knob is one of the few circular shapes
 * used by default). Purely presentational -- the caller owns the on/off state. */
function PixelToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      class={`toggle-pixel${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={onToggle}
    >
      <i />
    </button>
  );
}

/** Link an email (anonymous account), sign in on a different account, or sign out (linked). */
function AccountSection({ s }: { s: UiSnapshot }) {
  const [switching, setSwitching] = useState(false);
  const [confirmedSwitch, setConfirmedSwitch] = useState(false);
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!s.online.configured) return null;

  if (!s.account.anonymous) {
    return (
      <div class="section">
        <h3>Account</h3>
        <PixelPanel>
          <div class="kv-pixel">
            <span>Email</span>
            <span>{s.account.email}</span>
          </div>
          {signOutConfirm ? (
            <div class="set-row" style={{ marginTop: 8 }}>
              <div class="hint">{accountCopy.linked.signOutConfirm}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={signingOut} onClick={() => setSignOutConfirm(false)}>
                  {accountCopy.switchAccount.cancelCta}
                </button>
                <button
                  class="primary"
                  disabled={signingOut}
                  onClick={async () => {
                    setSigningOut(true);
                    await window.monsUi.account.signout();
                    setSigningOut(false);
                  }}
                >
                  {signingOut ? 'Signing out…' : accountCopy.linked.signOutCta}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setSignOutConfirm(true)}>
                {accountCopy.linked.signOutCta}
              </button>
            </div>
          )}
        </PixelPanel>
      </div>
    );
  }

  return (
    <div class="section">
      <h3>Account</h3>
      <PixelPanel>
        <div class="set-row">
          <div>
            <span class="label">{accountCopy.link.title}</span>
            <div class="hint">{accountCopy.link.hint}</div>
          </div>
        </div>
        <AccountEmailCode
          sendCta={accountCopy.link.sendCta}
          verifyCta={accountCopy.link.verifyCta}
          resendCta={accountCopy.link.resendCta}
          codePlaceholder={accountCopy.link.codePlaceholder}
          onRequestCode={(email) => window.monsUi.account.linkStart(email)}
          onVerify={(email, code) => window.monsUi.account.linkVerify(email, code)}
          linkFallback={{
            hint: accountCopy.link.fallbackHint,
            buttonCta: accountCopy.link.fallbackCta,
            checkingCta: accountCopy.link.fallbackChecking,
            notYetMsg: accountCopy.link.fallbackNotYet,
            linkedPrefix: accountCopy.link.linkedPrefix,
            onRefresh: () => window.monsUi.account.linkRefresh(),
          }}
        />
        {!switching ? (
          <div style={{ marginTop: 8 }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setSwitching(true);
              }}
            >
              {accountCopy.switchAccount.link}
            </a>
          </div>
        ) : !confirmedSwitch ? (
          <div class="set-row" style={{ marginTop: 8 }}>
            <div class="hint">{accountCopy.switchAccount.warning}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setSwitching(false)}>
                {accountCopy.switchAccount.cancelCta}
              </button>
              <button class="primary" onClick={() => setConfirmedSwitch(true)}>
                {accountCopy.switchAccount.confirmCta}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <AccountEmailCode
              sendCta={accountCopy.link.sendCta}
              verifyCta={accountCopy.link.verifyCta}
              resendCta={accountCopy.link.resendCta}
              codePlaceholder={accountCopy.link.codePlaceholder}
              onRequestCode={(email) => window.monsUi.account.signinStart(email)}
              onVerify={(email, code) => window.monsUi.account.signinVerify(email, code)}
              signinHint={accountCopy.signinFallbackHint}
            />
          </div>
        )}
      </PixelPanel>
    </div>
  );
}

export function SettingsView({ s }: { s: UiSnapshot }) {
  const [nick, setNick] = useState('');
  const [nickMsg, setNickMsg] = useState<string | null>(null);
  const saveNick = async () => {
    const v = validateNickname(nick.trim());
    if (!v.ok) {
      setNickMsg(
        v.reason === 'format'
          ? '3-16 letters, digits or underscores'
          : v.reason === 'reserved'
            ? 'That name is reserved'
            : 'That name is not allowed',
      );
      return;
    }
    setNickMsg('Saving…');
    const r = await window.monsUi.setNickname(nick.trim());
    setNickMsg(r.ok ? 'Saved' : (r.error ?? 'Failed'));
    if (r.ok) setNick('');
  };
  const hooks = s.hooks.status;
  const connected = isHookConnected(hooks);
  const dot = hookStatusDotClass(hooks);
  const modeHint =
    (s.hooks.effectiveMode === 'script'
      ? 'Script mode uses curl to reach the app directly; there is no offline spool, so events sent while the app is closed are lost.'
      : 'Binary mode uses the bundled hook program and spools events while the app is closed.') +
    ' Applies to both Claude Code and Codex.';
  const codex = s.hooks.codex;
  const codexConnected = codex.detected && isHookConnected(codex.status);
  const codexDot = codex.detected ? hookStatusDotClass(codex.status) : '';
  const codexDisabled = !codex.detected || codex.status === 'unreadable' || codex.status === 'no-binary';

  return (
    <div>
      <div class="section">
        <h3>Claude Code</h3>
        <PixelPanel>
          <div class="set-row">
            <div>
              <span class={`status-dot ${dot}`} />
              <span class="label">{HOOK_STATUS_LABEL[hooks]}</span>
              <div class="hint">
                Adds hooks to ~/.claude/settings.json. Only event metadata reaches the app; prompts
                and file contents stay on your machine. Start a new Claude Code session after
                connecting.
              </div>
            </div>
            <button
              class={connected ? '' : 'primary'}
              disabled={hooks === 'unreadable' || hooks === 'no-binary'}
              onClick={() => void window.monsUi.toggleHooks()}
            >
              {connected ? 'Disconnect' : hooks === 'partial' ? 'Repair' : 'Connect'}
            </button>
          </div>
          <div class="set-row">
            <div>
              <span class="label">Hook mode</span>
              <div class="hint">{modeHint}</div>
            </div>
            <select
              value={s.hooks.mode}
              onChange={(e) =>
                void window.monsUi.setHookMode(
                  (e.target as HTMLSelectElement).value as 'auto' | 'binary' | 'script',
                )
              }
            >
              <option value="auto">
                Auto ({s.hooks.probe === 'ok' ? 'binary' : s.hooks.probe === null ? '…' : 'script'})
              </option>
              <option value="binary">Binary</option>
              <option value="script">Script (curl)</option>
            </select>
          </div>
        </PixelPanel>
      </div>

      <div class="section">
        <h3>Codex</h3>
        <PixelPanel>
          <div class="set-row">
            <div>
              <span class={`status-dot ${codexDot}`} />
              <span class="label">
                {codex.detected ? hookStatusLabel(codex.status, 'codex') : 'Codex not found'}
              </span>
              <div class="hint">
                Adds hooks to ~/.codex/hooks.json and turns on <code>[features] hooks</code> in
                config.toml. Then run <code>/hooks</code> in Codex once to trust them, and start a
                new session.
              </div>
              {codex.feature === 'unsupported' && (
                <div class="hint">
                  Set <code>hooks = true</code> under <code>[features]</code> in config.toml
                  yourself.
                </div>
              )}
              {codex.needsTrust && (
                <div class="hint">
                  <span class="status-dot warn" /> Codex hooks changed. Run <code>/hooks</code> in
                  Codex to trust them again, then start a new session.{' '}
                  <button onClick={() => void window.monsUi.ackCodexTrust()}>Done</button>
                </div>
              )}
            </div>
            <button
              class={codexConnected ? '' : 'primary'}
              disabled={codexDisabled}
              onClick={() => void window.monsUi.toggleHooks('codex')}
            >
              {codexConnected ? 'Disconnect' : codex.status === 'partial' ? 'Repair' : 'Connect'}
            </button>
          </div>
        </PixelPanel>
      </div>

      <div class="section">
        <h3>Appearance</h3>
        <PixelPanel>
          <div class="set-row">
            <div>
              <span class="label">Sprite size</span>
              <div class="hint">Pixel scale of the pet on screen.</div>
            </div>
            <span class="seg-pixel">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  class={s.settings.spriteScale === n ? 'active' : ''}
                  onClick={() => void window.monsUi.setSpriteScale(n)}
                >
                  {n}x
                </button>
              ))}
            </span>
          </div>
        </PixelPanel>
      </div>

      <div class="section">
        <h3>Water reminder</h3>
        <PixelPanel>
          <div class="set-row">
            <div>
              <span class="label">Remind me to drink water</span>
              <div class="hint">
                Shows a small card next to the pet every so often, skipped while it's asleep or
                battling. Today: {s.water.todayCount} {s.water.todayCount === 1 ? 'sip' : 'sips'}.
              </div>
            </div>
            <PixelToggle
              on={s.water.enabled}
              onToggle={() => void window.monsUi.setWaterEnabled(!s.water.enabled)}
            />
          </div>
          <div class="set-row">
            <span class="label">Remind every</span>
            <select
              value={s.water.intervalMin}
              disabled={!s.water.enabled}
              onChange={(e) =>
                void window.monsUi.setWaterInterval(Number((e.target as HTMLSelectElement).value))
              }
            >
              {[30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
        </PixelPanel>
      </div>

      <div class="section">
        <h3>System</h3>
        <PixelPanel>
          <div class="set-row">
            <div>
              <span class="label">Start on login</span>
              <div class="hint">Launch claude-mons when you sign in to your computer.</div>
            </div>
            <PixelToggle
              on={s.settings.autostart}
              onToggle={() => void window.monsUi.setAutostart(!s.settings.autostart)}
            />
          </div>
          <div class="set-row">
            <div>
              <span class="label">Updates</span>
              <div class="hint">{updateLabel(s.update)}</div>
            </div>
            {s.update.kind === 'downloaded' ? (
              <button class="primary" onClick={() => void window.monsUi.installUpdate()}>
                Restart to update
              </button>
            ) : (
              <button
                disabled={s.update.kind === 'checking' || s.update.kind === 'unsupported'}
                onClick={() => void window.monsUi.checkUpdates()}
              >
                Check now
              </button>
            )}
          </div>
        </PixelPanel>
      </div>

      <div class="section">
        <h3>Profile</h3>
        <PixelPanel>
          <div class="kv-pixel">
            <span>Nation</span>
            <span>{s.profile.nation ? NATION_INFO[s.profile.nation].name : '–'}</span>
            <span>Nickname</span>
            <span>
              {s.profile.nickname ??
                (s.online.configured ? 'assigned when online' : 'offline build')}
            </span>
            <span>Server</span>
            <span>
              {!s.online.configured
                ? 'offline build'
                : s.online.connected
                  ? `synced ${s.online.lastSyncAt ? new Date(s.online.lastSyncAt).toLocaleTimeString() : ''}`
                  : (s.online.lastError ?? 'not connected yet')}
            </span>
          </div>
          {s.online.configured && (
            <div class="set-row" style={{ marginTop: 8 }}>
              <div>
                <span class="label">Change nickname</span>
                <div class="hint">
                  Once every 7 days. Shown on the leaderboard and to opponents.
                </div>
                {nickMsg && <div class="hint">{nickMsg}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  class="nick"
                  value={nick}
                  placeholder={s.profile.nickname ?? 'new nickname'}
                  onInput={(e) => setNick((e.target as HTMLInputElement).value)}
                  maxLength={16}
                />
                <button onClick={() => void saveNick()} disabled={nick.trim().length < 3}>
                  Save
                </button>
                <button onClick={() => void window.monsUi.syncNow()}>Sync</button>
              </div>
            </div>
          )}
        </PixelPanel>
      </div>

      <AccountSection s={s} />

      <div class="section">
        <h3>About</h3>
        <PixelPanel>
          <div class="kv-pixel">
            <span>Version</span>
            <span>{s.version}</span>
            <span>Source</span>
            <span>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void window.monsUi.openExternal('https://github.com/IcaruzSoftware/claude-mons');
                }}
              >
                github.com/IcaruzSoftware/claude-mons
              </a>
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => void window.monsUi.quit()}>Quit claude-mons</button>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
