#!/usr/bin/env node
/**
 * Lighthouse比較分析スクリプト
 *
 * 複数のLighthouse JSONレポートを比較分析し、中央値選定・ベースライン比較・
 * 外れ値検出を含む構造化レポートをMarkdownで出力する。
 *
 * Usage:
 *   node compare-lighthouse.mjs <json1> <json2> [json3...]
 *   node compare-lighthouse.mjs <json1> ... --baseline <b1.json> [b2.json ...]
 *   node compare-lighthouse.mjs <json1> ... --baseline-values "Performance:80,LCP:4900,..."
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// ========== Arg Parsing ==========
const rawArgs = process.argv.slice(2)
if (rawArgs.length < 2) {
  console.error(
    'Usage: node compare-lighthouse.mjs <json1> <json2> [json3...]\n' +
    '       [--baseline <b1.json> [b2.json ...]]\n' +
    '       [--baseline-values "Performance:80,LCP:4900,..."]'
  )
  process.exit(1)
}

const targetFiles = []
const baselineFiles = []
let baselineValuesStr = null
let mode = 'target'

for (const arg of rawArgs) {
  if (arg === '--baseline') { mode = 'baseline'; continue }
  if (arg === '--baseline-values') { mode = 'values'; continue }
  if (mode === 'target') targetFiles.push(arg)
  else if (mode === 'baseline') baselineFiles.push(arg)
  else if (mode === 'values') { baselineValuesStr = arg; mode = 'done' }
}

// ========== Helpers ==========
function commaNum(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtMs(v) {
  if (v == null) return '-'
  return `${commaNum(v)}ms`
}

function fmtScore(v) {
  if (v == null) return '-'
  return String(Math.round(v * 100))
}

function fmtCls(v) {
  if (v == null) return '-'
  return v.toFixed(3)
}

function fmtBenchmark(v) {
  if (v == null) return '-'
  return commaNum(v)
}

function shortFile(filePath) {
  const name = basename(filePath, '.json')
  const m = name.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  return m ? `T${m[4]}${m[5]}${m[6]}` : name
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1)
}

function smartName(url) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return u.hostname
    const last = parts[parts.length - 1]
    if (last.length <= 3 && parts.length >= 2) {
      return `${parts[parts.length - 2]}/${last}`
    }
    return last
  } catch {
    return url
  }
}

// ========== Metric Extraction ==========
const METRIC_DEFS = [
  { key: 'performance', label: 'Performance', format: 'score' },
  { key: 'lcp', label: 'LCP', format: 'ms' },
  { key: 'fcp', label: 'FCP', format: 'ms' },
  { key: 'si', label: 'Speed Index', format: 'ms' },
  { key: 'tbt', label: 'TBT', format: 'ms' },
  { key: 'cls', label: 'CLS', format: 'cls' },
  { key: 'tti', label: 'TTI', format: 'ms' },
  { key: 'bestPractices', label: 'Best Practices', format: 'score' },
  { key: 'accessibility', label: 'Accessibility', format: 'score' },
  { key: 'seo', label: 'SEO', format: 'score' },
]

function fmtMetric(value, format) {
  if (format === 'score') return fmtScore(value)
  if (format === 'ms') return fmtMs(value)
  if (format === 'cls') return fmtCls(value)
  return String(value ?? '-')
}

function extractRun(jsonPath) {
  const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const a = data.audits || {}
  const c = data.categories || {}

  // LCP Breakdown (v13: lcp-breakdown-insight, v12: largest-contentful-paint-element)
  let lcpBreakdown = null
  const lcpBI = a['lcp-breakdown-insight']
  if (lcpBI?.details?.items) {
    const tableItem = lcpBI.details.items.find(i => i.type === 'table')
    if (tableItem?.items) {
      lcpBreakdown = tableItem.items.map(sub => ({
        label: sub.label,
        duration: sub.duration,
      }))
    }
  }

  // Third-party summary (v13: third-parties-insight, v12: third-party-summary)
  const thirdParty = []
  const tp = a['third-parties-insight'] || a['third-party-summary']
  if (tp?.details?.items) {
    for (const item of tp.details.items) {
      const name = item.entity?.text || (typeof item.entity === 'string' ? item.entity : null)
      if (name) {
        thirdParty.push({
          name,
          transferSize: item.transferSize || 0,
          mainThreadTime: item.mainThreadTime || 0,
        })
      }
    }
  }

  // Unused JS
  const unusedJs = []
  const uj = a['unused-javascript']
  if (uj?.details?.items) {
    const origin = (() => {
      try { return new URL(data.requestedUrl || data.finalDisplayedUrl).origin } catch { return null }
    })()
    for (const item of uj.details.items) {
      let isFirstParty = false
      try { isFirstParty = origin && new URL(item.url).origin === origin } catch { /* ignore */ }
      unusedJs.push({
        url: item.url,
        totalBytes: item.totalBytes || 0,
        wastedBytes: item.wastedBytes || 0,
        isFirstParty,
      })
    }
  }

  return {
    file: basename(jsonPath),
    path: jsonPath,
    shortName: shortFile(jsonPath),
    url: data.requestedUrl || data.finalDisplayedUrl,
    fetchTime: data.fetchTime,
    device: data.environment?.networkUserAgent?.includes('Mobile') ? 'Mobile' : 'Desktop',
    benchmarkIndex: data.environment?.benchmarkIndex ?? null,
    metrics: {
      performance: c.performance?.score ?? null,
      bestPractices: c['best-practices']?.score ?? null,
      accessibility: c.accessibility?.score ?? null,
      seo: c.seo?.score ?? null,
      fcp: a['first-contentful-paint']?.numericValue ?? null,
      lcp: a['largest-contentful-paint']?.numericValue ?? null,
      si: a['speed-index']?.numericValue ?? null,
      tbt: a['total-blocking-time']?.numericValue ?? null,
      cls: a['cumulative-layout-shift']?.numericValue ?? null,
      tti: a['interactive']?.numericValue ?? null,
    },
    lcpBreakdown,
    thirdParty,
    unusedJs,
  }
}

