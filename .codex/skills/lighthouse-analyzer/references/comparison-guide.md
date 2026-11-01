# Lighthouse比較分析ガイド

## 中央値ラン選定

- Performance スコアで全ランをソートし、下側中央値 `index = floor((n-1)/2)` を採用
- 2回: 低い方（保守的）、3回: 中央、5回: 中央
- **全メトリクスを中央値ランから取得**（メトリクスごとに別ランから取る混合は行わない）

## 外れ値検出

- Performance スコアが中央値から 20 ポイント以上乖離したランを外れ値とする
- 外れ値の原因推定: LCP Breakdown の各サブパートを比較し、最大差のサブパートを特定
  - Element render delay が突出 → メインスレッドブロック（第三者タグ等）
  - TTFB が突出 → サーバー側の一時的な遅延
  - Resource load duration が突出 → ネットワーク帯域の変動

## ベースライン比較の解釈

### スコア系（Performance, Best Practices等）

- 正の変化 = 改善、負の変化 = 劣化
- 例: Performance 80 → 96 = +16 (改善)

### 時間系（LCP, FCP, TBT, TTI等）

- 負の変化 = 改善（短縮）、正の変化 = 劣化（増加）
- 例: LCP 4,900ms → 2,151ms = -2,749ms (改善)

### CLS

- 0に近いほど良い。増加は劣化

## ベースライン指定方法

### JSONファイル（推奨）

```bash
node compare-lighthouse.mjs run1.json run2.json run3.json \
  --baseline baseline1.json baseline2.json baseline3.json
```

ベースライン側も中央値を自動選定して比較。

### 手動値

```bash
node compare-lighthouse.mjs run1.json run2.json run3.json \
  --baseline-values "Performance:80,LCP:4900,FCP:1800,TBT:110,CLS:0.002,TTI:8400,BestPractices:58"
```

キー一覧: `Performance`, `LCP`, `FCP`, `SI`, `TBT`, `CLS`, `TTI`, `BestPractices`, `Accessibility`, `SEO`
（スコア系は0-100で指定、時間系はms、CLSは小数）

## 第三者タグ影響の分析

app-only計測（GTMなし）と production計測（GTMあり）を比較する場合:

- TBT の差分 ≒ 第三者タグのメインスレッド時間
- Best Practices の差分 → 第三者タグ由来の監査失点
- LCP の差分 → 通常は小さい（圧縮が効いていれば第三者タグの前にLCP要素がレンダリング完了）
- 差分が大きい場合は外れ値（第三者タグのメインスレッド占有が偶発的に重なった）の可能性

## レポートの活用

比較スクリプトの出力は以下の用途に使用:

1. **計測結果レポート**: `ai/reviews/` に保存し、プランの TEST ケース結果として記録
2. **改善効果の定量化**: ベースライン比較でアプリ側施策の効果を証明
3. **第三者タグ影響の根拠**: GTMタグ最適化の運用依頼に添付
