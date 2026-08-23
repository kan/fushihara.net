# fushihara.net

Source code for [https://fushihara.net/](https://fushihara.net/) — a personal portfolio site built with [@kanf/wema](https://www.npmjs.com/package/@kanf/wema), a sticky-note board library.

## Tech Stack

- TypeScript + Vite
- Cloudflare Workers (Static Assets)
- [wema](https://github.com/kan/wema) for the board UI

## Development

```bash
npm install
npm run dev     # localhost:5173 (Vite + workerd via @cloudflare/vite-plugin)
```

`/api/*` runs on the real Workers runtime in dev, so the Zenn / GitHub proxies work locally.

## Deploy

```bash
npm run deploy  # builds and deploys to Cloudflare Workers
```

Pushing to `main` deploys via GitHub Actions.
