/**
 * 配信する静的アセットを 1 つのディレクトリにまとめる。
 *
 * `wrangler.jsonc` の `assets.directory` はプロジェクトに 1 つしか持てないので、
 * 本体サイトと共有の `shared/public`・ブログ専用の `public`・**lily が同梱する
 * 管理画面のビルド成果物**をここで合流させる。
 *
 * **管理画面はビルドしない。** lily がパッケージに `dist/admin` を入れて配るので、
 * 利用側に Vue のツールチェインが要らない（`vue` も `vite` も devDependency に
 * 無い）。lily を上げたら `npm install` の後にここを回すこと。
 */
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

/**
 * lily のパッケージの場所。**`node_modules` の位置を決め打ちにしない**
 * （workspace や pnpm の配置で黙って空の `admin/` が配られる）。
 */
const require = createRequire(import.meta.url);
const lily = dirname(
  resolveOrFail(() => require.resolve('@kanf/lily/package.json'), '@kanf/lily が入っていない'),
);

/**
 * lily が使える状態か。**素通しさせない。**
 *
 * ここを通らないと、失敗するのは後ろ（`wrangler` の bundle か `<mount>/admin/`）で、
 * どちらも原因が読めない形で出る。
 */
await checkLily();

// 前回の成果物を捨ててから作る。**上書きだけだと古いものが残る** ――
// 管理画面のアセットはファイル名にハッシュが入るので、lily を上げるたびに
// 使われないバンドルが積もり、そのままデプロイで上がっていく。
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// favicon 3 点。実体は本体サイトと共有。
await cp(join(root, '..', 'shared', 'public'), dist, { recursive: true });
// **ブログ専用のものを後から被せる。** 同じ名前があればこちらが勝つ。
// 今は ogp.png（本体は「fushihara.net」、ブログは「ふしはらねっとのぶろぐ」）。
// 共有に置くと 1 枚しか持てず、どちらのリンクを貼っても同じ絵が出る。
await cp(join(root, 'public'), dist, { recursive: true });

await cp(join(lily, 'dist', 'admin'), join(dist, 'admin'), { recursive: true });

console.log(`静的アセットを ${dist} に置いた (lily は ${lily})`);

async function checkLily() {
  // **`index.html` まで見る。** ディレクトリの有無だけだと、中断した vite build や
  // 古い dist が残っているときに通ってしまい、空の管理画面がそのまま配られる。
  const entry = join(lily, 'dist', 'admin', 'index.html');
  try {
    await stat(entry);
  } catch {
    fail(`管理画面のビルド成果物が無い (${entry})`);
  }

  // **CMS 本体のビルド成果物 (`dist/lib`) があること。**
  //
  // lily の `exports` は `dist/lib` を指すので、`src/` を直しただけでは
  // 利用側に 1 バイトも届かない。無いまま進むと落ちるのは `wrangler` の
  // bundle で、「`@kanf/lily` を解決できない」としか出ない。
  //
  // **パスを書かず `exports` を引く。** 置き場所を変えた日に、この検査だけ
  // 古い場所を見続けるのを避ける。出口は 5 つあるが、どれも同じ `tsc` の
  // 1 回で出るので、バレルが解決できれば残りも揃っている。
  resolveOrFail(
    () => require.resolve('@kanf/lily'),
    'lily のビルド成果物が無い (@kanf/lily を解決できない)',
  );

  await checkFresh();

  // **lily の実行時依存 (hono / shiki / zod …) が解決できること。**
  //
  // npm から入れているあいだは npm が面倒を見るので、ここが落ちるのは
  // **lily をローカルの木へ向けているとき** —— あちらの依存は
  // `lily/node_modules` にしか入らないので、blog だけ `npm ci` した木では
  // bundle の段になって初めて `Could not resolve 'shiki'` で落ちる。
  // ここでは**先に分かる**ようにする。
  //
  // 名前は lily の `package.json` から取る（ここに書くと、依存を入れ替えた日に
  // この検査だけ古い名前を見続ける）。
  const manifest = JSON.parse(await readFile(join(lily, 'package.json'), 'utf8'));
  const [dependency] = Object.keys(manifest.dependencies ?? {});
  if (dependency === undefined) return;
  resolveOrFail(
    () => createRequire(join(lily, 'package.json')).resolve(dependency),
    `lily の依存が入っていない (${dependency} を解決できない)`,
  );
}

/**
 * 解決できなければ理由を付けて止める。**素の `ERR_MODULE_NOT_FOUND` を出さない。**
 *
 * このファイルの検査は 3 つとも「`resolve` して、駄目なら `fail()`」の形。
 * 素のまま投げると、`npm ci` を忘れただけの人にスタックトレースを読ませることになる。
 */
function resolveOrFail(resolve, reason) {
  try {
    return resolve();
  } catch {
    fail(reason); // 必ず throw する。
  }
}

/**
 * **`dist/lib` が lily の `src/` より古くないこと。**
 *
 * `exports` が `dist/lib` を指すので、lily の `.ts` を直してもビルドし直すまでは
 * ここに 1 バイトも届かない ―― **古い成果物に対してテストが通り、変更が
 * 検証されない。** `dist/admin` で同じことを踏んでいる（中断した vite build の
 * 残骸がそのまま配られた）ので、あちらは上で `index.html` の有無を見ている。
 *
 * **判定そのものは lily に置いてある。**「`src/` の何が `dist/lib` のどこに出るか」は
 * あちらのビルド設定が決めることで、こちらに写すと lily が運ぶものを増やした日に
 * ここだけ古くなる。
 *
 * **`scripts/` はパッケージに入らない**ので、このモジュールがあるのは lily を
 * ローカルの木へ向けているあいだだけ（`file:` や `npm link`）。npm から入れた
 * 普段の木には比べる相手の `src/` も無いので、そもそも出番がない。
 */
async function checkFresh() {
  const checker = join(lily, 'scripts', 'check-fresh.mjs');
  try {
    await stat(checker);
  } catch {
    return; // npm から入れた木。
  }

  // 理由は lily が組む。`fail()` が「lily をビルドし直せ」を後ろに足す。
  const { staleReason } = await import(pathToFileURL(checker).href);
  const reason = await staleReason();
  if (reason !== null) fail(reason);
}

function fail(reason) {
  throw new Error(
    `${reason}。@kanf/lily をローカルの木へ向けている（file: や npm link）なら、` +
      'あちらで `npm install && npm run build` を先に回すこと。' +
      '普段どおり npm から入れているなら `npm ci` をやり直す。',
  );
}