// ========== Median Selection ==========
// Lower median (conservative): for even n, picks the lower of two middle values.
function selectMedian(runs) {
  const sorted = [...runs].sort(
    (a, b) => (a.metrics.performance ?? 0) - (b.metrics.performance ?? 0)
  )
  const idx = Math.floor((sorted.length - 1) / 2)
  return { run: sorted[idx], index: runs.indexOf(sorted[idx]) }
}

// ========== Outlier Detection ==========
function detectOutliers(runs, medianRun) {
  const medPerf = medianRun.metrics.performance ?? 0
  return runs
    .map((r, i) => ({ run: r, index: i }))
    .filter(({ run }) => {
      const perf = run.metrics.performance ?? 0
      return Math.abs(perf - medPerf) > 0.2 // >20 points difference
    })
}

// ========== Baseline Parsing ==========
const BASELINE_KEY_MAP = {
  Performance: { key: 'performance', divisor: 100 },
  LCP: { key: 'lcp', divisor: 1 },
  FCP: { key: 'fcp', divisor: 1 },
  SI: { key: 'si', divisor: 1 },
  TBT: { key: 'tbt', divisor: 1 },
  CLS: { key: 'cls', divisor: 1 },
  TTI: { key: 'tti', divisor: 1 },
  BestPractices: { key: 'bestPractices', divisor: 100 },
  Accessibility: { key: 'accessibility', divisor: 100 },
  SEO: { key: 'seo', divisor: 100 },
}

function parseBaselineValues(str) {
  const metrics = {}
  for (const pair of str.split(',')) {
    const [k, v] = pair.split(':')
    const mapping = BASELINE_KEY_MAP[k.trim()]
    if (mapping) {
      metrics[mapping.key] = parseFloat(v) / mapping.divisor
    }
  }
  return { metrics, source: 'values' }
}

function computeBaselineFromFiles(files) {
  const runs = files.map(f => extractRun(f))
  const { run } = selectMedian(runs)
  return { metrics: run.metrics, source: 'files', runs }
}

