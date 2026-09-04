import { useState } from 'preact/hooks';
import { NATIONS, NATION_INFO, speciesForNation, type Nation } from '@claude-mons/shared';
import { SpriteView } from '../../ui/SpriteView.tsx';

/** First launch: pick a nation. Permanent in v1. */
export function Onboarding() {
  const [busy, setBusy] = useState<Nation | null>(null);
  const choose = async (n: Nation) => {
    if (busy) return;
    setBusy(n);
    try {
      await window.monsUi.chooseNation(n);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="onboard">
      <h1>Choose your nation</h1>
      <p class="lead">
        Your nation is your team and your mon's element. You get a random egg from its two species.
        This choice is permanent, so pick the one that feels like you.
      </p>
      <div class="nations">
        {NATIONS.map((n) => {
          const info = NATION_INFO[n];
          const pool = speciesForNation(n);
          return (
            <button
              key={n}
              class={`nation ${n}`}
              disabled={busy !== null}
              onClick={() => void choose(n)}
            >
              <span class="title">
                <span class="swatch" style={{ background: info.palette.primary }} />
                {info.name}
              </span>
              <span class="tag">“{info.tagline}”</span>
              <span class="desc">{info.personality}</span>
              <span class="eggs">
                <SpriteView speciesId={null} stage="egg" nation={n} scale={2} />
                <span>
                  {pool.map((sp) => sp.names.baby).join(' · ')}
                  <br />
                  75 % common · 25 % rare
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
