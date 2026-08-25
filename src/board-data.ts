import type { WemaBoardData } from '@kanf/wema';
import { moreLink } from './note-html';
import {
  siBluesky, siX, siGithub, siFacebook, siInstagram,
  siCloudflareworkers, siVite, siTypescript, siAstro, siClaude,
} from 'simple-icons';

// Left-accent stripe colors (card theme uses note.color for the stripe)
const C = {
  center: '#E94560',   // Coral red
  email: '#00BFA5',    // Teal
  social: '#4FC3F7',   // Light blue
  blog: '#3EA8FF',     // Blue
  links: '#FF7043',    // Deep orange
  skills: '#5C6BC0',   // Indigo
  oss: '#81C784',      // Green
  interests: '#CE93D8',// Light purple
  poweredby: '#555',   // Subtle gray
} as const;

// Monochrome wema icon (official logo with #999 tones)
const wemaIcon = (href: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M15 9.5C21 9.5 23.5 12 23.5 15" fill="none" stroke="#999" stroke-width="1.5" stroke-linecap="round"/><polygon points="23.5,17 21.5,14 25.5,14" fill="#999"/><rect x="2" y="4" width="13" height="11" rx="2" fill="#999"/><line x1="5" y1="8" x2="12" y2="8" stroke="#fff" opacity=".6" stroke-linecap="round"/><line x1="5" y1="11" x2="10" y2="11" stroke="#fff" opacity=".6" stroke-linecap="round"/><rect x="17" y="17" width="13" height="11" rx="2" fill="#999"/><line x1="20" y1="21" x2="27" y2="21" stroke="#fff" opacity=".6" stroke-linecap="round"/><line x1="20" y1="24" x2="25" y2="24" stroke="#fff" opacity=".6" stroke-linecap="round"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return `<a href="${href}" target="_blank"><img src="${uri}" width="22" height="22" style="vertical-align:middle"></a>`;
};

// Build a data URI from a simple-icons path (monochrome #999)
const siIcon = (si: { path: string }, href: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#999"><path d="${si.path}"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return `<a href="${href}" target="_blank"><img src="${uri}" width="22" height="22" style="vertical-align:middle"></a>`;
};

