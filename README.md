# fushihara.net

Source code for [https://fushihara.net/](https://fushihara.net/) — a personal portfolio site built with [@kanf/wema](https://www.npmjs.com/package/@kanf/wema), a sticky-note board library.

## Tech Stack

- TypeScript + Vite
- Cloudflare Workers (Static Assets)
- [wema](https://github.com/kan/wema) for the board UI
- Astro for the blog under `/blog/` (a separate Worker; see `blog/`)

## Development

```bash
npm install
npm run dev     # localhost:5173 (Vite + workerd via @cloudflare/vite-plugin)
```

`/api/*` runs on the real Workers runtime in dev, so the Zenn / GitHub proxies work locally.

The blog is an independent project with its own dependencies:

```bash
cd blog
npm install
npm run dev     # localhost:4321/blog/
```

## Deploy

```bash
npm run deploy          # portfolio  → Worker: fushihara-net
cd blog && npm run deploy  # blog     → Worker: fushihara-net-blog
```

Pushing to `main` deploys via GitHub Actions. The two Workers have separate workflows,
so a new blog post does not redeploy the portfolio.
