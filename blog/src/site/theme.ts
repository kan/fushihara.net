/**
 * fushihara.net のブログとしてのテーマ。`core` はこの形しか知らない。
 */
import type { Theme } from '@kanf/lily';
import { indexPage, notFoundPage, postPage, tagPage } from './pages.ts';
import { STYLESHEET } from './stylesheet.ts';

export const theme: Theme = {
  stylesheet: STYLESHEET,
  index: indexPage,
  post: postPage,
  tag: tagPage,
  notFound: notFoundPage,
};
