---
title: リンクカードのある記事
date: 2026-08-18
tags:
  - fixture
description: 貼った URL をカードにしたときの描画とフィードを見るための固定物。
public_id: 00000000-0000-4000-8000-000000000008
---

このファイルは **E2E のフィクスチャ**であって記事ではない。`e2e/blog.spec.ts`
の「リンクカード」の節がここの中身に依存しているので、書き換えるときはテストも
一緒に直すこと。

カードは管理画面が組んで本文へ入れる生 HTML（`core/link-card.ts`）。**ここに直接
書いてあるのは、出来上がりが記事とフィードでどう出るかだけを見たいから。**

<a class="link-card" href="https://example.com/x">
  <img class="link-card-thumb" src="./card-example-com-0a1b2c3d.png" alt="" width="96" height="48" loading="lazy" decoding="async">
  <span class="link-card-text">
    <span class="link-card-title">相手の題</span>
    <span class="link-card-desc">相手の説明</span>
    <span class="link-card-site">example.com</span>
  </span>
</a>

カードの後ろの段落。カードが段落に飲まれていないことがここで分かる。
