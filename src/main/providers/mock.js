'use strict'

const store = require('../store')
const constants = require('../../shared/uci-constants')

/**
 * 모의(mock) 신청 제공자.
 *
 * 실제 국립중앙도서관 포털에 붙지 않고, 포털이 있었다면 돌려줬을 응답을 그대로 흉내낸다.
 * 화면·저장·검증 로직을 전부 실제와 동일하게 태우기 때문에, 나중에 provider 만
 * portal 로 갈아끼우면 화면 쪽은 한 줄도 안 고쳐도 된다.
 *
 * 중요: 실제 포털은 신청 즉시 UCI를 주지 않는다. 업무일 3일 심사 후 이메일·알림톡으로 통지한다.
 * 그래서 여기서도 신청하면 접수번호만 주고, 결과 조회를 해야 UCI가 나오도록 맞춰 두었다.
 */

/** 웹콘텐츠 유형 → UCI 분류코드. UCI 발급 대상은 웹툰·웹소설뿐이다. */
const TYPE_CODE = {
  webtoon: '620',
  webnovel: '300'
}

/** 포털이 실제로 검사하는 필수 항목. fn_save() 의 검사 순서를 그대로 옮겼다. */
const REQUIRED = [
  ['managerName', '담당자명'],
  ['managerEmail', '담당자 이메일'],
  ['managerMobile', '담당자 휴대폰번호'],
  ['publishForm', '연재유형'],
  ['title', '작품명'],
  ['ageGrade', '연령등급'],   // 2026-10-15 포털이 필수로 검사하기 시작
  ['syndicateName', '연재처'],
  ['price', '가격'],
  ['serialStatus', '연재상태'],
  ['episodeStart', '회차 시작번호'],
  ['episodeEnd', '회차 끝번호']
]

/**
 * 모의 심사 소요 시간.
 * 실제로는 업무일 3일이지만, 시연할 때 대기 → 완료까지 눈으로 확인할 수 있어야 하므로
 * 10초로 줄여 두었다. 이 값은 모의 모드에만 적용된다.
 */
const MOCK_REVIEW_MS = 10 * 1000

let session = null

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 사람이 쓰는 시스템처럼 보이도록 약간의 응답 지연을 준다. */
function networkDelay (min = 350, max = 900) {
  return delay(min + Math.floor(Math.random() * (max - min)))
}

function pad (n, len) {
  return String(n).padStart(len, '0')
}

/** `I410-ECN-0102-2026-620-000001234` 형태의 코드를 만든다. */
function generateUci (contentType) {
  const { uciPrefix } = store.getSettings()
  const year = new Date().getFullYear()
  const typeCode = TYPE_CODE[contentType] || TYPE_CODE.webtoon
  const serial = store.stats().total * 7 + Math.floor(Math.random() * 900000) + 1000
  return `${uciPrefix}-${year}-${typeCode}-${pad(serial, 9)}`
}

async function login ({ loginId, password }) {
  await networkDelay()

  if (!loginId || !password) {
    return { ok: false, error: '아이디와 비밀번호를 모두 입력해 주세요.' }
  }
  // 실패 경로도 화면에서 확인할 수 있도록 남겨둔 탈출구다.
  if (password === 'fail') {
    return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다. (오류 코드: AUTH-401)' }
  }

  const settings = store.getSettings()
  session = {
    loginId,
    name: `${loginId} 담당자`,
    orgName: settings.orgName || '투니스퀘어',
    orgCode: settings.orgCode || 'I410',
    registrantNo: settings.registrantNo || '',
    loginAt: new Date().toISOString()
  }
  return { ok: true, user: { ...session } }
}

async function logout () {
  session = null
  return { ok: true }
}

function getSession () {
  return session ? { ...session } : null
}

/**
 * UCI 신청이 가능한 계정인지 확인한다.
 *
 * 실제 포털에서는 'UCI 신청 화면이 열리는가'로 판정한다. 등록자번호가 계정에 묶여 있어서,
 * 없으면 포털이 화면 자체를 안 열어주기 때문이다.
 * 모의 모드에는 포털이 없으므로 설정에 적어 둔 등록자번호로 그 상황을 흉내낸다.
 */
