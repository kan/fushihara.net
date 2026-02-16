/**
 * Apply dark theme CSS custom properties to the wema board.
 * Called after the board mounts so the .wema-board element exists.
 */
export function applyDarkTheme(boardEl: HTMLElement): void {
  const board = boardEl.querySelector('.wema-board') as HTMLElement | null;
  if (!board) return;

  board.style.setProperty('--wema-note-border-radius', '12px');
  board.style.setProperty('--wema-note-shadow', '0 4px 20px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.3)');
  board.style.setProperty('--wema-note-color-text', '#EAEAEA');
  board.style.setProperty('--wema-edge-color', '#7B8DA4');
  board.style.setProperty('--wema-edge-width', '2px');
  board.style.setProperty('--wema-anchor-size', '0px');
}
