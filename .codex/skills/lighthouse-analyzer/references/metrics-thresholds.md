# Lighthouse メトリクス閾値リファレンス

## Core Web Vitals 閾値

| メトリクス | Good | Needs Improvement | Poor |
|-----------|------|-------------------|------|
| **LCP** | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| **FID** | ≤ 100ms | ≤ 300ms | > 300ms |
| **CLS** | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| **INP** | ≤ 200ms | ≤ 500ms | > 500ms |

## Lighthouse スコアリングメトリクス（v13）

| メトリクス | p10（Good） | median | ウェイト |
|-----------|------------|--------|---------|
| FCP | 1,800ms | 3,000ms | 10% |
| SI | 3,387ms | 5,800ms | 10% |
| LCP | 2,500ms | 4,000ms | 25% |
| TBT | 200ms | 600ms | 30% |
| CLS | 0.1 | 0.25 | 25% |

**スコア算出**: 各メトリクスをlog-normal分布でスコア化（0-1）し、ウェイトで加重平均。

## LCP サブパート基準値

| サブパート | 推奨値 | 注意が必要な場合 |
|-----------|--------|----------------|
| TTFB | ≤ 800ms | サーバーレスポンスが遅い、リダイレクトが多い |
| Resource load delay | ≤ 10ms（preload使用時） | preloadが効いていない、リソース発見が遅い |
| Resource load duration | 画像サイズ相応 | 優先度が低い（fetchpriority未設定）、リソースが大きすぎる |
| Element render delay | ≤ 50ms | レンダーブロッキングCSS/JS、JS依存のレンダリング |

**分析の流れ**: LCP Breakdownで最大のサブパートを特定 → LCP Discoveryで設定不備を確認 → ネットワーク優先度でリソースの優先度を確認

## ネットワーク優先度リファレンス

| リソースタイプ | 期待される優先度 | Lowの場合の原因 |
|--------------|----------------|---------------|
| Document | VeryHigh | - |
| CSS | VeryHigh | - |
| Font (preload) | High | preloadが効いていない |
| LCP Image | High | fetchpriority未設定、preload不備 |
| Script (async) | Low | 正常（asyncは低優先度が期待値） |
| Image (non-LCP) | Low | 正常 |

## 一般的な問題と改善策マッピング

### LCP改善

| 原因 | 対策 |
|------|------|
| 画像が大きい | レスポンシブ画像（srcSet + sizes）、WebP/AVIF変換、品質調整 |
| 画像発見が遅い | `<link rel="preload">`、fetchpriority="high" |
| レンダーブロッキングリソース | CSS分割、クリティカルCSS inline化、JS defer/async |
| サーバーレスポンスが遅い | CDN、キャッシュ、サーバー最適化 |
| クライアントサイドレンダリング | SSR/SSG、プリレンダリング |

### TBT/TTI改善

| 原因 | 対策 |
|------|------|
| 未使用JavaScript | Tree shaking、コード分割、動的import |
| Legacy JavaScript | browserslist更新、polyfill削除 |
| 巨大なメインスレッドタスク | Web Worker、requestIdleCallback、タスク分割 |
| サードパーティスクリプト | defer/async、Partytown、条件付き読み込み |

### CLS改善

| 原因 | 対策 |
|------|------|
| 画像サイズ未指定 | width/height属性、aspect-ratio CSS |
| 動的コンテンツ挿入 | min-height予約、content-visibility |
| Webフォント | font-display: swap/optional、preload |
| 広告/iframe | 固定サイズコンテナ |

### 画像最適化

| フォーマット | 用途 | 品質目安 |
|-------------|------|---------|
| WebP | 写真・一般 | 75-85 |
| AVIF | 写真（最高圧縮） | 60-75 |
| PNG | ロゴ・アイコン・透過 | - |
| SVG | アイコン・図形 | - |

### フレームワーク固有の最適化

#### Next.js (App Router / Static Export)

- `images: { unoptimized: true }` の場合、`next/image`はsrcSet生成しない → 手動srcSetが必要
- Server Componentsの活用で不要な'use client'を除去 → クライアントバンドル削減
- `@next/bundle-analyzer`でバンドル構成を確認
- Turbopack vs webpack: Turbopackの方がチャンクが小さい傾向
- RSCペイロードがHTMLにインライン化される → HTMLサイズに注意

#### 一般的なStatic Site

- .htaccess / nginx でキャッシュヘッダー設定（アセット: 1年、HTML: 短期）
- Brotli/gzip圧縮の有効化
- CDN配信の検討