export const boardData: WemaBoardData = {
  version: 1,
  notes: [
    // === Center ===
    {
      id: 'center',
      x: 500, y: 250,
      width: 260, height: 190,
      text: '<b style="font-size:20px">KAN Fushihara</b><br><span class="muted" style="font-size:11px">伏原 幹 / ふしはら かん</span><br><br>Programmer<br><span style="font-size:13px"><a href="https://communitylinks.co.jp/" target="_blank">@ Community Links</a></span><br><span class="muted" style="font-size:11px">Kawagoe, Saitama, Japan</span>',
      color: C.center,
      zIndex: 10,
    },

    // === Email (top center) ===
    {
      id: 'email',
      x: 530, y: 20,
      width: 200, height: 80,
      text: '<b>Email</b><br><a href="mailto:kan.fushihara@gmail.com">kan.fushihara@gmail.com</a>',
      color: C.email,
      zIndex: 1,
    },

    // === Social (left side, single card with monochrome icons) ===
    {
      id: 'social',
      x: 60, y: 120,
      width: 220, height: 110,
      text: [
        '<b>Social</b><br><br>',
        siIcon(siBluesky, 'https://bsky.app/profile/kan.fushihara.net'),
        siIcon(siX, 'https://twitter.com/__kan'),
        siIcon(siGithub, 'https://github.com/kan'),
        siIcon(siFacebook, 'https://www.facebook.com/kan.fushihara'),
        siIcon(siInstagram, 'https://www.instagram.com/kanf'),
      ].join(''),
      color: C.social,
      zIndex: 1,
    },

    // === Skills (left column, between Social and Links) ===
    {
      id: 'skills',
      x: 100, y: 300,
      width: 240, height: 130,
      text: '<b>Skills</b><br><br><span class="muted">Loading...</span>',
      color: C.skills,
      zIndex: 1,
    },

    // === Blog (right column, top) ===
    {
      id: 'blog',
      x: 920, y: 100,
      width: 280, height: 220,
      // more... は静的なテキストにも置く。/api/blog が落ちた日に、API を要らない
      // 唯一の行き先（自分のブログ）まで辿れなくなるのは割に合わない。
      text: `<b>Blog</b><br><br><span class="muted">Loading...</span>${moreLink('/blog/')}`,
      color: C.blog,
      zIndex: 1,
    },
    // === Links (left column, bottom) ===
    {
      id: 'links',
      x: 110, y: 520,
      width: 240, height: 140,
      text: '<b>Links</b><br><br>' + [
        '<a href="https://zenn.dev/kan" target="_blank">Zenn</a>',
        '<a href="https://amzn.to/4rj8ti5" target="_blank">ふしはらかんのらーめん話</a>',
        '<a href="https://speakerdeck.com/kan" target="_blank">Speaker Deck</a>',
      ].join('<br>'),
      color: C.links,
      zIndex: 1,
    },

    // === OSS (right column, bottom) ===
    {
      id: 'oss',
      x: 900, y: 420,
      width: 280, height: 220,
      text: '<b>OSS Projects</b><br><br><span class="muted">Loading...</span>',
      color: C.oss,
      zIndex: 1,
    },

    // === Interests (bottom center, collapsed by default) ===
    {
      id: 'interests',
      x: 430, y: 640,
      width: 240, height: 160,
      text: '<b>Interests</b><br><br><a href="https://idolmaster-official.jp/" target="_blank">THE IDOLM@STER</a><br><a href="https://zombielandsaga.com/" target="_blank">ゾンビランドサガ</a><br><a href="https://anime-precure.com/" target="_blank">プリキュアシリーズ</a><br><a href="https://www.moukotanmen-nakamoto.com/" target="_blank">蒙古タンメン中本</a>',
      color: C.interests,
      zIndex: 1,
    },

    // === Powered by (positioned dynamically in main.ts) ===
    {
      id: 'poweredby',
      x: 0, y: 0,
      width: 260, height: 110,
      text: [
        '<b>Powered by</b><br><br>',
        siIcon(siCloudflareworkers, 'https://workers.cloudflare.com'),
        siIcon(siVite, 'https://vitejs.dev'),
        siIcon(siTypescript, 'https://www.typescriptlang.org'),
        wemaIcon('https://www.npmjs.com/package/@kanf/wema'),
        siIcon(siAstro, 'https://astro.build'),
        siIcon(siClaude, 'https://claude.com/product/claude-code'),
        siIcon(siGithub, 'https://github.com/kan/fushihara.net'),
      ].join(''),
      color: C.poweredby,
      zIndex: 1,
    },
  ],

  edges: [
    { id: 'e-email', from: 'center', to: 'email', fromAnchor: 'top', toAnchor: 'auto', style: 'dashed', lineStyle: 'dashed', arrowHead: 'none', strokeWidth: 2, routing: 'curve' },
    { id: 'e-social', from: 'center', to: 'social', fromAnchor: 'left', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-skills', from: 'center', to: 'skills', fromAnchor: 'left', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-blog', from: 'center', to: 'blog', fromAnchor: 'right', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-links', from: 'center', to: 'links', fromAnchor: 'left', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-oss', from: 'center', to: 'oss', fromAnchor: 'right', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },

    // 唯一の折り畳み。wema の機能のデモを兼ねているので 1 本は残す。畳む先を
    // Interests にしているのは、初見で必要な情報ではなく、開いたときの中身が
    // 楽しい方が「開けた甲斐」があるため（連絡先を隠すのは本末転倒だった）。
    //
    // **下辺は Interests が独占していないといけない。** wema の折り畳みボタンは
    // 辺ごとで、その辺のエッジが全部畳まれているときだけ件数バッジになる。他の
    // エッジと同居させると、バッジが出ないうえにボタンを押すと巻き添えで畳まれる。
    // だから全エッジの fromAnchor を明示してある（auto は座標で決まるので、
    // ノートを動かした拍子に同居する）。
    { id: 'e-interests', from: 'center', to: 'interests', fromAnchor: 'bottom', toAnchor: 'auto', style: 'line', arrowHead: 'none', strokeWidth: 2, routing: 'curve', collapsed: true },
  ],

  viewport: { x: 0, y: 0, zoom: 1 },
};
