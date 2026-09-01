/**
 * fushihara.net の設定。**`core/` はここを知らない。**
 */
import { createLily } from './core/app.ts';
import type { BlueskyCredentials } from './core/bluesky.ts';
import { cloudflareAccess } from './core/auth/access.ts';
import { localhostOnly } from './core/auth/localhost.ts';
import { MOUNT_PATH, SITE } from './site/meta.ts';
import { theme } from './site/theme.ts';

export const lily = createLily({
  site: SITE,
  // route (wrangler.jsonc) と必ずセットで見ること。
  mountPath: MOUNT_PATH,
  theme,
  // 画像は配信時に WebP / AVIF へ変換する。**無効にしても URL は変わらず、
  // 原本がそのまま出る**（Images の設定・quota・障害に記事を巻き込まない）。
  media: { images: true },
  // 管理画面と管理 API は Cloudflare Access の手前で止まる。ここでの検証は
  // 二重の守りで、Access を経由しない経路で開かないようにするためのもの。
  // チーム名と AUD は wrangler.jsonc の vars（deployment 固有の値）。
  //
  // 設定が無いときは localhostOnly に落ちる。**これは本番を開けない**:
  // host が localhost 以外なら必ず拒否するので、設定を入れ忘れたまま公開しても
  // 管理画面には入れない（fail closed のまま）。Access を手元で再現できないので、
  // これが無いと管理画面をローカルで一度も開けない。
  auth: (env: Env) => selectAuth(env),
  // Bluesky の告知。**未設定でも動く**（管理画面のボタンが「未設定」を返す）。
  bluesky: (env: Env) => blueskyCredentials(env),
});

/**
 * Bluesky の資格情報。**両方揃っているときだけ**告知できる。
 *
 * ハンドルは秘密ではないので `wrangler.jsonc` の `vars`、App Password は
 * `wrangler secret put BLUESKY_APP_PASSWORD`。**アカウントのパスワードを
 * 入れない**（App Password は Bluesky の設定画面からいつでも失効させられる）。
 *
 * ローカルと CI では `.dev.vars` が両方を空にするので、必ず null になる
 * （手元の操作が本物のタイムラインへ流れない）。
 */
export function blueskyCredentials(env: {
  BLUESKY_IDENTIFIER?: string;
  BLUESKY_APP_PASSWORD?: string;
}): BlueskyCredentials | null {
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_APP_PASSWORD) return null;
  return { identifier: env.BLUESKY_IDENTIFIER, appPassword: env.BLUESKY_APP_PASSWORD };
}

/**
 * どちらのアダプタを使うか。**両方揃っているときだけ** Access。
 *
 * 片方だけ設定した状態で「Access が効いているつもり」になるのが一番危ないので、
 * 判定は 1 箇所に置き、テストから直接読めるようにしてある。
 */
export function authMode(env: {
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
}): 'access' | 'localhost' {
  return env.ACCESS_TEAM && env.ACCESS_AUD ? 'access' : 'localhost';
}

/** isolate ごとに 1 度だけ出す。リクエストごとに出しても読めないため。 */
let announced = false;

function selectAuth(env: Env) {
  const mode = authMode(env);
  if (!announced) {
    announced = true;
    console.info(
      mode === 'access'
        ? 'lily auth: Cloudflare Access'
        : 'lily auth: localhostOnly（ACCESS_TEAM / ACCESS_AUD が未設定。本番では管理画面が開かない）',
    );
  }
  return mode === 'access'
    ? cloudflareAccess({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD })
    : localhostOnly();
}
