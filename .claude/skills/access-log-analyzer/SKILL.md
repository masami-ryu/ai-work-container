---
name: access-log-analyzer
description: Webサーバーのアクセスログ（Apache/Nginx Combined Log Format）を分析し、構造化レポートを生成するスキル。ユーザーが「アクセスログを分析して」「access_logを見て」「ログファイルを解析して」「サーバーログを確認して」と依頼した場合、またはアクセスログファイルのパスが引数として渡された場合にトリガー。GA4やアプリケーションログの分析には使用しない。
---

# Access Log Analyzer

Webサーバーのアクセスログを解析し、ページアクセス・流入元・デバイス・BOT・セキュリティの各観点で分析レポートを生成する。

## ワークフロー

### Step 1: スクリプト実行でデータ収集

`scripts/analyze_access_log.sh` を実行して生データを取得する。.gzファイルは自動展開される。

```bash
# 基本
bash /home/vscode/.claude/skills/access-log-analyzer/scripts/analyze_access_log.sh <logfile>

# 時間帯フィルタ（改修前後の比較等に使用）
bash .../analyze_access_log.sh <logfile> --from 22        # 22:00以降のみ
bash .../analyze_access_log.sh <logfile> --to 22          # 22:00より前のみ
bash .../analyze_access_log.sh <logfile> --from 9 --to 18 # 9:00～18:00
```

スクリプトが出力するセクション:
- 基本情報（総リクエスト数、ユニークIP、フォーマット検出結果）
- ページ別アクセス数 / ユニークIP
- IPアドレス別アクセス数
- 時間帯別アクセス数
- HTTPステータスコード / メソッド
- 外部リファラー
- デバイス分析 / デバイス分析（BOT除外）
- BOT/クローラー
- 4xx/5xxエラー詳細
- 不正アクセス試行（.php/wp-*探索）
- 広告パラメータ付きアクセス（ページリクエストのみ）
- トップページへの流入元（クエリ付きURLを含む）

スクリプトはログからサイトドメインを自動取得し、リファラー除外に使用する。

#### コンテキスト付き分析

ユーザーが改修時刻やイベント等のコンテキストを提供した場合:

1. `--from`/`--to` でスクリプトを複数回実行し、改修前後のデータを個別に取得
2. レポートに比較分析セクションを追加（テンプレートの「改修前後の比較」参照）
3. 改修に起因する変化（キャッシュリセット、新アセット配信等）と通常変動を区別して考察

### Step 2: レポート作成

`references/report_template.md` のテンプレートに従い、スクリプト出力を以下の観点で整理・考察する。

#### 分析観点と着眼点

| セクション | 着眼点 |
|-----------|--------|
| ページ別アクセス | 主要ページのPV/UU、広告ランディングページの特定 |
| 流入元 | Google/Yahoo/SNS等の内訳、広告(gclid/wbraid/gbraid)の割合 |
| 時間帯 | ピーク時間帯の特定、業種特性との整合性 |
| デバイス | モバイル/PC比率、iPhoneとAndroidの比率 |
| ステータスコード | 304(キャッシュ)の割合、404の原因分類 |
| BOT | 検索エンジンBOT、SNSクローラー、セキュリティスキャナーの分類 |
| セキュリティ | WordPress攻撃パターン、シェル探索、機密ファイルアクセスの検出 |
| 改善提案 | HIGH/MEDIUM/LOWの優先度付きで具体的なアクション提示 |

#### BOT判定パターン

以下のUA文字列でBOTを分類する:
- **Google**: Googlebot, AdsBot-Google, GoogleOther, Google Maps
- **Microsoft**: Bingbot
- **Meta**: facebookexternalhit, meta-externalads
- **AI検索**: OAI-SearchBot, GPTBot, ChatGPT, ClaudeBot
- **Apple/Amazon等**: Applebot, DuckDuckBot, Amazonbot
- **SEOツール**: SERankingBacklinksBot, Semrush, Ahrefs
- **セキュリティ**: Palo Alto Networks

#### 不正アクセスの分類

404応答のパスを以下のカテゴリに分類する:
- **WordPress脆弱性**: `wp-*`, `xmlrpc*`
- **シェル/バックドア**: `shell.php`, `admin.php`, `filemanager.php`, `alfa.php`
- **設定ファイル**: `.git/config`, `php.ini`, `wp-config.php`
- **既知の攻撃ツール**: `ALFA_DATA/`, `pwnd/`, `hellopress/`

### Step 3: レポート保存

レポートを `ai/reviews/YYMMDD_HHmm_[ログファイル名]_分析.md` に保存する。
