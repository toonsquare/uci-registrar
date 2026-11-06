'use strict'

/**
 * 업무일 계산.
 *
 * 국립중앙도서관 UCI 신청 처리기한은 "신청한 날로부터 업무일 기준 3일(공휴일 제외)"이다.
 * 법정공휴일 목록은 매년 바뀌고 이 프로그램이 알 방법이 없으므로 주말만 제외해서 계산한다.
 * 그래서 결과는 확정 날짜가 아니라 어디까지나 예상이고, 화면에도 '예상'으로 표시한다.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

function isWeekend (date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * 기준일로부터 업무일 n일 뒤를 구한다.
 * @param {Date|string} from 기준 시각
 * @param {number} days 더할 업무일 수
 * @returns {string} ISO 문자열
 */
function addBusinessDays (from, days) {
  const date = new Date(from)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()

  let remaining = days
  while (remaining > 0) {
    date.setTime(date.getTime() + MS_PER_DAY)
    if (!isWeekend(date)) remaining--
  }
  return date.toISOString()
}

/** 두 시각 사이의 업무일 수. 지연 여부를 판단할 때 쓴다. */
function businessDaysBetween (from, to) {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  let count = 0
  const cursor = new Date(start)
  while (cursor < end) {
    cursor.setTime(cursor.getTime() + MS_PER_DAY)
    if (!isWeekend(cursor)) count++
  }
  return count
}

module.exports = { addBusinessDays, businessDaysBetween }
