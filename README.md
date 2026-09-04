# fushihara.net

Source code for [https://fushihara.net/](https://fushihara.net/) — a personal portfolio site built with [@kanf/wema](https://www.npmjs.com/package/@kanf/wema), a sticky-note board library.

## Tech Stack

- TypeScript + Vite
- Cloudflare Workers (Static Assets)
- [wema](https://github.com/kan/wema) for the board UI
- lily — a home-grown CMS (Hono + D1 + R2) serving the blog under `/blog/`
  (a separate Worker; see `blog/`)

## Development

```bash
npm install
npm run dev     # localhost:5173 (Vite + workerd via @cloudflare/vite-plugin)
```

`/api/*` runs on the real Workers runtime in dev, so the blog / GitHub proxies work locally.

The blog is an independent project with its own dependencies:

```bash
cd blog
npm install
npm run db:migrate:local   # local D1
npm run db:seed:local      # sample posts
npm run build              # wrangler serves dist/, so this is required
npm run dev                # localhost:8787/blog/
```

Posts live in D1, not in this repository, so writing one takes no commit.
The admin UI is at `/blog/admin/` (open locally without Cloudflare Access).

## Deploy

```bash
npm run deploy             # portfolio → Worker: fushihara-net
cd blog && npm run deploy  # blog      → Worker: fushihara-blog
```

Pushing to `main` deploys via GitHub Actions. The two Workers have separate workflows,
so a change under `blog/` does not redeploy the portfolio.
