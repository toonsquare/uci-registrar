'use strict'

/**
 * 이력 내보내기에 쓰는 최소한의 CSV 처리기.
 *
 * parse/parseWithHeader 는 제품 코드에서 쓰지 않는다. 내보낸 파일이 다시 제대로 읽히는지
 * (따옴표·쉼표·줄바꿈 처리가 맞는지) 시험에서 확인하기 위해 남겨 둔다.
 */

/** 인용부호와 줄바꿈을 포함한 CSV를 행 배열로 파싱한다. */
function parse (text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  // 엑셀이 붙이는 BOM 제거
  const src = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') { quoted = true } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}

/** 첫 줄을 헤더로 보고 객체 배열로 만든다. */
function parseWithHeader (text) {
  const rows = parse(text)
  if (!rows.length) return { headers: [], items: [] }
  const headers = rows[0].map((h) => h.trim())
  const items = rows.slice(1).map((r) => {
    const o = {}
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
    return o
  })
  return { headers, items }
}

function escapeCell (v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 객체 배열을 CSV 문자열로 만든다.
 * 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다.
 */
function stringify (items, columns) {
  const head = columns.map((c) => escapeCell(c.label)).join(',')
  const body = items.map((it) => columns.map((c) => escapeCell(it[c.key])).join(',')).join('\r\n')
  return `\uFEFF${head}\r\n${body}\r\n`
}

module.exports = { parse, parseWithHeader, stringify }