async function verifyAccess () {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }

  await networkDelay(300, 700)

  if (!store.getSettings().registrantNo) {
    return {
      ok: false,
      error: '등록자번호가 없어 UCI 신청 화면을 열 수 없습니다. ' +
        '등록자번호는 계정에 묶여 있으며, 시·구청 출판사신고 → 신고확인증 → 등록자번호 신청 순서로 먼저 받아야 합니다. ' +
        '(모의 연동에서는 설정 화면에 등록자번호를 입력하면 통과합니다)'
    }
  }
  return { ok: true }
}

/**
 * 작품 건별 신청.
 * 성공하면 접수번호를 돌려준다. UCI는 이 시점에 나오지 않는다.
 * @param {object} meta 신청 폼에서 넘어온 작품 정보
 */
/**
 * 신청 한 건을 검증한다. 어긋나면 사유 문자열, 멀쩡하면 null.
 *
 * 포털과 같은 순서로 걸러낸다. 화면에서 이미 막지만 여기서도 한 번 더 본다.
 * 건별과 일괄이 같은 함수를 쓴다 — 포털도 파일 안의 한 줄이 어긋나면 전체를 반려한다.
 */
function validate (meta) {
  for (const [key, label] of REQUIRED) {
    if (!String(meta[key] ?? '').trim()) return `${label}을(를) 입력하세요.`
  }
  // 작가는 한 줄에 한 사람(역할+이름). 포털은 첫 줄이 비면 거부하고, 역할·이름이 한쪽만 있으면 거부한다.
  const authors = constants.authorsOf(meta)
  if (!authors.length) return '작가역할/작가명을 입력해주세요.'
  if (authors.some((a) => !a.role)) return '작가역할/작가명을 전부 입력해주세요.'
  // 숫자 칸의 글자, 휴대폰·이메일·URL 형식. 화면과 같은 함수로 본다 (SFR-002).
  const typed = constants.typeProblem(meta)
  if (typed) return typed.message
  if (!Array.isArray(meta.genres) || !meta.genres.length) return '장르를 선택하세요.'
  // 단위를 직접 쓰기로 해놓고 비워 두면 포털에서 걸린다.
  if (meta.currency === '직접입력' && !String(meta.currencyEtc || '').trim()) {
    return '가격 단위를 직접 입력하세요.'
  }
  if (!meta.rightsAgreed) return '저작권자 동의에 체크하여 주시기 바랍니다.'   // 포털 문구 (2026-10-15 확인)
  if (!meta.privacyAgreed) return '개인정보 수집 및 이용 동의에 체크하여 주시기 바랍니다.'

  const start = Number(meta.episodeStart)
  const end = Number(meta.episodeEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    return '회차 번호를 올바르게 입력하세요. (시작번호 ≤ 끝번호)'
  }
  if (end - start + 1 > 300) {
    return 'UCI 최초 발급 신청 시 최대 300화까지 가능합니다.'
  }
  return null
}

async function apply (meta) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }

  // 등록자번호 보유 여부는 verifyAccess 가 판정한다. 여기서 또 보지 않는 이유는
  // 실제 포털에서는 그 값을 확인할 수단이 없어서, 두 제공자의 동작이 갈리기 때문이다.
  await networkDelay(500, 1400)

  const problem = validate(meta)
  if (problem) return { ok: false, error: problem }

  // 포털의 중복 확인을 흉내내는 탈출구. 작품명에 '중복' 이 들어가면 같은 이름이 있는 것으로 친다.
  const dup = duplicateOf([meta])
  if (dup) return dup

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    status: 'pending'
  }
}

/**
 * 포털은 같은 작품명이 이미 있으면 접수하지 않고 "회차 추가 / 새 작품으로 등록" 을 묻는다 (2026-10-15 확인).
 * 포털 서버는 계정 안의 작품명을 비교하므로, 모의 연동도 같은 식으로 모의 이력에 같은 유형·같은 작품명이
 * 있으면 그 상황으로 본다. 작품명에 '중복' 이 들어간 건도 같은 상황으로 친다 (이력 없이 바로 보고 싶을 때).
 * 화면에서 '새 작품으로 등록' 을 고르면 forceNew 가 실려 오고, 그때는 통과시킨다.
 */
