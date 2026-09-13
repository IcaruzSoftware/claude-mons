import { Glyph, type GlyphName } from './Glyph.tsx';

export interface BottomTab<T extends string> {
  id: T;
  label: string;
  glyph: GlyphName;
}

/**
 * Bottom game-menu tab bar (docs/design/ui-style.md Iconography, "Tabs" justification): glyph +
 * label per tab, a bevelled "pressed" active state, replacing the old top pixel-underline strip.
 */
export function BottomTabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: ReadonlyArray<BottomTab<T>>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav class="gamenav">
      {tabs.map((t) => (
        <button
          key={t.id}
          class={t.id === active ? 'active' : ''}
          onClick={() => onChange(t.id)}
          aria-current={t.id === active ? 'page' : undefined}
        >
          <Glyph name={t.glyph} size={18} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
