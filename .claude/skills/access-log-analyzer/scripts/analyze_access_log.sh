#!/bin/bash
# アクセスログ解析スクリプト
# 対応フォーマット: Combined Log Format（ホスト名プレフィックス有無両対応）
# 対応ファイル: プレーンテキスト / .gz
#
# Usage: analyze_access_log.sh <logfile> [--from HH] [--to HH]
#   --from HH  指定時刻以降のログのみ対象（例: --from 22 → 22:00以降）
#   --to HH    指定時刻より前のログのみ対象（例: --to 22 → 22:00より前）
# Output: 各セクションをヘッダー付きで標準出力

set -euo pipefail

LOG="${1:?Usage: analyze_access_log.sh <logfile> [--from HH] [--to HH]}"
shift

FROM_HOUR=0
TO_HOUR=24
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM_HOUR="$2"; shift 2;;
    --to) TO_HOUR="$2"; shift 2;;
    *) shift;;
  esac
done

ORIGINAL_LOG="$LOG"

if [ ! -f "$ORIGINAL_LOG" ]; then
  echo "Error: File not found: $ORIGINAL_LOG" >&2
  exit 1
fi

# --- 一時ファイル管理 ---
CLEANUP_FILES=()
trap 'rm -f "${CLEANUP_FILES[@]}"' EXIT

# --- .gz自動展開 ---
if [[ "$LOG" == *.gz ]]; then
  TMPGZ=$(mktemp)
  CLEANUP_FILES+=("$TMPGZ")
  zcat "$LOG" > "$TMPGZ"
  LOG="$TMPGZ"
fi

# --- 時間帯フィルタ ---
if [[ "$FROM_HOUR" -ne 0 || "$TO_HOUR" -ne 24 ]]; then
  TMPTIME=$(mktemp)
  CLEANUP_FILES+=("$TMPTIME")
  awk -v from="$FROM_HOUR" -v to="$TO_HOUR" '{
    if (match($0, /\[[0-9][0-9]\/[A-Za-z]+\/[0-9]+:/)) {
      h = substr($0, RSTART + RLENGTH, 2) + 0
      if (h >= from + 0 && h < to + 0) print
    }
  }' "$LOG" > "$TMPTIME"
  LOG="$TMPTIME"
fi

if [[ ! -s "$LOG" ]]; then
  echo "Warning: フィルタ条件に一致するログがありません" >&2
  exit 0
fi

TOTAL=$(wc -l < "$LOG")

# --- フォーマット自動検出 ---
# 先頭行の第1フィールドがIPv4アドレスならホスト名なし、そうでなければホスト名付き
FIRST_FIELD=$(head -1 "$LOG" | awk '{print $1}')
if echo "$FIRST_FIELD" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  IP_FIELD=1
  HAS_HOST="no"
else
  IP_FIELD=2
  HAS_HOST="yes"
fi

# --- サイトドメイン自動取得（リファラー除外用）---
if [ "$HAS_HOST" = "yes" ]; then
  SITE_DOMAIN=$(head -1 "$LOG" | awk '{print $1}' | sed 's/\./\\./g')
else
  SITE_DOMAIN=$(awk -F'"' '{ref=$4; if(ref ~ /^https?:\/\//) {split(ref,u,"/"); print u[3]; exit}}' "$LOG" | sed 's/\./\\./g')
fi

TIME_LABEL=""
if [[ "$FROM_HOUR" -ne 0 || "$TO_HOUR" -ne 24 ]]; then
  TIME_LABEL=" [フィルタ: ${FROM_HOUR}時～${TO_HOUR}時]"
fi

echo "===== 基本情報 ====="
echo "ファイル: $ORIGINAL_LOG${TIME_LABEL}"
echo "総リクエスト数: $TOTAL"
echo "フォーマット: $([ "$HAS_HOST" = "yes" ] && echo "ホスト名付きCombined" || echo "標準Combined")"
echo "ユニークIP数: $(awk -v f="$IP_FIELD" '{print $f}' "$LOG" | sort -u | wc -l)"
FIRST_TS=$(head -1 "$LOG" | grep -oE '\[[^]]+\]' | tr -d '[]')
LAST_TS=$(tail -1 "$LOG" | grep -oE '\[[^]]+\]' | tr -d '[]')
echo "期間: $FIRST_TS ~ $LAST_TS"
echo "サイトドメイン: ${SITE_DOMAIN//\\./\.}"
echo ""

echo "===== ページ別アクセス数（静的アセット除外）====="
# 除外対象: 静的ファイル拡張子 + Next.js固有パス(_next/, __next, ?_rsc=)
awk -F'"' '{
  split($2, a, " ")
  path = a[2]
  if (path !~ /\.(js|css|woff2?|avif|png|ico|svg|jpg|jpeg|webp|gif)$/ &&
      path !~ /_next\// && path !~ /__next/ && path !~ /\?_rsc=/)
    print path
}' "$LOG" | sort | uniq -c | sort -rn | head -20
echo ""

