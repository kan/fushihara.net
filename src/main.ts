import { WemaBoard } from '@kanf/wema';
import '@kanf/wema/style.css';
import './style.css';
import { boardData, EXTRA_SKILLS, GITHUB_USER, OSS_REPOS, ossRow } from './board-data';
import { initTheme } from './theme-toggle';
import { fetchBlogPosts, fetchGitHubRepos, fetchGitHubLanguages } from './api';
import { escapeHtml, moreLink } from './note-html';
import { isoDate } from '../shared/date';
import {
  MARGIN, MOBILE_GAP, MOBILE_TOP,
  getDesktopLayout, isMobile, mobileOrder, noteBases,
} from './layout';

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

let mobile: boolean | undefined;

// The board is view-only once the dynamic data lands. Everything here still
// goes through: wema takes moves and collapses from the API in that mode.
function applyLayout(duration = 0) {
  const vw = window.innerWidth;
  const nowMobile = isMobile(vw);
  const crossed = nowMobile !== mobile;

  if (crossed) {
    mobile = nowMobile;
    // Mobile scrolls the page instead of panning the board. The CSS that lets
    // the page scroll follows the same decision through this class.
    document.documentElement.classList.toggle('is-mobile', nowMobile);
    board.setPageScroll(nowMobile);
  }

  if (nowMobile) {
    // stackNotes() leaves a hidden note where it is, and it would come back on
    // top of the column: open every edge first, each time, since the visitor
    // can collapse any of them in between.
    for (const edge of boardData.edges) {
      board.updateEdge(edge.id, { collapsed: false });
    }
    board.stackNotes({
      x: MARGIN,
      y: MOBILE_TOP,
      width: vw - MARGIN * 2,
      gap: MOBILE_GAP,
      order: mobileOrder,
      duration,
    });
    return;
  }

  // Back on desktop: fold the edges the way board-data.ts has them
  if (crossed) {
    for (const edge of boardData.edges) {
      board.updateEdge(edge.id, { collapsed: !!edge.collapsed });
    }
  }

  const targets = getDesktopLayout(vw, window.innerHeight, bases);
  board.moveNotes([...targets].map(([id, l]) => ({ id, ...l })), { duration });
}

// Initial layout (instant)
applyLayout();

// Resize: wema animates the notes and their edges to the new layout
window.addEventListener('resize', () => applyLayout(300));

// --- Dynamic data loading ---

/** 二次テキスト（日付・説明）。色もサイズも class に寄せる */
function sub(text: string): string {
  return `<span class="muted note-sub">${text}</span>`;
}

async function loadDynamicData() {
  const [posts, repos, languages] = await Promise.allSettled([
    fetchBlogPosts(4),
    fetchGitHubRepos(GITHUB_USER),
    fetchGitHubLanguages(GITHUB_USER, 8),
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

  // GitHub → OSS Projects（並びは board-data.ts の OSS_REPOS が決める）
  if (repos.status === 'fulfilled' && repos.value.length > 0) {
    const byName = new Map(repos.value.map((r) => [r.name, r]));
    const items = OSS_REPOS.map((name) => {
      // star は出さない。顔ぶれは手で選んでいるので、数字は並びの根拠にならない。
      const desc = byName.get(name)?.description;
      return ossRow(name, desc ? ` ${sub(`- ${escapeHtml(desc)}`)}` : '');
    }).join('');
    board.updateNote('oss', {
      text: `<b>OSS Projects</b><br><br>${items}` +
        moreLink(`https://github.com/${GITHUB_USER}?tab=repositories`),
    });
  }

  // GitHub Languages → Skills（集計した言語のあとに、手書きの道具を足す）
  if (languages.status === 'fulfilled' && languages.value.length > 0) {
    const names = languages.value.map((l) => l.name);
    const items = [...names, ...EXTRA_SKILLS.filter((s) => !names.includes(s))]
      .map(escapeHtml)
      .join(' / ');
    board.updateNote('skills', { text: `<b>Skills</b><br><br>${items}` });
  }
}

loadDynamicData().finally(() => {
  board.setViewOnly(true);
});
