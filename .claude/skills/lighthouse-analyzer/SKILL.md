---
name: lighthouse-analyzer
description: Lighthouse JSONレポートの分析と改善提案。Lighthouse結果の分析、パフォーマンス改善の提案が必要な場合に使用。ユーザーが「Lighthouseの結果を分析して」「パフォーマンスを分析して」「lighthouse JSONを見て」と依頼した場合、またはLighthouse JSONファイルパスが引数として渡された場合にトリガー。
---

# Lighthouse Analyzer

Lighthouse JSONレポートを分析し、構造化されたパフォーマンスレポートと改善提案を提供する。

## ワークフロー

### 1. JSONレポートの解析

分析スクリプトを実行してレポートを生成する（パスはスキル配置先に応じて読み替える）:

```bash
node .claude/skills/lighthouse-analyzer/scripts/analyze-lighthouse.mjs <json-path>
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

Lighthouseのスコアウェイトを意識する: **TBT 30% > LCP 25% = CLS 25% > FCP 10% = SI 10%**

### 3. 改善提案

問題点ごとに具体的な改善策を提案する。メトリクス閾値と一般的な対策は [references/metrics-thresholds.md](references/metrics-thresholds.md) を参照。Lighthouseのメジャーバージョン更新時はスコアウェイトの変更有無を確認し、references を更新する。

提案時の原則:
- フレームワーク固有の制約を考慮する（例: Next.js static exportではImage最適化が使えない）
- 改善効果の大きいものから順に提案する
- 各提案に期待される改善効果（削減量やスコア影響）を添える
- アプリケーションコード起因か、フレームワーク起因かを区別する

## 出力形式

ユーザーへの報告は以下の構造で行う:

1. **スコアサマリー**: カテゴリスコアとCWV一覧
2. **最重要課題**: LCPなど最もスコア影響が大きい問題を1-2個ピックアップ
3. **問題点一覧**: 優先度順の問題と改善策
4. **次のアクション**: 具体的な改善手順（実装するか、プラン作成スキルに委譲するか）

## データ保存規約

Lighthouse JSONファイルは `ai/data/lighthouse/` に保存する。命名規則:

```
{ドメイン}-{YYYYMMDDTHHmmss}.json
```

例: `www.example.com-20260211T111924.json`
