'use strict'

/**
 * 일괄 신청용 엑셀(.xls) 만들기.
 *
 * 국립중앙도서관은 여러 작품을 한 번에 신청할 때 엑셀 파일을 요구한다. 양식은 포털이
 * 나눠주는 Excel 97-2003(.xls) 파일이고, 첫 시트에 30개 열이 정해져 있다.
 *
 * 파일을 새로 만들지 않고 **공식 양식을 열어서 데이터 줄만 갈아끼운다.**
 * 양식 1행의 버전 표식(UCI_APPLY_WEBTOON_V02)과 열 제목·설명·둘째 시트를 그대로 두기
 * 위해서다. 새로 만들면 그중 하나만 어긋나도 서버가 통째로 반려한다.
 *
 */

const path = require('node:path')
const XLSX = require('xlsx')
const { authorsOf } = require('../shared/uci-constants')

/** 양식에서 예시 3줄이 시작하는 행. 실제 데이터는 이 자리부터 덮어쓴다. (0부터 셈) */
const DATA_ROW = 4

/** 양식의 열 개수. 30개 고정. */
const COLUMN_COUNT = 30

function templatePath (contentType) {
  const name = contentType === 'webnovel' ? 'bulk-webnovel.xls' : 'bulk-webtoon.xls'
  return path.join(__dirname, 'templates', name)
}

/**
 * 연재처와 작품 URL 을 한 칸에 합친다.
 *
 * 양식은 둘을 따로 받지 않는다. `연재처명(URL)` 형태로 적고, 여러 곳이면 쉼표로 잇는다.
 *   예) 네이버웹툰(https://comic.naver.com/webtoon/list?titleId=800770), 카카오페이지
 */
function syndicateCell (item) {
  const name = String(item.syndicateName || '').trim()
  const url = String(item.url || '').trim()
  if (!name) return url
  return url ? `${name}(${url})` : name
}

/** 여러 값을 쉼표로 잇는다. 양식이 요구하는 중복 표기 방식이다. */
function joinMulti (value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(',')
  return String(value || '').trim()
}

/**
 * 글자 칸. 비어 있으면 null — 셀을 아예 만들지 않는다.
 *
 * 양식은 안 쓰는 칸을 빈 셀로 두는데, 예전엔 빈 글자('')를 넣어 글자 셀이 생겼다.
 * 서버가 그 칸을 숫자로 읽으면 빈 글자에서 깨질 수 있어 양식과 똑같이 비워 둔다.
 */
function text (value) {
  const v = String(value ?? '').trim()
  return v === '' ? null : v
}

/**
 * 숫자 칸. 양식의 예시 줄은 가격수량·회차번호를 숫자 셀로 둔다.
 *
 * 예전엔 '500' 처럼 글자 셀로 썼다. 2026-10-15 파트너 실증에서 일괄 신청이
 * "일괄등록 양식을 다시 한번 확인하여 주시기 바랍니다" 로 반려됐는데, 서버가 이 칸을
 * 숫자로 읽다 글자 셀에서 깨졌을 가능성이 있어 양식과 같은 숫자 셀로 맞춘다.
 * 숫자가 아닌 값이 들어오면 글자 그대로 둔다 — 화면 검증이 먼저 막으므로 보통 오지 않는다.
 */
function number (value) {
  const v = String(value ?? '').trim()
  if (v === '') return null
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
}

/**
 * 신청 한 건을 양식의 30개 열로 편다.
 *
 * 채우지 않는 열은 선택 항목이라 빈 칸으로 둔다. 열 순서는 양식이 정한 것이라
 * 절대 바꾸면 안 된다 — 서버는 제목이 아니라 위치로 읽는다.
 */
function toRow (item) {
  const row = new Array(COLUMN_COUNT).fill(null)

  row[0] = text(item.publishForm)                         // 연재유형*
  row[1] = text(item.title)                               // 콘텐츠명(작품명)*
  row[2] = text(syndicateCell(item))                      // 연재처(작품url)*
  // 작가는 양식의 "중복가능, ','로 구분" 규칙대로 역할 목록과 이름 목록을 같은 순서로 쉼표로 잇는다.
  const authors = authorsOf(item)
  row[3] = text(authors.map((a) => a.role).join(','))     // 작가역할*  예) 글,그림
  row[4] = text(authors.map((a) => a.name).join(','))     // 작가명*    예) 홍길동,김작가
  row[5] = text(item.priceKind)                           // 가격구분*
  row[6] = number(item.price)                             // 가격수량*  (숫자 셀)
  // 양식의 가격단위 칸은 자유 입력이다. '직접입력' 이라는 말 대신 실제 단위를 적는다.
  row[7] = text(item.currency === '직접입력' ? item.currencyEtc : item.currency)   // 가격단위*
  row[8] = text(joinMulti(item.genres))                   // 장르*
  row[10] = text(item.ageGrade)                           // 연령등급 — AL / 12+ / 15+ / 18+ (양식 표기 그대로 저장돼 있다)
  row[17] = text(item.serialStatus)                       // 연재상태*
  row[27] = number(item.episodeStart)                     // 회차시작번호*  (숫자 셀)
  row[28] = number(item.episodeEnd)                       // 회차끝번호*  (숫자 셀)

  return row
}

/**
 * 신청 목록을 양식에 채워 .xls 파일로 저장한다.
 *
 * 같은 파일에 웹툰과 웹소설을 섞을 수 없다. 양식 자체가 다르고 버전 표식도 달라서,
 * 유형이 섞여 들어오면 여기서 막는다. 부르는 쪽에서 유형별로 나눠 부른다.
 */
function writeBulkFile (items, outPath) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('내보낼 신청 내역이 없습니다.')
  }
  const types = new Set(items.map((i) => i.contentType || 'webtoon'))
  if (types.size > 1) {
    throw new Error('웹툰과 웹소설은 양식이 달라 한 파일에 담을 수 없습니다.')
  }

  const contentType = items[0].contentType || 'webtoon'
  const book = XLSX.readFile(templatePath(contentType))
  const sheet = book.Sheets[book.SheetNames[0]]

  // 양식에 들어 있는 예시 3줄을 지운다. 안 지우면 그대로 신청돼 버린다.
  const range = XLSX.utils.decode_range(sheet['!ref'])
  for (let r = DATA_ROW; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      delete sheet[XLSX.utils.encode_cell({ r, c })]
    }
  }

  XLSX.utils.sheet_add_aoa(sheet, items.map(toRow), { origin: DATA_ROW })
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: DATA_ROW + items.length - 1, c: COLUMN_COUNT - 1 }
  })

  // biff8 = Excel 97-2003. 양식과 같은 형식이어야 서버가 읽는다.
  XLSX.writeFile(book, outPath, { bookType: 'biff8' })
  return outPath
}

module.exports = { writeBulkFile, toRow, syndicateCell, text, number, templatePath, DATA_ROW, COLUMN_COUNT }