function duplicateOf (items) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim()
  const existing = store.listRecords({}).filter((r) => r.mode === 'mock' && r.status !== 'failed' && norm(r.title))
  const sameWork = (r, m) => (r.contentType || 'webtoon') === (m.contentType || 'webtoon') && norm(r.title) === norm(m.title)
  const hit = items.find((m) => !m.forceNew && (/중복/.test(String(m.title || '')) || existing.some((r) => sameWork(r, m))))
  if (!hit) return null
  return {
    ok: false,
    duplicate: true,
    workName: hit.title,
    error: `포털에 같은 작품명 「${hit.title}」이(가) 이미 등록되어 있어 접수하지 않았습니다.`
  }
}

/**
 * 신청 건의 심사 결과를 조회한다.
 *
 * 실제 포털에서는 'UCI 신청 현황 조회' 화면을 읽어오는 동작에 해당한다.
 * 모의 모드에서는 신청한 지 MOCK_REVIEW_MS 가 지났으면 발급된 것으로 처리한다.
 *
 * @param {object} record 저장된 신청 이력 한 건
 */
async function checkStatus (record) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }

  await networkDelay(200, 600)

  // 반려 화면도 시연할 수 있도록 남겨둔 탈출구다.
  if (String(record.url || '').includes('reject')) {
    return {
      ok: true,
      status: 'rejected',
      reason: '작품 URL이 확인되지 않습니다. 접속 가능한 주소로 다시 신청해 주세요.',
      checkedAt: new Date().toISOString()
    }
  }

  const elapsed = Date.now() - new Date(record.appliedAt || record.issuedAt || Date.now()).getTime()
  if (elapsed < MOCK_REVIEW_MS) {
    return { ok: true, status: 'pending', checkedAt: new Date().toISOString() }
  }

  return {
    ok: true,
    status: 'issued',
    uci: generateUci(record.contentType),
    issuedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString()
  }
}

/** 이미 발급된 코드를 조회한다. 목업에서는 로컬 이력에서 찾는다. */
async function lookup (uci) {
  await networkDelay(200, 500)
  const hit = store.listRecords({ query: uci }).find((r) => r.uci === uci)
  return hit ? { ok: true, record: hit } : { ok: false, error: '해당 UCI를 찾을 수 없습니다.' }
}

/**
 * 여러 작품 일괄 신청 (모의).
 *
 * 실물은 엑셀을 만들어 포털에 올리지만, 여기서는 그 결과만 흉내낸다.
 * 검증은 건별과 똑같이 태운다 — 한 건이라도 어긋나면 포털도 파일 전체를 반려한다.
 */
async function applyBulk (items) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: '신청할 작품이 없습니다.' }
  }
  if (new Set(items.map((i) => i.contentType || 'webtoon')).size > 1) {
    return { ok: false, error: '웹툰과 웹소설은 양식이 달라 한 번에 신청할 수 없습니다.' }
  }

  for (let i = 0; i < items.length; i++) {
    const problem = validate(items[i])
    if (problem) return { ok: false, error: `작품 ${i + 1}: ${problem}` }
  }

  const dup = duplicateOf(items)
  if (dup) return dup

  await networkDelay(700, 1500)
  return { ok: true, status: 'pending', appliedAt: new Date().toISOString(), count: items.length }
}

/* ------------------------------------------- 모의 포털 현황 (연습 이력으로 만든다) */

/** 프로그램 상태 → 포털 신청상태 글자. 연습 이력을 포털 현황처럼 보이게 할 때 쓴다. */
const PORTAL_LABEL = { pending: '접수', needsFix: '보완요청', issued: '완료', rejected: '처리불가' }
const PAGE_SIZE = 10

/**
 * 연습 이력 가운데 포털에 닿았을 건들을 포털 현황 줄 모양으로 바꾼다.
 * 신청 시점에 거부된 건(failed)은 포털에 없다. 포털 키는 이력 id 로 대신한다.
 */
