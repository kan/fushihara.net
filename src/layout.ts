import type { WemaBoardData } from '@kanf/wema';

// Reference viewport size that the base layout in board-data.ts is designed for
export const REF_W = 1400;
export const REF_H = 900;
export const MARGIN = 20;

export const MOBILE_BP = 768;
export const MOBILE_GAP = 16;

/** Display order for mobile vertical layout. Every note id must appear here. */
export const mobileOrder = [
  'center', 'email', 'social', 'skills',
  'zenn', 'oss', 'book', 'talks',
  'interests', 'poweredby',
];

export interface NoteLayout { x: number; y: number; width: number }
export interface NoteBase extends NoteLayout { height: number }

/** Snapshot the authored positions and sizes, which getTargetLayout scales from. */
export function noteBases(data: WemaBoardData): Map<string, NoteBase> {
  const bases = new Map<string, NoteBase>();
  for (const note of data.notes) {
    bases.set(note.id, { x: note.x, y: note.y, width: note.width, height: note.height });
  }
  return bases;
}

/**
 * Resolve where every note goes for the given viewport.
 * Pure: the caller supplies the viewport so this stays testable.
 */
export function getTargetLayout(
  vw: number,
  vh: number,
  bases: Map<string, NoteBase>,
): Map<string, NoteLayout> {
  const targets = new Map<string, NoteLayout>();

  if (vw < MOBILE_BP) {
    // Mobile: single column, nearly full-width
    const noteWidth = vw - MARGIN * 2;
    let y = MARGIN;
    for (const id of mobileOrder) {
      const base = bases.get(id);
      if (!base) continue;
      targets.set(id, { x: MARGIN, y, width: noteWidth });
      y += base.height + MOBILE_GAP;
    }
  } else {
    // Desktop: proportional scaling, original widths
    const sx = vw / REF_W;
    const sy = vh / REF_H;
    for (const [id, base] of bases) {
      if (id === 'poweredby') {
        targets.set(id, {
          x: vw - base.width - MARGIN,
          y: vh - base.height - MARGIN,
          width: base.width,
        });
        continue;
      }
      targets.set(id, {
        x: Math.round(base.x * sx),
        y: Math.round(base.y * sy),
        width: base.width,
      });
    }
  }
  return targets;
}
