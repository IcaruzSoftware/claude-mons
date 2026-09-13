import type { ComponentChildren, JSX } from 'preact';

/**
 * Bevelled card chrome (docs/design/ui-style.md Chrome: borders, radii, bevel): 2px border, 4px
 * radius, two-tone inset shadow suggesting a raised pixel-art panel. Used anywhere a plain
 * `.card`-style container is needed instead of a more specific component (hero, gems, slot cards).
 */
export function PixelPanel({
  class: cls,
  style,
  children,
}: {
  class?: string;
  style?: JSX.CSSProperties;
  children?: ComponentChildren;
}) {
  return (
    <div class={`pixel-panel ${cls ?? ''}`} style={style}>
      {children}
    </div>
  );
}
