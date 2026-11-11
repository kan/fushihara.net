/**
 * ランチャーに並べるサービスの一覧。**サービスを足すときに直すのはここだけ。**
 *
 * `scripts/build.ts` がここから `index.html` を組み立て、`icon` を
 * `dist/icons/<id>.svg` へコピーする。
 *
 * **アイコンは各サービスから複製して持つ。** 各サービスは Access（wema-kake は
 * アプリ側の認証）の内側にあり、favicon も未ログインでは取れない。Access の
 * Cookie はホスト名ごとなので、ランチャーにログインしていても、ほかのホストの
 * 画像を直接読むとログイン画面へのリダイレクトになる。
 */
export interface Service {
  /** `dist/icons/<id>.svg` の名前になる。E2E もこれで付箋を探す */
  id: string;
  name: string;
  description: string;
  /** カードを押したときの行き先 */
  url: string;
  /** `app/` からの相対パス。SVG だけ。省くと `icons/<id>.svg` */
  icon?: string;
  /** カードの下に並べる、もう 1 つの行き先（ブログの公開ページなど） */
  links?: { label: string; url: string }[];
}

export function iconPath(s: Service): string {
  return s.icon ?? `icons/${s.id}.svg`;
}

/** アイコンの複製元は各行のコメント。省いたものは `icons/<id>.svg` */
export const SERVICES: Service[] = [
  {
    // 複製元: kan/ratatoskr の web/public/favicon.svg
    id: 'ratatoskr',
    name: 'Ratatoskr',
    description: 'RSS リーダー',
    url: 'https://rss.fushihara.net/',
  },
  {
    // 複製元: kan/booky の src/favicon.ts
    id: 'booky',
    name: 'booky',
    description: 'BOOKSCAN の PDF 整理',
    url: 'https://booky.fushihara.net/',
  },
  {
    // 複製元: @kanf/wema-kake の dist/web/favicon.svg
    id: 'wema-kake',
    name: 'wema-kake',
    description: '付箋の Wiki',
    url: 'https://wema.fushihara.net/',
  },
  {
    // 複製元: kan/fit2bsky-cw の src/favicon.ts
    id: 'fit2bsky',
    name: 'fit2bsky',
    description: '体重の投稿 bot',
    url: 'https://weight.fushihara.net/',
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'ブログの管理画面',
    url: 'https://fushihara.net/blog/admin/',
    // 本体サイトと共有の favicon。複製せず shared/public から読む
    icon: '../shared/public/favicon.svg',
    links: [{ label: '公開ページ', url: 'https://fushihara.net/blog/' }],
  },
];