echo "===== ページ別ユニークIP ====="
awk -v f="$IP_FIELD" -F'"' '{
  # IPを元の行から抽出
  split($0, raw, "\"")
  split(raw[1], hdr, " ")
  ip = hdr[f]
  split($2, a, " ")
  path = a[2]
  if (path !~ /\.(js|css|woff2?|avif|png|ico|svg|jpg|jpeg|webp|gif)$/ &&
      path !~ /_next\// && path !~ /__next/ && path !~ /\?_rsc=/)
    print ip, path
}' "$LOG" | sort -u | awk '{print $2}' | sort | uniq -c | sort -rn | head -20
echo ""

echo "===== IPアドレス別アクセス数 TOP15 ====="
awk -v f="$IP_FIELD" '{print $f}' "$LOG" | sort | uniq -c | sort -rn | head -15
echo ""

echo "===== 時間帯別アクセス数 ====="
awk -F'[/:]' '{for(i=1;i<=NF;i++) if(length($i)==4 && $i+0>1900) {print $(i+1); break}}' "$LOG" | sort | uniq -c | sort -k2n
echo ""

echo "===== HTTPステータスコード別 ====="
awk -F'"' '{gsub(/^ +| +$/, "", $3); split($3, a, " "); print a[1]}' "$LOG" | sort | uniq -c | sort -rn
echo ""

echo "===== HTTPメソッド別 ====="
awk -F'"' '{split($2, a, " "); print a[1]}' "$LOG" | sort | uniq -c | sort -rn
echo ""

echo "===== 外部リファラー（流入元）====="
# $4 = リファラーフィールド（awk -F'"' で分割時）
# SITE_DOMAIN はログから自動取得済み
awk -v domain="$SITE_DOMAIN" -F'"' '{ref=$4; if(ref != "-" && ref != "" && ref !~ domain) print ref}' "$LOG" \
  | sort | uniq -c | sort -rn | head -15
echo ""

echo "===== デバイス分析 ====="
echo -n "iPhone: "; grep -c 'iPhone' "$LOG" || true
echo -n "Android: "; grep -c 'Android' "$LOG" || true
echo -n "Windows: "; grep -c 'Windows NT' "$LOG" || true
echo -n "Macintosh: "; grep -c 'Macintosh' "$LOG" || true
echo ""

echo "===== デバイス分析（BOT除外）====="
awk -F'"' '{
  ua = $6
  if (ua !~ /[Bb]ot|[Cc]rawl|[Ss]pider|facebook|meta-external|OAI-Search|GPTBot|ChatGPT|ClaudeBot|Semrush|Ahref|Go-http-client|Palo Alto|Gensparkbot/) {
    if (ua ~ /iPhone/) iphone++
    else if (ua ~ /Android/) android++
    else if (ua ~ /Windows NT/) windows++
    else if (ua ~ /Macintosh/) mac++
  }
}
END {
  print "iPhone: " iphone+0
  print "Android: " android+0
  print "Windows: " windows+0
  print "Macintosh: " mac+0
}' "$LOG"
echo ""

echo "===== BOT/クローラー ====="
awk -F'"' '{
  ua = $6
  if (ua ~ /[Bb]ot|[Cc]rawl|[Ss]pider|facebook|Googlebot|Bingbot|Semrush|Ahref|Yandex|Bytespider|Petalbot|meta-external|facebookexternalhit|Go-http-client|OAI-SearchBot|GPTBot|ChatGPT|ClaudeBot|Applebot|DuckDuckBot|Amazonbot|GoogleOther|AdsBot|Palo Alto|Gensparkbot/)
    print ua
}' "$LOG" | sort | uniq -c | sort -rn
echo ""

echo "===== 4xx/5xxエラー詳細 ====="
awk -F'"' '{
  gsub(/^ +| +$/, "", $3)
  split($3, a, " ")
  status = a[1]
  if (status+0 >= 400) {
    split($2, r, " ")
    print status, r[2]
  }
}' "$LOG" | sort | uniq -c | sort -rn | head -30
echo ""

echo "===== 不正アクセス試行（.php/wp-*探索）====="
awk -F'"' '{
  split($2, a, " ")
  path = a[2]
  if (path ~ /\.php/ || path ~ /wp-/ || path ~ /xmlrpc/ || path ~ /\.git\//)
    print path
}' "$LOG" | sort | uniq -c | sort -rn | head -30
echo ""

echo "===== 広告パラメータ付きアクセス（ページリクエストのみ）====="
awk -F'"' '{
  split($2, a, " ")
  path = a[2]
  if (path !~ /\.(js|css|woff2?|avif|png|ico|svg|jpg|jpeg|webp|gif|map)$/ &&
      path !~ /_next\// && path !~ /__next/ && path !~ /\?_rsc=/) {
    if (path ~ /gad_campaignid/) gc++
    if (path ~ /gclid=/) gl++
    if (path ~ /wbraid=/) wb++
    if (path ~ /gbraid=/) gb++
    if (path ~ /utm_/) ut++
  }
}
END {
  print "gad_campaignid: " gc+0
  print "gclid: " gl+0
  print "wbraid: " wb+0
  print "gbraid: " gb+0
  print "utm_: " ut+0
}' "$LOG"
echo ""

echo "===== トップページ(/)への流入元 ====="
awk -F'"' '{
  split($2, a, " ")
  if (a[2] ~ /^\/($|\?)/) {
    ref = $4
    if (ref != "" && ref != "-")
      print ref
  }
}' "$LOG" | sort | uniq -c | sort -rn | head -15
