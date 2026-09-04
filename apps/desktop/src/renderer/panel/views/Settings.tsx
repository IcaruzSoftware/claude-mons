import { NATION_INFO } from '@claude-mons/shared';
import type { UiSnapshot } from '../../../common/ipc.ts';

export function SettingsView({ s }: { s: UiSnapshot }) {
  const hooks = s.hooks.status;
  const hookLabel: Record<typeof hooks, string> = {
    installed: 'Connected',
    partial: 'Partially connected',
    'not-installed': 'Not connected',
    unreadable: 'settings.json unreadable',
    'no-binary': 'Hook binary missing (run pnpm hook:build)',
  };
  const dot = hooks === 'installed' ? 'ok' : hooks === 'partial' ? 'warn' : '';

  return (
    <div>
      <div class="section">
        <h3>Claude Code</h3>
        <div class="row">
          <div>
            <span class={`status-dot ${dot}`} />
            {hookLabel[hooks]}
            <div class="hint">
              Adds hooks to ~/.claude/settings.json. Only event metadata reaches the app; prompts
              and file contents stay on your machine. Start a new Claude Code session after
              connecting.
            </div>
          </div>
          <button
            class={hooks === 'installed' ? '' : 'primary'}
            disabled={hooks === 'unreadable' || hooks === 'no-binary'}
            onClick={() => void window.monsUi.toggleHooks()}
          >
            {hooks === 'installed' ? 'Disconnect' : hooks === 'partial' ? 'Repair' : 'Connect'}
          </button>
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
        <h3>Profile</h3>
        <div class="kv">
          <span>Nation</span>
          <span>{s.profile.nation ? NATION_INFO[s.profile.nation].name : '–'}</span>
          <span>Nickname</span>
          <span>{s.profile.nickname ?? 'assigned when online'}</span>
        </div>
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
