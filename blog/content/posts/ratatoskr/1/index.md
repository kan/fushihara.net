---
title: RSSリーダーを作った
date: 2026-08-23
tags:
  - dev
  - ratatoskr
description: ratatoskrというRSSリーダーを作り始めた。懐しのlivedoor Readerをイメージしつつ、自分の好みで既にだいぶ脱線している感。
---

[ratatoskr](https://github.com/kan/ratatoskr)というRSSリーダーを作り始めた。懐しのlivedoor Readerをイメージしつつ、
自分の好みで既にだいぶ脱線している感。ホスティングし易さを考えて最近もっぱら採用してるCloudflare Workersを使う形で
実装したので、クロールした記事はD1に入れてます。とりあえずPCもスマホもWebで、スマホはPWAでアプリっぽく見せる運用。

tokuhiromが[feedla](https://github.com/tokuhirom/feedla)作り始めた[^tokuhirom]のをみて作ってるけど、
だいぶ方向性が違ってて面白いと思いつつ、全文取得とか便利そうなものは参考にさせてもらってます。

[^tokuhirom]: https://blog.64p.org/entry/2026/08/17/122054