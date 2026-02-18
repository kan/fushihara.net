import { WemaBoard } from '@kanf/wema';
import '@kanf/wema/style.css';
import './style.css';
import { boardData } from './board-data';
import { applyDarkTheme } from './theme';
import { fetchZennArticles, fetchGitHubRepos, fetchGitHubLanguages } from './api';

const appEl = document.getElementById('app')!;

// Initialize the board with pre-defined data
const board = new WemaBoard({
  container: appEl,
  data: boardData,
  theme: 'card',
  createOnDblClick: false,
});

// --- Responsive repositioning ---
// Reference viewport size that the base layout in board-data.ts is designed for
const REF_W = 1400;
const REF_H = 900;
const MARGIN = 20;

// Store original positions and dimensions from board data
const basePositions = new Map<string, { x: number; y: number }>();
const baseSizes = new Map<string, { width: number; height: number }>();
for (const note of boardData.notes) {
  basePositions.set(note.id, { x: note.x, y: note.y });
  baseSizes.set(note.id, { width: note.width, height: note.height });
}

const MOBILE_BP = 768;
const MOBILE_GAP = 16;
// Display order for mobile vertical layout
const mobileOrder = [
  'center', 'email', 'social', 'skills',
  'zenn', 'oss', 'book', 'talks',
  'interests', 'poweredby',
];

let isLocked = false;

interface NoteLayout { x: number; y: number; width: number }

function getTargetLayout(): Map<string, NoteLayout> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targets = new Map<string, NoteLayout>();

  if (vw < MOBILE_BP) {
    // Mobile: single column, nearly full-width
    const noteWidth = vw - MARGIN * 2;
    let y = MARGIN;
    for (const id of mobileOrder) {
      const size = baseSizes.get(id);
      if (!size) continue;
      targets.set(id, { x: MARGIN, y, width: noteWidth });
      y += size.height + MOBILE_GAP;
    }
  } else {
    // Desktop: proportional scaling, original widths
    const sx = vw / REF_W;
    const sy = vh / REF_H;
    for (const [id, base] of basePositions) {
      const size = baseSizes.get(id)!;
      if (id === 'poweredby') {
        targets.set(id, { x: vw - size.width - MARGIN, y: vh - size.height - MARGIN, width: size.width });
        continue;
      }
      targets.set(id, { x: Math.round(base.x * sx), y: Math.round(base.y * sy), width: size.width });
    }
  }
  return targets;
}

function applyLayout(layout: Map<string, NoteLayout>) {
  if (isLocked) board.setViewOnly(false);
  for (const [id, l] of layout) {
    board.updateNote(id, { x: l.x, y: l.y, width: l.width });
  }
  if (isLocked) board.setViewOnly(true);
}

// Animate notes + edges together via JS lerp
let animId = 0;
function animateToLayout(targets: Map<string, NoteLayout>, duration = 300) {
  animId++;
  const myId = animId;

  // Capture current state
  const currents = new Map<string, NoteLayout>();
  for (const [id] of targets) {
    const note = board.getNote(id);
    if (note) currents.set(id, { x: note.x, y: note.y, width: note.width });
  }

  const start = performance.now();
  function step(now: number) {
    if (myId !== animId) return;
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);

    const frame = new Map<string, NoteLayout>();
    for (const [id, target] of targets) {
      const cur = currents.get(id);
      if (!cur) continue;
      frame.set(id, {
        x: Math.round(cur.x + (target.x - cur.x) * ease),
        y: Math.round(cur.y + (target.y - cur.y) * ease),
        width: Math.round(cur.width + (target.width - cur.width) * ease),
      });
    }
    applyLayout(frame);

    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// On mobile, expand all collapsed edges (no hover to toggle)
if (window.innerWidth < MOBILE_BP) {
  for (const edge of boardData.edges) {
    if (edge.collapsed) {
      board.updateEdge(edge.id, { collapsed: false });
    }
  }
}

// Initial layout (instant)
applyLayout(getTargetLayout());

// Resize: animate smoothly to new layout
window.addEventListener('resize', () => {
  animateToLayout(getTargetLayout(), 300);
});

// --- Dynamic data loading ---
async function loadDynamicData() {
  const [articles, repos, languages] = await Promise.allSettled([
    fetchZennArticles('kan', 5),
    fetchGitHubRepos('kan', 5),
    fetchGitHubLanguages('kan', 8),
  ]);

  // Zenn → Tech log
  if (articles.status === 'fulfilled' && articles.value.length > 0) {
    const items = articles.value
      .map((a) => `${a.emoji} <a href="https://zenn.dev${a.path}" target="_blank">${a.title}</a>`)
      .join('<br>');
    board.updateNote('zenn', { text: `<b>Tech log</b><br><br>${items}` });
  }

  // GitHub → OSS Projects
  if (repos.status === 'fulfilled' && repos.value.length > 0) {
    const items = repos.value
      .map((r) => {
        const star = r.stargazers_count > 0 ? ` <span style="color:#888">${r.stargazers_count}</span>` : '';
        const desc = r.description ? ` <span style="font-size:10px;color:#888">- ${r.description}</span>` : '';
        return `<div class="oss-row"><a href="${r.html_url}" target="_blank">${r.name}</a>${star}${desc}</div>`;
      })
      .join('');
    const more = '<div style="text-align:right;margin-top:6px"><a href="https://github.com/kan?tab=repositories" target="_blank" style="font-size:11px">more...</a></div>';
    board.updateNote('oss', { text: `<b>OSS Projects</b><br><br>${items}${more}` });
  }

  // GitHub Languages → Skills
  if (languages.status === 'fulfilled' && languages.value.length > 0) {
    const items = languages.value
      .map((l) => l.name)
      .join(' / ');
    board.updateNote('skills', { text: `<b>Skills</b><br><br>${items}` });
  }
}

loadDynamicData().finally(() => {
  board.setViewOnly(true);
  isLocked = true;
});

// Apply dark theme overrides
applyDarkTheme(appEl);
