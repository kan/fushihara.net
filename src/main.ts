import { WemaBoard } from '@kanf/wema';
import '@kanf/wema/style.css';
import './style.css';
import { boardData, EMAIL, EXTRA_SKILLS, GITHUB_USER, OSS_REPOS, ossRow } from './board-data';
import { initTheme } from './theme-toggle';
import { fetchBlogPosts, fetchGitHubRepos, fetchGitHubLanguages } from './api';
import { escapeHtml, moreLink } from './note-html';
import { isoDate } from '../shared/date';
import {
  ACCESSORY_ROOM, MARGIN, MOBILE_GAP, MOBILE_TOP,
  gapBelow, getDesktopLayout, isMobile, mobileOrder, noteBases,
} from './layout';

const appEl = document.getElementById('app')!;
const INTERESTS_EDGE = 'e-interests';
// The blog's feed (lily serves it; blog/CONTRACT.md lists it as a public URL).
const BLOG_RSS = '/blog/rss.xml';
// How long the copy button says "Copied".
const COPIED_MS = 2000;

// Set by applyLayout(). Declared ahead of the board because the board's
// renderNoteAccessory reads it.
let mobile: boolean | undefined;
// Whether the RSS link under the Blog note has room. Also set by applyLayout().
let showRss = false;

// Says "Copied" to a screen reader. Outside the board: what is under a note is
// rebuilt on every redraw, and a live region has to stay put to be read.
const copyStatus = document.createElement('span');
copyStatus.className = 'visually-hidden';
copyStatus.setAttribute('role', 'status');
document.body.append(copyStatus);

initTheme();

// Initialize the board with pre-defined data
const board = new WemaBoard({
  container: appEl,
  data: boardData,
  theme: 'card',
  createOnDblClick: false,
  // Only shows while the column is up (below 768px), where wema hides the
  // edges: each note lists the notes it connects to, and a tap goes there.
  // The padding keeps the note it scrolls to clear of the fixed site title,
  // the same way the column starts below it.
  noteLinks: { padding: MOBILE_TOP },
  // Buttons under a note. They cannot go in the note's text: wema's sanitizer
  // drops <button>. What goes here is ours and is not sanitized.
  renderNoteAccessory: (note, el) => {
    // Not in the column: every edge is open there and noteLinks lists them.
    if (note.id === 'center' && !mobile) {
      el.append(interestsToggle());
      return true;
    }
    // The clipboard is missing outside a secure context. The mailto link in
    // the note still works there.
    if (note.id === 'email' && navigator.clipboard) {
      el.append(copyEmailButton());
      return true;
    }
    if (note.id === 'blog' && showRss) {
      el.append(noteLink('rss', 'RSS', BLOG_RSS, ICON_RSS));
      return true;
    }
    return false;
  },
});

// Icon paths on a 24x24 grid, drawn as strokes.
const ICON_COPY =
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
const ICON_CHECK = '<path d="M20 6 9 17l-5-5"/>';
const ICON_RSS =
  '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/>' +
  '<circle cx="5" cy="19" r="1"/>';

/**
 * A button for under a note. wema rebuilds what is there on every redraw, so
 * a button is drawn from state kept elsewhere, never from its own clicks.
 */
function noteAction(focusKey: string, label: string, iconPaths?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  return dressAction(button, focusKey, label, iconPaths);
}

/** The same pill as noteAction(), for somewhere to go rather than something to do. */
function noteLink(focusKey: string, label: string, href: string, iconPaths?: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  // Like the links inside the notes: the board stays where it is.
  link.target = '_blank';
  link.rel = 'noopener';
  return dressAction(link, focusKey, label, iconPaths);
}

