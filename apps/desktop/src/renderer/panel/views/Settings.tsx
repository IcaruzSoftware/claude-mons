import { useState } from 'preact/hooks';
import { NATION_INFO, validateNickname } from '@claude-mons/shared';
import type { UiSnapshot, UpdateStatusValue } from '../../../common/ipc.ts';
import { HOOK_STATUS_LABEL, hookStatusDotClass, isHookConnected } from '../../ui/hookStatus.ts';

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
    s.hooks.effectiveMode === 'script'
      ? 'Script mode uses curl to reach the app directly; there is no offline spool, so events sent while the app is closed are lost.'
      : 'Binary mode uses the bundled hook program and spools events while the app is closed.';

  return (
    <div>
      <div class="section">
        <h3>Claude Code</h3>
        <div class="row">
          <div>
            <span class={`status-dot ${dot}`} />
            {HOOK_STATUS_LABEL[hooks]}
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
        <div class="row">
          <div>
            Hook mode
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
      </div>

      <div class="section">
        <h3>Appearance</h3>
        <div class="row">
          <div>
            Sprite size
            <div class="hint">Pixel scale of the pet on screen.</div>
          </div>
          <div class="seg">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                class={s.settings.spriteScale === n ? 'active' : ''}
                onClick={() => void window.monsUi.setSpriteScale(n)}
              >
                {n}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <div class="section">
        <h3>System</h3>
        <div class="row">
          <div>
            Start on login
            <div class="hint">Launch claude-mons when you sign in to your computer.</div>
          </div>
          <button
            class={s.settings.autostart ? 'active' : ''}
            onClick={() => void window.monsUi.setAutostart(!s.settings.autostart)}
          >
            {s.settings.autostart ? 'On' : 'Off'}
          </button>
        </div>
        <div class="row">
          <div>
            Updates
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
      </div>

      <div class="section">
        <h3>Profile</h3>
        <div class="kv">
          <span>Nation</span>
          <span>{s.profile.nation ? NATION_INFO[s.profile.nation].name : '–'}</span>
          <span>Nickname</span>
          <span>
            {s.profile.nickname ?? (s.online.configured ? 'assigned when online' : 'offline build')}
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
          <div class="row" style={{ marginTop: 8 }}>
            <div>
              Change nickname
              <div class="hint">Once every 7 days. Shown on the leaderboard and to opponents.</div>
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
      </div>

      <div class="section">
        <h3>About</h3>
        <div class="kv">
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
      </div>
    </div>
  );
}
