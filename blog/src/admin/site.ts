/**
 * このデプロイのサイト設定。**`core/routes/admin.ts` が入口 HTML に差し込む。**
 *
 * ビルド成果物に焼かないのは `api.ts` の `MOUNT` と同じ理由（mount も設定も
 * deployment の持ち物で、管理画面の成果物はどこにマウントしても同じものを使う）。
 *
 * 読むのは 1 度だけ。設定が変わるのはデプロイのときで、そのとき HTML ごと入れ替わる。
 */
import { SITE_META, type AdminSiteMeta } from '../core/admin-contract.ts';
import { MOUNT } from './api.ts';

export type Site = AdminSiteMeta;

/**
 * 差し込みが無いとき（vite の生成物を直に開いたとき）の値。**ここで落とさない。**
 * 設定が読めないだけで編集できなくなる理由は無い。
 */
const FALLBACK: Site = {
  name: 'lily',
  description: '',
  author: '',
  url: location.origin,
};

export const SITE: Site = read();

/**
 * 画面に出すマウント位置。**root mount は空文字なので `/` と書く。**
 *
 * `MOUNT` から導く（設定として運ばない）。管理画面は自分がどこに配られたかを
 * `api.ts` で既に割り出していて、API のベース URL もそれで組んでいる。
 */
export const MOUNT_LABEL: string = MOUNT === '' ? '/' : MOUNT;

function read(): Site {
  const content = document.querySelector<HTMLMetaElement>(`meta[name="${SITE_META}"]`)?.content;
  if (!content) return FALLBACK;
  try {
    return { ...FALLBACK, ...(JSON.parse(content) as Partial<Site>) };
  } catch {
    return FALLBACK;
  }
}
