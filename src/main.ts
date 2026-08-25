import { WemaBoard } from '@kanf/wema';
import '@kanf/wema/style.css';
import './style.css';
import { boardData } from './board-data';
import { initTheme } from './theme-toggle';
import { fetchBlogPosts, fetchGitHubRepos, fetchGitHubLanguages } from './api';
import { escapeHtml, moreLink } from './note-html';
import { isoDate } from '../shared/date';
import { MOBILE_BP, getTargetLayout, noteBases, type NoteLayout } from './layout';

const appEl = document.getElementById('app')!;

initTheme();

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
// otherwise a narrowed desktop window leaves the collapsed note stuck at zero width.
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

/** 二次テキスト（日付・説明）。色もサイズも class に寄せる */
function sub(text: string): string {
  return `<span class="muted note-sub">${text}</span>`;
}

async function loadDynamicData() {
  const [posts, repos, languages] = await Promise.allSettled([
    fetchBlogPosts(4),
    fetchGitHubRepos('kan', 5),
    fetchGitHubLanguages('kan', 8),
  ]);

  // ブログの RSS → Blog ノート
  if (posts.status === 'fulfilled' && posts.value.length > 0) {
    const items = posts.value
      .map((p) => {
        // 日付はタイトルより前。.blog-row は 1 行省略なので、後ろに置くと
        // タイトルが少し長いだけで省略記号に飲まれて見えなくなる。
        const at = new Date(p.date);
        const stamp = Number.isNaN(at.getTime()) ? '' : `${sub(isoDate(at))} `;
        return `<div class="blog-row">${stamp}<a href="${escapeHtml(p.link)}" target="_blank">${escapeHtml(p.title)}</a></div>`;
      })
      .join('');
    board.updateNote('blog', { text: `<b>Blog</b><br><br>${items}${moreLink('/blog/')}` });
  }

  // GitHub → OSS Projects
  if (repos.status === 'fulfilled' && repos.value.length > 0) {
    const items = repos.value
      .map((r) => {
        const star = r.stargazers_count > 0 ? ` <span class="muted">${r.stargazers_count}</span>` : '';
        const desc = r.description ? ` ${sub(`- ${escapeHtml(r.description)}`)}` : '';
        return `<div class="oss-row"><a href="${escapeHtml(r.html_url)}" target="_blank">${escapeHtml(r.name)}</a>${star}${desc}</div>`;
      })
      .join('');
    board.updateNote('oss', {
      text: `<b>OSS Projects</b><br><br>${items}${moreLink('https://github.com/kan?tab=repositories')}`,
    });
  }

  // GitHub Languages → Skills
  if (languages.status === 'fulfilled' && languages.value.length > 0) {
    const items = languages.value
      .map((l) => escapeHtml(l.name))
      .join(' / ');
    board.updateNote('skills', { text: `<b>Skills</b><br><br>${items}` });
  }
}

loadDynamicData().finally(() => {
  board.setViewOnly(true);
  isLocked = true;
});
