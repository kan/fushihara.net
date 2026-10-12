import type { WemaBoardData } from '@kanf/wema';

// Reference viewport size that the base layout in board-data.ts is designed for
export const REF_W = 1400;
export const REF_H = 900;
export const MARGIN = 20;

export const MOBILE_BP = 768;
export const MOBILE_GAP = 16;

/**
 * モバイルで 1 枚目を下げる量。左上のサイト見出し（`.site-brand`）は position: fixed
 * なので、ここを空けないと 1 枚目のノートに重なる。
 */
export const MOBILE_TOP = 56;

/**
 * Display order for mobile vertical layout. wema stacks a note that is missing
 * here after these, by its position, so list every id to keep the order chosen.
 */
export const mobileOrder = [
  'center', 'email', 'social', 'skills',
  'blog', 'oss', 'links',
  'interests', 'poweredby',
];

/** Below this width the notes are stacked in one column and the page scrolls. */
export function isMobile(vw: number): boolean {
  return vw < MOBILE_BP;
}

export interface NoteLayout { x: number; y: number; width: number }
export interface NoteBase extends NoteLayout { height: number }

/** Snapshot the authored positions and sizes, which getDesktopLayout scales from. */
export function noteBases(data: WemaBoardData): Map<string, NoteBase> {
  const bases = new Map<string, NoteBase>();
  for (const note of data.notes) {
    bases.set(note.id, { x: note.x, y: note.y, width: note.width, height: note.height });
  }
  return bases;
}

/**
 * Resolve where every note goes on a desktop viewport: the authored positions
 * scaled to the viewport, at the authored widths. The mobile column is not
 * computed here; wema stacks it (`setStacked()` in main.ts).
 * Pure: the caller supplies the viewport so this stays testable.
 */
export function getDesktopLayout(
  vw: number,
  vh: number,
  bases: Map<string, NoteBase>,
): Map<string, NoteLayout> {
  const targets = new Map<string, NoteLayout>();
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
  return targets;
}
