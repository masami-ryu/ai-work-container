#!/usr/bin/env node
/**
 * Lighthouse JSON分析スクリプト
 *
 * Lighthouse JSONレポートからパフォーマンスメトリクス、問題点、改善提案を抽出する。
 *
 * 使用方法:
 *   node analyze-lighthouse.mjs <lighthouse-json-path>
 *
 * 出力: 構造化されたMarkdown形式のレポート
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const jsonPath = process.argv[2]
if (!jsonPath) {
  console.error('Usage: node analyze-lighthouse.mjs <lighthouse-json-path>')
  process.exit(1)
}

const data = JSON.parse(readFileSync(jsonPath, 'utf8'))

// --- ヘルパー ---
function fmt(score) {
  if (score === null || score === undefined) return '-'
  return (score * 100).toFixed(0)
}

function severity(score) {
  if (score === null || score === undefined) return 'INFO'
  if (score >= 0.9) return 'PASS'
  if (score >= 0.5) return 'WARN'
  return 'FAIL'
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1)
}

function ms(duration) {
  if (duration === null || duration === undefined) return '-'
  return `${duration.toFixed(0)}ms`
}

function safeName(url) {
  try { return basename(new URL(url).pathname) || url } catch { return url }
}

const PRIORITY_ORDER = { VeryHigh: 0, High: 1, Medium: 2, Low: 3, VeryLow: 4 }
function priorityOrder(p) {
  return PRIORITY_ORDER[p] ?? 5
}

// --- カテゴリスコア ---
console.log(`# Lighthouse分析レポート`)
console.log()
console.log(`- **URL**: ${data.requestedUrl || data.finalDisplayedUrl}`)
console.log(`- **取得日時**: ${data.fetchTime}`)
console.log(`- **デバイス**: ${data.environment?.networkUserAgent?.includes('Mobile') ? 'Mobile' : 'Desktop'}`)
console.log(`- **Lighthouseバージョン**: ${data.lighthouseVersion}`)
console.log()

console.log(`## カテゴリスコア`)
console.log()
console.log(`| カテゴリ | スコア | 評価 |`)
console.log(`|---------|--------|------|`)
for (const [catId, cat] of Object.entries(data.categories || {})) {
  const score = cat.score
  const label = severity(score)
  console.log(`| ${cat.title} | ${fmt(score)} | ${label} |`)
}
console.log()

// --- Core Web Vitals ---
console.log(`## Core Web Vitals & キーメトリクス`)
console.log()
const metricsIds = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'speed-index',
  'total-blocking-time',
  'cumulative-layout-shift',
  'interactive',
  'max-potential-fid',
]
console.log(`| メトリクス | 値 | スコア | 評価 |`)
console.log(`|-----------|-----|--------|------|`)
for (const id of metricsIds) {
  const audit = data.audits?.[id]
  if (!audit) continue
  console.log(
    `| ${audit.title} | ${audit.displayValue || '-'} | ${fmt(audit.score)} | ${severity(audit.score)} |`
  )
}
console.log()

// --- LCP Breakdown (TASK-001) ---
const lcpBreakdown = data.audits?.['lcp-breakdown-insight']
if (lcpBreakdown?.details?.items && Array.isArray(lcpBreakdown.details.items)) {
  const tableItem = lcpBreakdown.details.items.find(i => i.type === 'table')
  const nodeItem = lcpBreakdown.details.items.find(i => i.type === 'node')
  if (tableItem?.items) {
    console.log(`## LCP Breakdown`)
    console.log()
    console.log(`| サブパート | 時間 |`)
    console.log(`|-----------|------|`)
    for (const sub of tableItem.items) {
      console.log(`| ${sub.label} | ${ms(sub.duration)} |`)
    }
    console.log()
  }
  // LCP要素情報（v13: lcp-breakdown-insight内のnode）
  if (nodeItem) {
    console.log(`## LCP要素`)
    console.log()
    console.log(`- **要素**: \`${nodeItem.snippet?.substring(0, 200) || '-'}\``)
    console.log(`- **セレクタ**: \`${nodeItem.selector || '-'}\``)
    console.log()
  }
} else {
  // フォールバック: v12以前の largest-contentful-paint-element
  const lcpEl = data.audits?.['largest-contentful-paint-element']
  if (lcpEl?.details?.items) {
    console.log(`## LCP要素`)
    console.log()
    for (const item of lcpEl.details.items) {
      if (item.node) {
        console.log(`- **要素**: \`${item.node.snippet?.substring(0, 200) || '-'}\``)
        console.log(`- **セレクタ**: \`${item.node.selector || '-'}\``)
      }
    }
    console.log()
  }
}

// --- LCP Discovery (TASK-002) ---
const lcpDiscovery = data.audits?.['lcp-discovery-insight']
if (lcpDiscovery?.details?.items && Array.isArray(lcpDiscovery.details.items)) {
  const checklistItem = lcpDiscovery.details.items.find(i => i.type === 'checklist')
  if (checklistItem?.items) {
    console.log(`## LCP Discovery`)
    console.log()
    for (const [key, item] of Object.entries(checklistItem.items)) {
      const status = item.value ? '✅' : '❌'
      console.log(`- ${status} ${item.label}`)
    }
    console.log()
  }
}

// --- Document Latency (TASK-004) ---
const docLatency = data.audits?.['document-latency-insight']
if (docLatency?.details) {
  const details = docLatency.details
  const items = details.items
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    console.log(`## Document Latency`)
    console.log()
    for (const [key, item] of Object.entries(items)) {
      const status = item.value ? '✅' : '❌'
      console.log(`- ${status} ${item.label}`)
    }
    if (details.debugData) {
      const debug = details.debugData
      if (debug.uncompressedResponseBytes) {
        console.log(`- 非圧縮レスポンスサイズ: ${kb(debug.uncompressedResponseBytes)}KB（削減可能: ${kb(debug.wastedBytes || 0)}KB）`)
      }
    }
    console.log()
  }
}

// --- 問題点（score < 0.9）---
console.log(`## 検出された問題点`)
console.log()

const issues = []
for (const [auditId, audit] of Object.entries(data.audits || {})) {
  const score = audit.score
  if (
    score !== null &&
    score !== undefined &&
    score < 0.9 &&
    audit.scoreDisplayMode !== 'informative' &&
    audit.scoreDisplayMode !== 'notApplicable' &&
    audit.scoreDisplayMode !== 'manual'
  ) {
    issues.push({ id: auditId, ...audit })
  }
}

issues.sort((a, b) => (a.score ?? 1) - (b.score ?? 1))

console.log(`| 評価 | 監査項目 | 表示値 | スコア |`)
console.log(`|------|---------|--------|--------|`)
for (const issue of issues) {
  console.log(
    `| ${severity(issue.score)} | ${issue.title} | ${issue.displayValue || '-'} | ${fmt(issue.score)} |`
  )
}
console.log()

// --- 問題点の詳細 ---
console.log(`## 問題点の詳細`)
console.log()

for (const issue of issues) {
  console.log(`### ${issue.title} (score: ${fmt(issue.score)})`)
  console.log()
  if (issue.displayValue) console.log(`**値**: ${issue.displayValue}`)
  if (issue.numericValue !== undefined)
    console.log(
      `**数値**: ${issue.numericValue.toFixed(1)} ${issue.numericUnit || ''}`
    )
  console.log()

  if (issue.details?.items && Array.isArray(issue.details.items)) {
    const items = issue.details.items.slice(0, 10)
    let hasUrl = false
    let hasWasted = false
    let hasSnippet = false

    for (const item of items) {
      if (item.url) hasUrl = true
      if (item.wastedBytes || item.wastedMs) hasWasted = true
      if (item.node?.snippet) hasSnippet = true
    }

    if (hasUrl || hasSnippet) {
      // テーブルヘッダー構築
      const headers = []
      const dividers = []
      if (hasUrl) { headers.push('リソース'); dividers.push('---') }
      if (hasSnippet) { headers.push('要素'); dividers.push('---') }
      headers.push('サイズ'); dividers.push('---')
      if (hasWasted) { headers.push('削減可能'); dividers.push('---') }

      console.log(`| ${headers.join(' | ')} |`)
      console.log(`| ${dividers.join(' | ')} |`)

      for (const item of items) {
        const cols = []
        if (hasUrl) cols.push(item.url ? safeName(item.url) : '-')
        if (hasSnippet) cols.push(item.node?.snippet?.substring(0, 80) || '-')
        cols.push(
          item.totalBytes ? `${kb(item.totalBytes)}KB` : item.transferSize ? `${kb(item.transferSize)}KB` : '-'
        )
        if (hasWasted) {
          const parts = []
          if (item.wastedBytes) parts.push(`${kb(item.wastedBytes)}KB`)
          if (item.wastedMs) parts.push(`${item.wastedMs.toFixed(0)}ms`)
          cols.push(parts.join(' / ') || '-')
        }
        console.log(`| ${cols.join(' | ')} |`)
      }
      if (issue.details.items.length > 10) {
        const emptyCols = Array(headers.length - 1).fill('').join(' | ')
        console.log(`| ... 他${issue.details.items.length - 10}件 | ${emptyCols} |`)
      }
    }
  }
  console.log()
}

// --- ネットワーク優先度 (TASK-003) ---
const netReqs = data.audits?.['network-requests']
if (netReqs?.details?.items) {
  console.log(`## ネットワーク優先度`)
  console.log()
  const originUrl = data.requestedUrl || data.finalDisplayedUrl
  let mainOrigin
  try { mainOrigin = new URL(originUrl).origin } catch { mainOrigin = null }

  const filtered = netReqs.details.items
    .filter(r => {
      if (!mainOrigin || !r.url) return false
      try { return new URL(r.url).origin === mainOrigin } catch { return false }
    })
    .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))
    .slice(0, 20)

  // LCP要素のURLを特定（警告表示用）
  const lcpNodeSnippet = lcpBreakdown?.details?.items?.find(i => i.type === 'node')?.snippet || ''
  const lcpSrcMatch = lcpNodeSnippet.match(/src="([^"]+)"/)
  const lcpSrc = lcpSrcMatch ? lcpSrcMatch[1] : null

  console.log(`| リソース | タイプ | 優先度 | サイズ |`)
  console.log(`|---------|--------|--------|--------|`)
  for (const req of filtered) {
    let name
    try { name = basename(new URL(req.url).pathname) || '(document)' } catch { name = req.url }
    const isLcpResource = lcpSrc && req.url.includes(lcpSrc.split('/').pop())
    const warn = isLcpResource && (req.priority === 'Low' || req.priority === 'VeryLow') ? ' ⚠️' : ''
    console.log(`| ${name} | ${req.resourceType || '-'} | ${req.priority || '-'}${warn} | ${kb(req.transferSize || 0)}KB |`)
  }
  console.log()
}

// --- ネットワークサマリー ---
const totalBytes = data.audits?.['total-byte-weight']
if (totalBytes) {
  console.log(`## ネットワークサマリー`)
  console.log()
  console.log(`**合計転送サイズ**: ${totalBytes.displayValue}`)
  console.log()
  if (totalBytes.details?.items && Array.isArray(totalBytes.details.items)) {
    console.log(`| リソース | サイズ |`)
    console.log(`|---------|--------|`)
    for (const item of totalBytes.details.items.slice(0, 10)) {
      const name = item.url ? safeName(item.url) : '-'
      console.log(`| ${name} | ${kb(item.totalBytes || 0)}KB |`)
    }
  }
  console.log()
}

// --- サーバーレスポンス ---
const serverTime = data.audits?.['server-response-time']
if (serverTime) {
  console.log(`## サーバーレスポンス`)
  console.log()
  console.log(`**TTFB**: ${serverTime.displayValue}`)
  console.log()
}

// --- DOM サイズ ---
const domSize = data.audits?.['dom-size']
if (domSize?.numericValue) {
  console.log(`## DOMサイズ`)
  console.log()
  console.log(`**要素数**: ${domSize.numericValue}`)
  console.log()
}
