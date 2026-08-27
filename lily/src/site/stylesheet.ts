/**
 * 配信する 1 本のスタイルシート。
 *
 * `shared/tokens.css` は本体サイトと共有の**色とフォントの正本**で、`blog.css` は
 * ブログ側だけの見た目。Astro 版は `@import` で繋いでいたが、こちらはバンドルした
 * 文字列を配るので `@import` は解決されない。ここで連結する。
 *
 * トークンを先に置くこと。`blog.css` の `:root` が `--code-bg` などをトークンの
 * `light-dark()` の上に重ねる前提になっている。
 */
import tokens from '../../../shared/tokens.css';
import blog from './blog.css';

export const STYLESHEET = `${tokens}\n${blog}`;