// ========== Report Output ==========
function outputReport(runs, median, outliers, baseline) {
  const medRun = median.run
  const p = console.log.bind(console)

  // Header
  p('# Lighthouse比較分析レポート')
  p()
  p(`- **URL**: ${medRun.url}`)
  p(`- **計測回数**: ${runs.length}`)
  p(`- **デバイス**: ${medRun.device}`)
  p(`- **中央値ラン**: Run ${median.index + 1} (${medRun.shortName})`)
  if (medRun.fetchTime) p(`- **計測日時**: ${medRun.fetchTime}`)
  p()

  // All runs table
  p('## 全計測データ')
  p()
  const runHeaders = runs.map((r, i) => `Run ${i + 1} (${r.shortName})`)
  p(`| メトリクス | ${runHeaders.join(' | ')} | 中央値 |`)
  p(`|-----------|${runs.map(() => '---').join('|')}|------|`)

  for (const def of METRIC_DEFS) {
    const vals = runs.map(r => fmtMetric(r.metrics[def.key], def.format))
    const medVal = fmtMetric(medRun.metrics[def.key], def.format)
    p(`| ${def.label} | ${vals.join(' | ')} | **${medVal}** |`)
  }
  // benchmarkIndex row
  const biVals = runs.map(r => fmtBenchmark(r.benchmarkIndex))
  p(`| benchmarkIndex | ${biVals.join(' | ')} | - |`)
  p()

  // Median selection explanation
  p('## 中央値ラン選定')
  p()
  const perfScores = runs.map(r => Math.round((r.metrics.performance ?? 0) * 100))
  const sorted = [...perfScores].sort((a, b) => a - b)
  p(`Performance スコア (${perfScores.join(', ')}) をソート (${sorted.join(', ')}) し、中央値 ${Math.round((medRun.metrics.performance ?? 0) * 100)} に該当する Run ${median.index + 1} を採用。`)
  p()

  // Outlier detection
  if (outliers.length > 0) {
    p('## 外れ値検出')
    p()
    for (const { run: oRun, index: oIdx } of outliers) {
      const oPerfStr = Math.round((oRun.metrics.performance ?? 0) * 100)
      const mPerfStr = Math.round((medRun.metrics.performance ?? 0) * 100)
      const diff = oPerfStr - mPerfStr
      p(`**Run ${oIdx + 1} (${oRun.shortName}) が外れ値**: Performance ${oPerfStr} (中央値 ${mPerfStr} との差: ${diff > 0 ? '+' : ''}${diff})`)
      p()
    }

    // LCP Breakdown comparison for outlier analysis
    const hasBreakdown = runs.some(r => r.lcpBreakdown)
    if (hasBreakdown) {
      const labels = runs.find(r => r.lcpBreakdown)?.lcpBreakdown.map(s => s.label) || []
      if (labels.length > 0) {
        p('LCP Breakdown比較:')
        p()
        const bHeaders = runs.map((r, i) => {
          const isOutlier = outliers.some(o => o.index === i)
          return `Run ${i + 1}${isOutlier ? ' (外れ値)' : ''}`
        })
        p(`| サブパート | ${bHeaders.join(' | ')} |`)
        p(`|-----------|${runs.map(() => '---').join('|')}|`)
        for (const label of labels) {
          const vals = runs.map(r => {
            const sub = r.lcpBreakdown?.find(s => s.label === label)
            return fmtMs(sub?.duration)
          })
          p(`| ${label} | ${vals.join(' | ')} |`)
        }
        p()

        // Identify the largest subpart difference for outliers
        for (const { run: oRun, index: oIdx } of outliers) {
          if (!oRun.lcpBreakdown || !medRun.lcpBreakdown) continue
          let maxDiffLabel = null
          let maxDiff = 0
          for (const oSub of oRun.lcpBreakdown) {
            const mSub = medRun.lcpBreakdown.find(s => s.label === oSub.label)
            if (mSub && oSub.duration != null && mSub.duration != null) {
              const diff = Math.abs(oSub.duration - mSub.duration)
              if (diff > maxDiff) { maxDiff = diff; maxDiffLabel = oSub.label }
            }
          }
          if (maxDiffLabel) {
            const oVal = oRun.lcpBreakdown.find(s => s.label === maxDiffLabel)?.duration
            const mVal = medRun.lcpBreakdown.find(s => s.label === maxDiffLabel)?.duration
            p(`→ Run ${oIdx + 1} の ${maxDiffLabel} が異常 (${fmtMs(oVal)} vs 中央値 ${fmtMs(mVal)})`)
            p()
          }
        }
      }
    }
  }

  // LCP Breakdown (median run)
  if (medRun.lcpBreakdown) {
    p('## LCP Breakdown (中央値ラン)')
    p()
    p('| サブパート | 時間 |')
    p('|-----------|------|')
    for (const sub of medRun.lcpBreakdown) {
      p(`| ${sub.label} | ${fmtMs(sub.duration)} |`)
    }
    p()
  }

  // Baseline comparison
  if (baseline) {
    p('## ベースライン比較')
    p()
    if (baseline.source === 'values') {
      p('> ベースライン: 手動指定値')
    } else {
      p(`> ベースライン: ${baseline.runs.length}回計測の中央値`)
    }
    p()

    const compDefs = METRIC_DEFS.filter(d =>
      baseline.metrics[d.key] != null && medRun.metrics[d.key] != null
    )

    p('| メトリクス | ベースライン | 改善後(中央値) | 変化 | 変化率 |')
    p('|-----------|------------|---------------|------|--------|')
    for (const def of compDefs) {
      const bVal = baseline.metrics[def.key]
      const cVal = medRun.metrics[def.key]
      const bFmt = fmtMetric(bVal, def.format)
      const cFmt = fmtMetric(cVal, def.format)

      let diff, pctChange
      if (def.format === 'score') {
        const bDisp = Math.round(bVal * 100)
        const cDisp = Math.round(cVal * 100)
        const d = cDisp - bDisp
        diff = `${d > 0 ? '+' : ''}${d}`
        pctChange = bDisp !== 0 ? `${d > 0 ? '+' : ''}${((d / bDisp) * 100).toFixed(1)}%` : '-'
      } else if (def.format === 'cls') {
        const d = cVal - bVal
        diff = d === 0 ? '0' : `${d > 0 ? '+' : ''}${d.toFixed(3)}`
        const pctVal = ((d / bVal) * 100).toFixed(1)
        pctChange = bVal !== 0 ? `${parseFloat(pctVal) > 0 ? '+' : ''}${pctVal}%` : '-'
      } else {
        // ms values
        const d = Math.round(cVal - bVal)
        diff = `${d > 0 ? '+' : ''}${commaNum(d)}ms`
        const pctVal = ((d / bVal) * 100).toFixed(1)
        pctChange = bVal !== 0 ? `${parseFloat(pctVal) > 0 ? '+' : ''}${pctVal}%` : '-'
      }

      p(`| ${def.label} | ${bFmt} | ${cFmt} | ${diff} | ${pctChange} |`)
    }
    p()
  }

  // Third-party impact (from median run)
  if (medRun.thirdParty.length > 0) {
    p('## 第三者タグ影響 (中央値ラン)')
    p()
    p('| エンティティ | 転送量 | メインスレッド時間 |')
    p('|-------------|--------|------------------|')
    let totalTransfer = 0
    let totalMainThread = 0
    for (const tp of medRun.thirdParty) {
      p(`| ${tp.name} | ${kb(tp.transferSize)}KB | ${Math.round(tp.mainThreadTime)}ms |`)
      totalTransfer += tp.transferSize
      totalMainThread += tp.mainThreadTime
    }
    if (medRun.thirdParty.length > 1) {
      p(`| **合計** | **${kb(totalTransfer)}KB** | **${Math.round(totalMainThread)}ms** |`)
    }
    p()
  }

  // Unused JS (from median run)
  if (medRun.unusedJs.length > 0) {
    p('## 未使用JavaScript (中央値ラン)')
    p()
    p('| リソース | 種別 | 合計 | 未使用 |')
    p('|---------|------|------|--------|')
    for (const item of medRun.unusedJs) {
      let name = smartName(item.url)
      if (name.length > 40) name = name.substring(0, 37) + '...'
      const kind = item.isFirstParty ? '自サイト' : '第三者'
      p(`| ${name} | ${kind} | ${kb(item.totalBytes)}KB | ${kb(item.wastedBytes)}KB |`)
    }
    p()
  }

  // Report JSON paths
  p('## レポートJSON')
  p()
  for (let i = 0; i < runs.length; i++) {
    p(`- Run ${i + 1}: \`${runs[i].path}\``)
  }
  if (baseline?.source === 'files' && baseline.runs) {
    p()
    p('ベースライン:')
    for (const r of baseline.runs) {
      p(`- \`${r.path}\``)
    }
  }
  p()
}

// ========== Main ==========
const runs = targetFiles.map(f => extractRun(f))
const median = selectMedian(runs)
const outliers = detectOutliers(runs, median.run)

let baseline = null
if (baselineFiles.length > 0) {
  baseline = computeBaselineFromFiles(baselineFiles)
} else if (baselineValuesStr) {
  baseline = parseBaselineValues(baselineValuesStr)
}

outputReport(runs, median, outliers, baseline)