function dressAction<T extends HTMLElement>(el: T, focusKey: string, label: string, iconPaths?: string): T {
  el.className = 'note-action';
  // wema puts the focus back on the element with the same key after a redraw.
  el.dataset.wemaFocusKey = focusKey;
  if (iconPaths) {
    // Decoration only: the label beside it carries the name. The markup is
    // made of the literals above.
    el.innerHTML =
      '<svg class="note-action-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      `aria-hidden="true">${iconPaths}</svg>`;
  }
  el.append(label);
  return el;
}

// The count badge under the centre note says how many notes are folded away,
// not what they are. This names them, and opens and folds them too.
function interestsToggle(): HTMLButtonElement {
  const open = !board.getEdges().find((e) => e.id === INTERESTS_EDGE)?.collapsed;
  const button = noteAction('interests', 'Interests');
  button.classList.add('interests-toggle');
  button.setAttribute('aria-expanded', String(open));
  button.addEventListener('click', () => {
    board.updateEdge(INTERESTS_EDGE, { collapsed: open });
  });
  return button;
}

// Whether the copy button says "Copied", and the timer that takes it back.
let emailCopied = false;
let copiedTimer: number | undefined;

function setEmailCopied(copied: boolean) {
  window.clearTimeout(copiedTimer);
  emailCopied = copied;
  if (copied) copiedTimer = window.setTimeout(() => setEmailCopied(false), COPIED_MS);
  // A button whose name changes under the focus is not read out again.
  copyStatus.textContent = copied ? 'Copied' : '';
  board.refreshNoteAccessory('email');
}

// For a visitor with no mail client set up, the mailto link opens nothing.
function copyEmailButton(): HTMLButtonElement {
  const button = emailCopied
    ? noteAction('copy-email', 'Copied', ICON_CHECK)
    : noteAction('copy-email', 'Copy', ICON_COPY);
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
    } catch {
      // Denied. A "Copied" left over from the click before would claim this one.
      setEmailCopied(false);
      return;
    }
    setEmailCopied(true);
  });
  return button;
}

// The badge folds and opens the same edge, so the button follows the edge
// rather than its own clicks.
board.on('edge:update', ({ edge }) => {
  if (edge.id === INTERESTS_EDGE) board.refreshNoteAccessory('center');
});

// --- Responsive repositioning ---
// Layout maths lives in ./layout.ts so it can be tested without a DOM.
const bases = noteBases(boardData);

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
    // Mobile reads every note in the column; desktop folds the edges the way
    // board-data.ts has them.
    for (const edge of boardData.edges) {
      board.updateEdge(edge.id, { collapsed: nowMobile ? false : !!edge.collapsed });
    }
    // The button depends on `mobile` as well as on the edge, so this does not
    // lean on the edge:update the loop above happens to emit.
    board.refreshNoteAccessory('center');
  }

  if (nowMobile) {
    // The column makes room for what is under a note.
    setShowRss(true, 0);
    // Display only: the notes keep their desktop positions and widths. wema
    // hides the edges and their collapse buttons while the column is up.
    board.setStacked({
      x: MARGIN,
      y: MOBILE_TOP,
      width: vw - MARGIN * 2,
      gap: MOBILE_GAP,
      order: mobileOrder,
    }, { duration });
    return;
  }

  // The new positions go in first: a move is unseen while stacked, so on the
  // way back the notes travel from the column straight to them.
  const targets = getDesktopLayout(vw, window.innerHeight, bases);
  board.moveNotes([...targets].map(([id, l]) => ({ id, ...l })), { duration });
  board.setStacked(null, { duration });
  // The OSS note sits right under the Blog note, and on a short window the
  // link would land on it.
  setShowRss(gapBelow('blog', 'oss', targets, bases) >= ACCESSORY_ROOM, duration);
}

function setShowRss(fits: boolean, moving: number) {
  if (fits === showRss) return;
  showRss = fits;
  // Showing waits for the notes to finish moving apart: until then they are
  // still as close as they were. Hiding does not wait.
  if (fits && moving) window.setTimeout(() => board.refreshNoteAccessory('blog'), moving);
  else board.refreshNoteAccessory('blog');
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
