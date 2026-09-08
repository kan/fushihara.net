import { applyTestMigrations } from '@kanf/lily/test-support';

// スキーマの正は lily。**バインディングの名前も lily の持ち物**なので、
// `vitest.config.ts` が渡す名前と受け取る側がずれようがない。
await applyTestMigrations();
