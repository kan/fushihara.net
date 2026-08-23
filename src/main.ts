import { WemaBoard } from '@kanf/wema';
import '@kanf/wema/style.css';
import './style.css';
import { boardData } from './board-data';
import { applyDarkTheme } from './theme';
import { fetchZennArticles, fetchGitHubRepos, fetchGitHubLanguages } from './api';
import { MOBILE_BP, getTargetLayout, noteBases, type NoteLayout } from './layout';

const appEl = document.getElementById('app')!;

// Initialize the board with pre-defined data
const board = new WemaBoard({
  container: appEl,
  data: boardData,
  theme: 'card',
  createOnDblClick: false,
});

// --- Responsive repositioning ---
// Layout maths lives in ./layout.ts so it can be tested without a DOM.
const bases = noteBases(boardData);

let isLocked = false;

// The board is locked to view-only once the dynamic data lands, so any
// programmatic mutation has to lift the lock around itself.
function withEditableBoard(mutate: () => void) {
  if (isLocked) board.setViewOnly(false);
  mutate();
  if (isLocked) board.setViewOnly(true);
}

function applyLayout(layout: Map<string, NoteLayout>) {
  withEditableBoard(() => {
    for (const [id, l] of layout) {
      board.updateNote(id, { x: l.x, y: l.y, width: l.width });
    }
  });
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

// Collapsed edges are opened by hovering, which mobile cannot do, so expand them
// below the breakpoint. Resizing across the breakpoint has to revisit this too,
// otherwise a narrowed desktop window leaves the email note stuck at zero width.
const collapsibleEdges = boardData.edges.filter((e) => e.collapsed);
let edgesExpanded = false;

function syncCollapsedEdges(vw: number) {
  const expand = vw < MOBILE_BP;
  if (expand === edgesExpanded) return;

  withEditableBoard(() => {
    for (const edge of collapsibleEdges) {
      board.updateEdge(edge.id, { collapsed: !expand });
    }
  });
  edgesExpanded = expand;
}

// Initial layout (instant)
syncCollapsedEdges(window.innerWidth);
applyLayout(getTargetLayout(window.innerWidth, window.innerHeight, bases));

// Resize: animate smoothly to new layout
window.addEventListener('resize', () => {
  syncCollapsedEdges(window.innerWidth);
  animateToLayout(getTargetLayout(window.innerWidth, window.innerHeight, bases), 300);
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
