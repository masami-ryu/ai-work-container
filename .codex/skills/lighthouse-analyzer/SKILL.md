---
name: lighthouse-analyzer
description: Lighthouse JSONレポートの分析と改善提案。Lighthouse結果の分析、パフォーマンス改善の提案が必要な場合に使用。ユーザーが「Lighthouseの結果を分析して」「パフォーマンスを分析して」「lighthouse JSONを見て」と依頼した場合、またはLighthouse JSONファイルパスが引数として渡された場合にトリガー。複数JSONの比較分析（ベースライン対応）、「計測結果を比較して」「TEST-xxxを分析して」といった依頼にも対応。
---

# Lighthouse Analyzer

Lighthouse JSONレポートを分析し、構造化されたパフォーマンスレポートと改善提案を提供する。
単一JSONの分析と、複数JSONの比較分析の2モードに対応。

## モード判定

- **JSON 1件** → 単一分析（ワークフロー A）
- **JSON 2件以上** → 比較分析（ワークフロー B）

## ワークフロー A: 単一分析

### 1. JSONレポートの解析

分析スクリプトを実行してレポートを生成する（パスはこの SKILL.md と同階層の `scripts/` を使用）:

```bash
node scripts/analyze-lighthouse.mjs <json-path>
```

出力はMarkdown形式。内容:
- カテゴリスコア（Performance / Accessibility / Best Practices / SEO）
- Core Web Vitals & キーメトリクス
- **LCP Breakdown**（TTFB / Resource load delay / Resource load duration / Element render delay）
- LCP要素の特定（snippet / selector）
- **LCP Discovery チェックリスト**（fetchpriority / preload / eager loading）
- **Document Latency チェックリスト**（圧縮 / リダイレクト / サーバーレスポンス）
- 問題点の一覧（スコア順）と詳細（リソース別のサイズ・削減可能量）
- **ネットワーク優先度サマリー**（リソースタイプ別の通信優先度、LCP画像の低優先度警告）
- ネットワークサマリー

### 2. 問題点の優先順位付け

スクリプト出力を基に、以下の順で改善インパクトを評価する:

1. **LCPに直結する問題**（LCP Breakdownで最大のサブパートを特定 → LCP Discoveryで設定不備を確認 → ネットワーク優先度でリソースの優先度を確認）
2. **TBT/TTIに影響する問題**（未使用JS、Legacy JS、サードパーティスクリプト）
3. **転送サイズ削減**（画像配信改善、CSS/JS最適化）
4. **その他**（A11y、SEO、Best Practices）

スコアウェイトは [references/metrics-thresholds.md](references/metrics-thresholds.md) を参照

### 3. 改善提案

問題点ごとに具体的な改善策を提案する。メトリクス閾値と一般的な対策は [references/metrics-thresholds.md](references/metrics-thresholds.md) を参照。Lighthouseのメジャーバージョン更新時はスコアウェイトの変更有無を確認し、references を更新する。

提案時の原則:
- フレームワーク固有の制約を考慮する（例: Next.js static exportではImage最適化が使えない）
- 各提案に期待される改善効果（削減量やスコア影響）を添える

### 4. 出力

1. **スコアサマリー**: カテゴリスコアとCWV一覧
2. **最重要課題**: LCPなど最もスコア影響が大きい問題を1-2個ピックアップ
3. **問題点一覧**: 優先度順の問題と改善策
4. **次のアクション**: 具体的な改善手順（実装するか、プラン作成スキルに委譲するか）

## ワークフロー B: 比較分析

### 1. 比較レポートの生成

比較スクリプトを実行（パスはこの SKILL.md と同階層の `scripts/` を使用）:

```bash
# 基本（ベースラインなし）
node scripts/compare-lighthouse.mjs <json1> <json2> [json3...]

# ベースラインJSONファイル指定
node scripts/compare-lighthouse.mjs <json1> <json2> [json3...] \
  --baseline <baseline1.json> [baseline2.json ...]

# ベースライン値を手動指定
node scripts/compare-lighthouse.mjs <json1> <json2> [json3...] \
  --baseline-values "Performance:80,LCP:4900,TBT:110,CLS:0.002"
```

出力はMarkdown形式。内容:
- 全計測データの比較テーブル（中央値ラン自動選定）
- 外れ値検出とLCP Breakdown比較による原因推定
- ベースライン比較（変化量・変化率）
- 第三者タグ影響サマリー
- 未使用JS一覧（自サイト/第三者の分類付き）

### 2. スクリプト出力の分析

スクリプト出力を基に以下を評価:

1. **中央値ランの妥当性**: 外れ値が検出された場合、その原因（第三者タグ、ネットワーク、サーバー）を考察
2. **ベースライン比較の解釈**: スコア系は正の変化が改善、時間系は負の変化が改善。[references/comparison-guide.md](references/comparison-guide.md) 参照
3. **第三者タグの影響**: app-only と production の差分からタグ由来の負荷を定量化
4. **成功基準の判定**: プランの TEST ケースや成功基準と照合し PASS/FAIL を判定

### 3. レポート出力

スクリプト出力をベースに、以下の構造でレポートを完成:

1. **計測概要**: URL・計測回数・中央値ラン
2. **ベースライン比較結果**: 変化量・変化率の解釈
3. **成功基準判定**: プランの TEST ケースに対する PASS/FAIL
4. **差分分析**: app-only と production の差分（両方ある場合）
5. **推奨アクション**: 残タスク、運用依頼事項

## データ保存規約

Lighthouse JSONファイルは `ai/data/lighthouse/` に保存する。命名規則:

```
{ドメイン}-{YYYYMMDDTHHmmss}.json
```

例: `www.example.com-20260211T111924.json`
