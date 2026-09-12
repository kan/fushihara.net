import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [label, width, theme] of [['dark', 900, 'dark'], ['light', 900, 'light'], ['narrow', 380, 'dark']]) {
  const p = await b.newPage({ colorScheme: theme, viewport: { width, height: 700 } });
  await p.goto('http://localhost:8788/blog/');
  const f = p.locator('.site-footer');
  await f.scrollIntoViewIfNeeded();
  const box = await f.boundingBox();
  console.log(label, `h=${Math.round(box.height)}`, JSON.stringify(await f.innerText()));
  await f.screenshot({ path: `/tmp/claude-1000/f2-${label}.png` });
  await p.close();
}
await b.close();