function portalRows () {
  return store.listRecords({})
    .filter((r) => r.mode === 'mock' && r.status !== 'failed' && String(r.title || '').trim())
    .sort((a, b) => String(b.appliedAt || '').localeCompare(String(a.appliedAt || '')))
    .map((r) => ({
      portalKey: r.id,
      contentType: r.contentType || 'webtoon',
      publishForm: r.publishForm || '',
      title: r.title,
      uci: r.uci || '',
      appliedAt: r.appliedAt || '',
      lastAppliedAt: r.appliedAt || '',
      issuedAt: r.issuedAt || '',
      portalStatus: r.portalStatus || PORTAL_LABEL[r.status] || '접수'
    }))
}

/** 현황 한 쪽. 포털과 같이 10건씩, 상태 필터와 작품명 검색을 받는다. */
async function listApplications ({ page = 1, statuses = null, query = '' } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  await networkDelay(150, 400)
  const q = String(query || '').trim()
  let rows = portalRows()
  if (Array.isArray(statuses) && statuses.length) rows = rows.filter((r) => statuses.includes(r.portalStatus))
  if (q) rows = rows.filter((r) => r.title.includes(q))
  const p = Math.max(1, Number(page) || 1)
  return { ok: true, items: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: rows.length, page: p, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) }
}

/** 상태 묶음별 건수. 연습 포털은 목록을 세면 된다. */
async function countApplications ({ statuses } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  if (!Array.isArray(statuses) || !statuses.length) return { ok: false, error: '건수를 셀 상태가 없습니다.' }
  await networkDelay(100, 250)
  return { ok: true, total: portalRows().filter((r) => statuses.includes(r.portalStatus)).length }
}

/** 신청 한 건의 상세. 연습 이력에 저장된 입력값을 포털 상세 화면 모양으로 돌려준다. */
async function getApplicationDetail ({ portalKey } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  const r = store.listRecords({}).find((x) => x.id === portalKey && x.mode === 'mock')
  if (!r) return { ok: false, error: '해당 신청을 찾을 수 없습니다.' }
  await networkDelay(150, 400)
  const day = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, '.') : '')
  return {
    ok: true,
    detail: {
      title: r.title || '',
      publishForm: r.publishForm || '',
      ageGrade: r.ageGrade || '',
      authors: constants.authorsOf(r),
      genres: Array.isArray(r.genres) ? [...r.genres] : [],
      syndicateName: r.syndicateName || '',
      syndicateCode: r.syndicateCode || '',
      url: r.url || '',
      priceKind: r.priceKind || '',
      price: String(r.price ?? ''),
      currency: r.currency || '',
      currencyEtc: r.currencyEtc || '',
      serialStatus: r.serialStatus || '',
      info: { 신청일: day(r.appliedAt), 완료일: day(r.issuedAt), 처리상태: r.portalStatus || PORTAL_LABEL[r.status] || '접수' }
    }
  }
}

/** 여러 건의 상세. 연습에서는 한 건씩 읽는 것과 같다. */
async function getApplicationDetails ({ portalKeys, onProgress } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  const keys = Array.isArray(portalKeys) ? portalKeys : []
  const results = {}
  for (let i = 0; i < keys.length; i++) {
    results[keys[i]] = await getApplicationDetail({ portalKey: keys[i] })
    if (typeof onProgress === 'function') onProgress({ done: i + 1, total: keys.length, title: results[keys[i]].detail?.title || '' })
  }
  return { ok: true, results }
}

/** 발급된 건의 회차 범위. 연습 이력에 적힌 회차 시작·끝을 그대로 돌려준다 (실제 포털은 조회/정정 엑셀에서 읽는다). */
async function getIssuedEpisodes ({ portalKeys } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  const want = new Set(Array.isArray(portalKeys) ? portalKeys : [])
  const episodes = {}
  for (const r of store.listRecords({})) {
    if (r.mode === 'mock' && r.uci && want.has(r.id)) episodes[r.uci] = { start: String(r.episodeStart || ''), end: String(r.episodeEnd || '') }
  }
  return { ok: true, episodes }
}

module.exports = {
  login, logout, getSession, verifyAccess, apply, applyBulk, checkStatus, listApplications, countApplications, getApplicationDetail, getApplicationDetails, getIssuedEpisodes, lookup,
  TYPE_CODE, MOCK_REVIEW_MS
}
