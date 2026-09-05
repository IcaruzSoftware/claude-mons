import { useEffect, useState } from 'preact/hooks';
import { NATIONS, NATION_INFO, speciesForNation, type Nation } from '@claude-mons/shared';
import { SpriteView } from '../../ui/SpriteView.tsx';
import { HOOK_STATUS_LABEL, hookStatusDotClass, isHookConnected } from '../../ui/hookStatus.ts';
import type { UiSnapshot } from '../../../common/ipc.ts';
import {
  canGoBack,
  canGoNext,
  clampOnboardingStep,
  nextOnboardingStep,
  prevOnboardingStep,
  ONBOARDING_FIRST_STEP,
  ONBOARDING_STEP_COUNT,
  type OnboardingStep,
} from '../onboardingSteps.ts';

/** All wizard copy in one place so it is easy to edit without touching layout code. */
export const onboardingCopy = {
  welcome: {
    title: 'Welcome to claude-mons',
    lead: 'A desktop pet that trains while you work with Claude Code. Its egg starts out neutral — the nation you pick gives it its color.',
  },
  what: {
    title: 'What is claude-mons?',
    bullets: [
      'Your mon lives on your taskbar edge, walking, sitting and sleeping while you work.',
      'It earns XP from your real Claude Code activity — prompts, tool calls, finished turns. No prompt text ever leaves your machine.',
      'It hatches, levels up and evolves: Egg → Baby → Teen → Adult.',
    ],
  },
  controls: {
    title: 'Controls',
    rows: [
      ['Hover the pet', 'Stats card'],
      ['Left-click', 'Opens this panel'],
      ['Right-click', 'Menu'],
      ['Drag', 'Move it'],
      ['Shake it', "Battle another nation's mon"],
      ['Settings → Connect Claude Code', 'One click, then start a new Claude Code session'],
      ['Leaderboard tab', 'Shows trainers and nations'],
    ] as Array<[string, string]>,
  },
  connect: {
    title: 'Connect Claude Code',
    lead: 'claude-mons learns from your Claude Code activity through a few hooks. Connecting adds a handful of entries to ~/.claude/settings.json and never reads your prompts.',
    cta: 'Connect Claude Code',
    connecting: 'Connecting…',
    skip: 'Skip for now',
    success: 'Connected. Start a new Claude Code session to begin training.',
    hint: "Didn't fully connect. You can finish this any time in Settings.",
    note: 'This can be changed any time in Settings.',
  },
  nation: {
    title: 'Choose your nation',
    lead: "Your nation is your team and your mon's element — one random egg from its two species.",
    permanent: 'This choice is permanent.',
  },
};

/** Untinted by default; slowly cycles through each nation's tint to preview all four. */
function WelcomeEgg() {
  const [i, setI] = useState(-1);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % (NATIONS.length + 1)), 2200);
    return () => clearInterval(id);
  }, []);
  const nation: Nation | null = i >= 0 ? (NATIONS[i] ?? null) : null;
  return <SpriteView speciesId={null} stage="egg" nation={nation} scale={5} />;
}

function WelcomeStep() {
  return (
    <div class="onboard-step onboard-welcome">
      <WelcomeEgg />
      <h1>{onboardingCopy.welcome.title}</h1>
      <p class="lead">{onboardingCopy.welcome.lead}</p>
    </div>
  );
}

function WhatStep() {
  return (
    <div class="onboard-step">
      <h1>{onboardingCopy.what.title}</h1>
      <ul class="onboard-bullets">
        {onboardingCopy.what.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function ControlsStep() {
  return (
    <div class="onboard-step">
      <h1>{onboardingCopy.controls.title}</h1>
      <table class="onboard-controls">
        <tbody>
          {onboardingCopy.controls.rows.map(([action, result]) => (
            <tr key={action}>
              <td>{action}</td>
              <td class="hint">{result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectStep({ hooks, advance }: { hooks: UiSnapshot['hooks']; advance: () => void }) {
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const connected = isHookConnected(hooks.status);
  const disabled = hooks.status === 'unreadable' || hooks.status === 'no-binary';

  const connect = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await window.monsUi.toggleHooks();
    } finally {
      setBusy(false);
      setAttempted(true);
    }
  };

  const showResult = attempted || disabled;

  return (
    <div class="onboard-step">
      <h1>{onboardingCopy.connect.title}</h1>
      <p class="lead">{onboardingCopy.connect.lead}</p>
      <div class="connect-actions">
        <button
          type="button"
          class="primary"
          disabled={busy || disabled}
          onClick={() => void connect()}
        >
          {busy ? onboardingCopy.connect.connecting : onboardingCopy.connect.cta}
        </button>
        <button type="button" onClick={advance}>
          {onboardingCopy.connect.skip}
        </button>
      </div>
      {showResult && (
        <div class="connect-result">
          <span class={`status-dot ${hookStatusDotClass(hooks.status)}`} />
          {connected ? onboardingCopy.connect.success : HOOK_STATUS_LABEL[hooks.status]}
          {!connected && <div class="hint">{onboardingCopy.connect.hint}</div>}
        </div>
      )}
      <p class="hint">{onboardingCopy.connect.note}</p>
    </div>
  );
}

function NationStep({ busy, choose }: { busy: Nation | null; choose: (n: Nation) => void }) {
  return (
    <div class="onboard-step onboard-nation-step">
      <h1>{onboardingCopy.nation.title}</h1>
      <p class="lead">
        {onboardingCopy.nation.lead} <strong>{onboardingCopy.nation.permanent}</strong>
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
              onClick={() => choose(n)}
            >
              <span class="title">
                <span class="swatch" style={{ background: info.palette.primary }} />
                {info.name}
              </span>
              <span class="tag">“{info.tagline}”</span>
              <span class="desc">{info.personality}</span>
              <span class="eggs">
                <SpriteView speciesId={null} stage="egg" nation={n} scale={1} />
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

/**
 * First launch: a 5-step wizard (welcome, what it is, controls, connect Claude Code, nation
 * picker). Step state is local to this component instance — the panel window is hidden rather
 * than destroyed between views, so it survives a hide/show cycle without persistence.
 */
export function Onboarding({ s }: { s: UiSnapshot }) {
  const [step, setStep] = useState<OnboardingStep>(() =>
    s.isDev && s.devOnboardingStep != null
      ? clampOnboardingStep(s.devOnboardingStep)
      : ONBOARDING_FIRST_STEP,
  );
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

  const isLastStep = !canGoNext(step);

  return (
    <div class="onboard">
      <div class="onboard-content">
        {step === 0 && <WelcomeStep />}
        {step === 1 && <WhatStep />}
        {step === 2 && <ControlsStep />}
        {step === 3 && (
          <ConnectStep hooks={s.hooks} advance={() => setStep((s) => nextOnboardingStep(s))} />
        )}
        {step === 4 && <NationStep busy={busy} choose={(n) => void choose(n)} />}
      </div>
      <div class="onboard-nav">
        <div class="dots" aria-hidden="true">
          {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
            <span key={i} class={`dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>
        <div class="buttons">
          {canGoBack(step) && (
            <button type="button" onClick={() => setStep((s) => prevOnboardingStep(s))}>
              Back
            </button>
          )}
          {!isLastStep && (
            <button
              type="button"
              class="primary"
              onClick={() => setStep((s) => nextOnboardingStep(s))}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
