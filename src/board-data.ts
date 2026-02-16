import type { WemaBoardData } from '@kanf/wema';
import {
  siBluesky, siX, siGithub, siFacebook, siInstagram,
  siCloudflarepages, siCloudflareworkers, siVite, siTypescript, siNpm, siClaude,
} from 'simple-icons';

// Left-accent stripe colors (card theme uses note.color for the stripe)
const C = {
  center: '#E94560',   // Coral red
  email: '#00BFA5',    // Teal
  social: '#4FC3F7',   // Light blue
  zenn: '#3EA8FF',     // Zenn blue
  book: '#FFB74D',     // Orange
  talks: '#FF7043',    // Deep orange
  skills: '#5C6BC0',   // Indigo
  oss: '#81C784',      // Green
  interests: '#CE93D8',// Light purple
  poweredby: '#555',   // Subtle gray
} as const;

// Build a data URI from a simple-icons path (monochrome #999)
const siIcon = (si: { path: string }, href: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#999"><path d="${si.path}"/></svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return `<a href="${href}" target="_blank"><img src="${uri}" width="22" height="22" style="vertical-align:middle"></a>`;
};

// Note dimensions
const W = 200;
const H = 120;
const CW = 260;
const CH = 190;
const OSSW = 240;
const OSSH = 160;

export const boardData: WemaBoardData = {
  version: 1,
  notes: [
    // === Center ===
    {
      id: 'center',
      x: 500, y: 350,
      width: CW, height: CH,
      text: '<b style="font-size:20px">KAN Fushihara</b><br><span style="font-size:11px;color:#888">伏原 幹 / ふしはら かん</span><br><br>Programmer<br><span style="font-size:13px"><a href="https://communitylinks.co.jp/" target="_blank">@ Community Links</a></span><br><span style="font-size:11px;color:#888">Kawagoe, Saitama, Japan</span>',
      color: C.center,
      zIndex: 10,
    },

    // === Email (top center) ===
    {
      id: 'email',
      x: 530, y: 120,
      width: W, height: 80,
      text: '<b>Email</b><br><a href="mailto:kan.fushihara@gmail.com">kan.fushihara@gmail.com</a>',
      color: C.email,
      zIndex: 1,
    },

    // === Social (left side, single card with monochrome icons) ===
    {
      id: 'social',
      x: 60, y: 220,
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

    // === Skills (left side, between Social and Interests) ===
    {
      id: 'skills',
      x: 100, y: 400,
      width: 240, height: 130,
      text: '<b>Skills</b><br><br><span style="color:#888">Loading...</span>',
      color: C.skills,
      zIndex: 1,
    },

    // === Content (right side) ===
    {
      id: 'zenn',
      x: 920, y: 200,
      width: 280, height: 220,
      text: '<b>Tech log</b><br><br><span style="color:#888">Loading...</span>',
      color: C.zenn,
      zIndex: 1,
    },
    {
      id: 'book',
      x: 980, y: 500,
      width: W, height: H,
      text: '<b>Book</b><br><br><a href="https://amzn.to/4rj8ti5" target="_blank">ふしはらかんのらーめん話</a>',
      color: C.book,
      zIndex: 1,
    },
    {
      id: 'talks',
      x: 960, y: 660,
      width: W, height: H,
      text: '<b>Slides</b><br><br><a href="https://speakerdeck.com/kan" target="_blank">Speaker Deck</a>',
      color: C.talks,
      zIndex: 1,
    },

    // === OSS (right bottom) ===
    {
      id: 'oss',
      x: 510, y: 680,
      width: 280, height: 220,
      text: '<b>OSS Projects</b><br><br><span style="color:#888">Loading...</span>',
      color: C.oss,
      zIndex: 1,
    },

    // === Interests (bottom) ===
    {
      id: 'interests',
      x: 160, y: 600,
      width: OSSW, height: OSSH,
      text: '<b>Interests</b><br><br><a href="https://idolmaster-official.jp/" target="_blank">THE IDOLM@STER</a><br><a href="https://zombielandsaga.com/" target="_blank">ゾンビランドサガ</a><br><a href="https://anime-precure.com/" target="_blank">プリキュアシリーズ</a><br><a href="https://www.moukotanmen-nakamoto.com/" target="_blank">蒙古タンメン中本</a>',
      color: C.interests,
      zIndex: 1,
    },

    // === Powered by (positioned dynamically in main.ts) ===
    {
      id: 'poweredby',
      x: 0, y: 0,
      width: 220, height: 110,
      text: [
        '<b>Powered by</b><br><br>',
        siIcon(siCloudflarepages, 'https://pages.cloudflare.com'),
        siIcon(siCloudflareworkers, 'https://workers.cloudflare.com'),
        siIcon(siVite, 'https://vitejs.dev'),
        siIcon(siTypescript, 'https://www.typescriptlang.org'),
        siIcon(siNpm, 'https://www.npmjs.com/package/@kanf/wema'),
        siIcon(siClaude, 'https://claude.com/product/claude-code'),
      ].join(''),
      color: C.poweredby,
      zIndex: 1,
    },
  ],

  edges: [
    { id: 'e-email', from: 'center', to: 'email', fromAnchor: 'auto', toAnchor: 'auto', style: 'dashed', lineStyle: 'dashed', arrowHead: 'none', strokeWidth: 2, routing: 'curve' },
    { id: 'e-social', from: 'center', to: 'social', fromAnchor: 'auto', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-zenn', from: 'center', to: 'zenn', fromAnchor: 'auto', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-book', from: 'center', to: 'book', fromAnchor: 'auto', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-talks', from: 'center', to: 'talks', fromAnchor: 'auto', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-skills', from: 'center', to: 'skills', fromAnchor: 'auto', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-oss', from: 'center', to: 'oss', fromAnchor: 'auto', toAnchor: 'auto', style: 'arrow', arrowHead: 'end', strokeWidth: 2, routing: 'curve' },
    { id: 'e-interests', from: 'center', to: 'interests', fromAnchor: 'auto', toAnchor: 'auto', style: 'line', arrowHead: 'none', strokeWidth: 2, routing: 'curve' },
  ],

  viewport: { x: 0, y: 0, zoom: 1 },
};
