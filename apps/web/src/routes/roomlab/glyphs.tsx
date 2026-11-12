/** Original, simple avatar glyphs for the room lab (geometric shapes drawn here, no assets). */

export interface Glyph {
  id: string;
  label: string;
  color: string;
  path: string;
}

export const GLYPHS: readonly Glyph[] = [
  { id: 'dot', label: 'Dot', color: '#7dd3fc', path: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z' },
  { id: 'tri', label: 'Triangle', color: '#fca5a5', path: 'M12 3l9.5 17h-19z' },
  { id: 'square', label: 'Square', color: '#86efac', path: 'M4 4h16v16h-16z' },
  { id: 'diamond', label: 'Diamond', color: '#fde68a', path: 'M12 2l10 10l-10 10l-10-10z' },
  {
    id: 'star',
    label: 'Star',
    color: '#f9a8d4',
    path: 'M12 2l2.9 6.6l7.1.6l-5.4 4.7l1.6 7l-6.2-3.7l-6.2 3.7l1.6-7l-5.4-4.7l7.1-.6z',
  },
  {
    id: 'wave',
    label: 'Wave',
    color: '#a5b4fc',
    path: 'M2 14c3-6 5-6 8 0s5 6 8 0c1.2-2.4 2.4-3.6 4-4v5c-1 .5-1.8 1.4-2.6 3c-3 6-6.4 6-9.4 0c-1.7-3.4-2.6-3.4-4.3 0c-.9 1.8-2 2.8-3.7 3z',
  },
  { id: 'bolt', label: 'Bolt', color: '#fdba74', path: 'M13 2l-9 12h7l-2 8l9-12h-7z' },
  {
    id: 'moon',
    label: 'Moon',
    color: '#c4b5fd',
    path: 'M15 3a9 9 0 1 0 6 15a7.5 7.5 0 1 1-6-15z',
  },
];

const BY_ID = new Map(GLYPHS.map((g) => [g.id, g]));

export function glyphFor(id: string): Glyph {
  return BY_ID.get(id) ?? (GLYPHS[0] as Glyph);
}

export function GlyphIcon({ id, size = 24 }: { id: string; size?: number }) {
  const g = glyphFor(id);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d={g.path} fill={g.color} />
    </svg>
  );
}
