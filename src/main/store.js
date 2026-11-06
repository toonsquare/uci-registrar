'use strict'

const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const constants = require('../shared/uci-constants')
const { IS_DEMO } = require('../shared/app-mode')

/**
 * 로컬 저장소.
 *
 * 설정 · (선택) 저장된 로그인 정보를 사용자 데이터 폴더의 JSON 한 개에 보관한다.
 * Windows 기준 경로: %APPDATA%\UCI 등록 도우미\uci-data.json
 *
 * 신청 이력은 파일에 쓰지 않는다 — 프로그램이 켜져 있는 동안 메모리(records)에만 둔다.
 * 로그인하면 포털에서 현황 전체를 새로 읽어 오므로 지난 실행의 이력을 남겨 둘 이유가 없고,
 * 남겨 두면 포털과 어긋난 줄·손상된 파일 같은 문제만 생겼다 (2026-10-22). 끄면 사라지고 다음 로그인 때 다시 읽는다.
 *
 * 네이티브 DB(sqlite 등)를 쓰지 않는 이유: Windows 크로스 빌드 시 재컴파일이 필요해서
 * 설치 파일 만들 때 자주 깨진다. 이 정도 데이터량이면 JSON으로 충분하다.
 */

const DEFAULT_SETTINGS = {
  /**
   * 'portal' = 실제 국립중앙도서관 포털, 'mock' = 프로그램 안에서만 도는 연습용.
   *
   * 기본값이 실제 포털인 이유: 이건 실제로 UCI를 신청하는 도구다.
   * 기본이 연습용이면 담당자가 신청한 줄 알았는데 포털에는 아무것도 안 간 상태가 되고,
   * 이력에는 남아 있어서 알아채기도 어렵다. 연습이 필요한 사람이 일부러 바꾸는 편이 낫다.
   */
  mode: 'portal',
  /** 국립중앙도서관 서지정보유통지원시스템 */
  portalUrl: 'https://www.nl.go.kr/seoji/',
  /** 발급 코드 접두어. 기관마다 다르므로 설정에서 바꿀 수 있게 뺐다. */
  uciPrefix: 'I410-ECN-0102',
  /** 기관 정보 — 신청 폼 기본값 자동 채우기에 쓰인다. */
  orgName: '',
  orgCode: '',
  /**
   * 등록자번호.
   *
   * 이 값은 참고용 메모다. 포털에 보내지 않는다.
   * 등록자번호는 계정에 묶여 있어서 로그인하면 포털이 이미 알고 있고, 신청 폼에 적는 칸도 없다.
   * 게다가 여기 적은 문자열이 진짜인지 확인할 방법이 없어서, 이 값으로 신청을 막지는 않는다.
   * 실제 판정은 registrantVerifiedAt 쪽에서 한다.
   */
  registrantNo: '',
  /**
   * 등록자번호가 실제로 쓸 수 있는 상태임을 확인한 시각.
   *
   * '포털이 UCI 신청 화면을 열어주는가'로 판정한다. 사용자가 입력한 문자열을 믿는 게 아니라
   * 포털에 직접 물어보는 방식이다. 등록자번호는 한 번 발급되면 바뀌지 않으므로
   * 한 번 확인되면 다시 보지 않는다. (실패는 기록하지 않는다 — 그 사이 발급받았을 수 있으므로)
   */
  registrantVerifiedAt: '',
  /**
   * 신청 담당자 정보. 포털 신청 폼의 필수 항목인데 작품마다 바뀌지 않으므로
   * 설정에 한 번 저장해 두고 신청할 때 자동으로 채운다.
   */
  managerName: '',
  managerEmail: '',
  managerMobile: '',
  /** 결과 안내방법 (handphone | email) */
  receiveMethod: 'handphone',
  /** 개인정보 수집 동의 — 포털 신청 시 필수 체크 항목 */
  privacyAgreed: false,
  /**
   * 마지막으로 로그인한 아이디. 로그아웃하면 저장된 비밀번호는 지우지만
   * 아이디는 남겨 두어 다시 로그인할 때 칸을 채워 준다.
   */
  lastLoginId: '',
  /**
   * 처음 켰을 때 보여주는 안내·연습을 끝냈는지(또는 건너뛰었는지).
   * false 면 로그인 화면 위에 안내가 뜬다. 도움말 메뉴에서 언제든 다시 볼 수 있다.
   */
  onboardingDone: false,

  /** 실제 포털 자동화 시 브라우저 창을 띄워서 눈으로 확인할지 여부 */
  showAutomationWindow: false,
  theme: 'light'
}

/**
 * 데모 빌드의 초기값.
 *
 * 시연할 때 설정 화면부터 채우고 있으면 흐름이 끊긴다. 그래서 담당자 정보와
 * 신청 자격을 미리 채운 상태로 시작한다. 실제 빌드에는 적용되지 않는다.
 */
const DEMO_SEED = {
  mode: 'mock',
  orgName: '(주)툰스퀘어',
  registrantNo: '2024-000100',
  registrantVerifiedAt: '2026-08-19T00:00:00.000Z',
  managerName: '김담당',
  managerEmail: 'demo@tooning.io',
  managerMobile: '010-1234-5678',
  receiveMethod: 'handphone',
  privacyAgreed: true
}

/** 새 저장소가 시작할 설정. 데모면 위 초기값이 덧씌워진다. */
function baseSettings () {
  return IS_DEMO ? { ...DEFAULT_SETTINGS, ...DEMO_SEED } : { ...DEFAULT_SETTINGS }
}

const EMPTY = {
  settings: null, // blank() 에서 baseSettings() 로 채운다
  /** safeStorage 로 암호화된 자격증명 (base64). 저장 안 했으면 null. */
  credential: null
}

let cache = null

/** 신청 이력. 메모리에만 있다 — 파일에 쓰지 않는다 (위 설명). */
let records = []
let seq = 0

/**
 * 데이터를 읽지 못했을 때의 사유. 화면에 그대로 띄운다.
 * 이력이 통째로 사라졌는데 아무 말도 없는 상황을 막기 위한 것이다.
 */
let loadError = null

/**
 * 저장 금지 상태.
 *
 * 파일이 손상되었거나 잠겨서 못 읽었을 때 켜진다. 이때 저장을 허용하면
 * 비어 있는 메모리 상태가 멀쩡한 원본을 덮어써서 이력이 영구히 사라진다.
 * 그래서 원인을 사람이 확인할 때까지 쓰기를 아예 막는다.
 */
let readOnly = false

function filePath () {
  return path.join(app.getPath('userData'), 'uci-data.json')
}

/** 직전 저장본. 쓰기가 중간에 끊겼을 때 되돌아갈 지점이다. */
function backupPath () {
  return `${filePath()}.bak`
}

function blank () {
  return { ...JSON.parse(JSON.stringify(EMPTY)), settings: baseSettings() }
}

/** 파일 내용을 저장소 모양으로. 예전 판이 파일에 남긴 이력(records)·seq 는 읽지 않는다. */
function shape (parsed) {
  return {
    ...EMPTY,
    settings: { ...baseSettings(), ...(parsed.settings || {}) },
    credential: parsed.credential || null
  }
}

/** 읽어서 파싱까지 되면 돌려주고, 안 되면 null. */
function tryRead (file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return parsed && typeof parsed === 'object' ? shape(parsed) : null
  } catch {
    return null
  }
}

function stamp () {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * 저장소를 읽는다.
 *
 * '파일이 없다(첫 실행)'와 '파일이 있는데 못 읽는다(손상·잠김)'를 반드시 구분한다.
 * 둘을 같이 처리하면 손상된 순간 조용히 빈 상태로 시작해 버리고,
 * 그 뒤 아무 저장이나 한 번 일어나면 원본(담당자 정보·저장된 로그인)이 덮여 복구가 불가능해진다.
 */
function load () {
  if (cache) return cache

  const file = filePath()
  loadError = null
  readOnly = false

  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      // 첫 실행. 다만 백업만 남아 있다면 직전 저장이 중간에 끊긴 흔적이므로 되살린다.
      const restored = tryRead(backupPath())
      if (restored) {
        cache = restored
        loadError = '직전 저장이 중단되어 백업본에서 복구했습니다.'
      } else {
        cache = blank()
      }
      return cache
    }
    // 잠김·권한 문제. 원본이 멀쩡할 수 있으므로 절대 덮어쓰지 않는다.
    cache = blank()
    readOnly = true
    loadError = `설정 파일을 열 수 없습니다 (${e.code}). 다른 프로그램이 파일을 잠그고 있을 수 있습니다. ` +
      '설정이 덮어써지지 않도록 이번 실행에서는 저장을 하지 않습니다.'
    return cache
  }

  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (parsed && typeof parsed === 'object') {
      cache = shape(parsed)
      return cache
    }
    throw new Error('최상위가 객체가 아닙니다')
  } catch (e) {
    // 내용이 깨졌다. 원본을 따로 보관해 두고 백업본으로 되살려 본다.
    const kept = `${file}.corrupt-${stamp()}.json`
    try { fs.copyFileSync(file, kept) } catch { /* 보관 실패는 복구를 막지 않는다 */ }

    const restored = tryRead(backupPath())
    if (restored) {
      cache = restored
      loadError = `설정 파일이 손상되어 백업본에서 복구했습니다. 손상된 파일은 ${path.basename(kept)} 로 보관했습니다.`
      return cache
    }

    cache = blank()
    readOnly = true
    loadError = `설정 파일이 손상되었고 백업본도 없습니다 (${e.message}). ` +
      `손상된 파일을 ${path.basename(kept)} 로 보관했습니다. ` +
      '남은 내용을 살릴 수 있도록 이번 실행에서는 설정을 저장하지 않습니다.'
    return cache
  }
}

/**
 * 저장.
 *
 * 임시 파일에 다 쓴 뒤 이름을 바꿔치기한다. rename 은 같은 볼륨에서 원자적이라
 * 쓰는 도중 앱이 죽어도 원본이 반쪽짜리로 남지 않는다.
 * 바꿔치기 직전의 원본은 .bak 으로 남겨 한 세대 전으로 돌아갈 수 있게 한다.
 */
function persist () {
  if (readOnly) return false

  const file = filePath()
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8')

  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, backupPath())
  } catch { /* 백업 실패가 저장 자체를 막지는 않는다 */ }

  fs.renameSync(tmp, file)
  return true
}

/** 화면에 띄울 문제 상황. 없으면 null. */
function getHealth () {
  load()
  return { error: loadError, readOnly, filePath: filePath() }
}

/* ---------------------------------------------------------------- 설정 */

function getSettings () {
  const settings = { ...load().settings }
  // 데모는 저장된 값이 무엇이든 모의로 읽힌다. 남의 PC에서 켜도 포털로 안 넘어간다.
  if (IS_DEMO) settings.mode = 'mock'
  return settings
}

function setSettings (patch) {
  const db = load()
  // 포털은 휴대폰번호를 xxx-xxxx-xxxx 형식으로만 받는다. 저장 시점에 맞춰 둔다.
  if (patch.managerMobile != null) {
    patch = { ...patch, managerMobile: constants.formatMobile(patch.managerMobile) }
  }
  if (IS_DEMO && patch.mode != null) {
    patch = { ...patch, mode: 'mock' }
  }
  db.settings = { ...db.settings, ...patch }
  persist()
  return { ...db.settings }
}

/* ------------------------------------------------------------ 발급 이력 */

/**
 * 조건에 맞는 기록을 지운다. 지운 개수를 돌려준다.
 * 연습(모의) 기록을 실제 이력에서 걷어낼 때 쓴다.
 */
function removeRecords (predicate) {
  const before = records.length
  records = records.filter((r) => !predicate(r))
  const removed = before - records.length
  return removed
}

function nextSeq () {
  return ++seq
}

function addRecord (record) {
  const row = { id: `r${Date.now()}-${nextSeq()}`, ...record }
  records.unshift(row)
  return row
}

/**
 * 이 기록이 그 계정에 보이는가.
 * 기록은 신청한 계정(account)을 달고 있다. 계정 표시가 없는 예전 기록은 누구에게나 보인다 —
 * 어느 계정 것인지 알 수 없어서인데, 포털 현황과 맞춰 보다 일치하면 그때 계정이 붙는다 (mergePortalRecords).
 * account 를 안 주면(undefined) 구분 없이 전부 본다 (시험·정리용).
 */
function visibleTo (r, account) {
  if (account === undefined || account === null) return true
  return !r.account || r.account === account
}

function listRecords ({ query = '', status = 'all', account, onPortal = false } = {}) {
  const q = query.trim().toLowerCase()
  return records.filter((r) => {
    if (!visibleTo(r, account)) return false
    // 포털에 보이는 것만. 포털 현황에서 짝을 찾은 기록은 포털 키가 붙어 있다. 신청 시점에 거부된 건,
    // 마지막 전체 읽기 때 포털에 없던 건(goneAt)은 빠진다.
    if (onPortal && (!r.portalKey || r.goneAt)) return false
    if (status !== 'all' && r.status !== status) return false
    if (!q) return true
    return [r.uci, r.title, r.writer, r.syndicateName, r.url]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
  }).sort(byPortalOrder)
}

/** 포털 현황과 같은 차례: 최초신청일시가 늦은 것이 위, 같으면 포털 키가 큰 것이 위. */
function byPortalOrder (a, b) {
  return String(b.appliedAt || '').localeCompare(String(a.appliedAt || '')) ||
    String(b.portalKey || '').localeCompare(String(a.portalKey || ''), undefined, { numeric: true })
}

/**
 * 포털 현황 전체를 읽은 뒤 부른다. 이번에 본 키에 없는 기록은 포털에서 사라진 것(삭제·다른 계정)이라 화면에서 뺀다 (goneAt).
 * 다시 보이면 되살린다. 기록 자체는 지우지 않는다 — 입력값과 UCI 는 남겨 둔다.
 */
function markPortalSync (account, seenKeys) {
  const seen = new Set(seenKeys || [])
  const now = new Date().toISOString()
  let gone = 0
  let back = 0
  for (const r of records) {
    if (!r.portalKey || !visibleTo(r, account)) continue
    if (seen.has(r.portalKey)) {
      if (r.goneAt) { delete r.goneAt; back++ }
    } else if (!r.goneAt) {
      r.goneAt = now
      gone++
    }
  }
  return { gone, back }
}

/** 상세를 아직 안 읽은, 포털에 있는 기록. 불러오기가 상세를 읽을 대상이다. 이력은 켜져 있는 동안만 있으므로 로그인마다 전부 읽는다. */
function recordsNeedingDetail (account) {
  return listRecords({ account, onPortal: true }).filter((r) => !r.detailAt)
}

/** 발급된 건의 회차 시작·끝을 포털(조회/정정 엑셀) 값으로 맞춘다. episodes: { [uci]: { start, end } }. 바뀐 건수를 돌려준다. */
function applyEpisodes (episodes, account) {
  let changed = 0
  for (const r of records) {
    if (!r.uci || !visibleTo(r, account)) continue
    const e = episodes && episodes[r.uci]
    if (!e) continue
    // 엑셀은 0001 처럼 네 자리로 준다. 신청 폼과 화면은 1 로 쓰므로 앞의 0 을 뗀다.
    const num = (v) => { const t = String(v ?? '').trim(); return /^\d+$/.test(t) ? String(Number(t)) : t }
    const start = num(e.start)
    const end = num(e.end)
    const patch = {}
    if (start && start !== String(r.episodeStart || '')) patch.episodeStart = start
    if (end && end !== String(r.episodeEnd || '')) patch.episodeEnd = end
    if (Object.keys(patch).length) { Object.assign(r, patch); changed++ }
  }
  return changed
}

function getRecord (id) {
  const row = records.find((r) => r.id === id)
  return row ? { ...row } : null
}

/** 포털 키 → 기록. 현황 한 쪽을 화면에 그릴 때 이력에 저장된 입력값(작가·장르 등)을 붙이는 데 쓴다. */
function recordsByKeys (keys, account) {
  const want = new Set(keys || [])
  const out = {}
  for (const r of records) if (r.portalKey && want.has(r.portalKey) && visibleTo(r, account)) out[r.portalKey] = { ...r }
  return out
}

/**
 * 포털 상세 화면에서 읽은 값을 기록에 넣는다. 포털에 있는 값이 기준이므로 그대로 덮어쓴다.
 * 머리 부분(info)의 신청일·완료일·처리상태 외의 항목(반려 사유 등)은 비고(error)로 남긴다.
 */
function applyDetail (id, detail) {
  const d = detail || {}
  const authors = constants.authorsOf({ authors: d.authors })
  const info = d.info || {}
  // 비고에는 처리내용(반려·보완 사유)처럼 머리 정보에만 있는 것을 남긴다. 작품코드(발급일)는 UCI 에 이미 들어 있다.
  const extra = Object.entries(info).filter(([k]) => !/신청일|완료일|처리상태|작품코드/.test(k)).map(([k, v]) => v && `${k}: ${v}`).filter(Boolean).join(' / ')
  const patch = {
    publishForm: d.publishForm || '',
    ageGrade: d.ageGrade || '',
    authors,
    writerRole: authors.map((a) => a.role).join(', '),
    writer: authors.map((a) => a.name).join(', '),
    genres: Array.isArray(d.genres) ? [...d.genres] : [],
    syndicateName: d.syndicateName || '',
    syndicateCode: d.syndicateCode || '',
    url: d.url || '',
    priceKind: d.priceKind || '',
    price: d.price ?? '',
    currency: d.currency || '',
    currencyEtc: d.currencyEtc || '',
    serialStatus: d.serialStatus || '',
    detailAt: new Date().toISOString()
  }
  if (d.title) patch.title = d.title
  if (info['처리상태']) {
    const st = constants.splitPortalStatus(info['처리상태'])
    patch.portalStatus = st.status
    if (st.note) patch.portalNote = st.note
  }
  // 비고: 처리내용(사유)이 있으면 그것으로. 없으면 있던 것(심사 결과 조회가 적은 사유 등)을 둔다.
  if (extra) patch.error = extra
  return updateRecord(id, patch)
}

/** 심사 결과가 나온 뒤 해당 신청 건을 갱신한다. */
function updateRecord (id, patch) {
  const row = records.find((r) => r.id === id)
  if (!row) return null
  Object.assign(row, patch)
  return { ...row }
}

/**
 * 아직 결과가 안 나온 신청 건들. 결과 조회 대상이다.
 * 보완요청(needsFix)도 포함한다 — 담당자가 포털에서 고치면 다시 심사로 넘어가기 때문이다.
 */
/**
 * 로그인 직전에 부른다. 다른 아이디로 들어오면 앞 계정에서 읽어 둔 등록자 정보를 지운다.
 *
 * 등록자번호·기관명·기관 코드·확인 시각은 로그인한 계정에서 읽어 온 값인데, 로그아웃해도 남아 있었다.
 * 그 상태로 다른 계정이 들어오면 자격 확인이 '이미 확인됨' 으로 건너뛰고, 화면에는 앞 계정의 기관명이
 * 그대로 보였다 (2026-10-16 파트너 보고: A 로그아웃 → B 로그인 때 두 회사 정보가 섞임).
 * 모의 연동에서는 이 값들이 흉내용 입력이라 건드리지 않는다.
 *
 * @returns 지웠으면 true
 */
function prepareLogin (loginId, mode = getSettings().mode) {
  const s = getSettings()
  if (mode === 'mock') return false   // 모의 연동의 등록자 정보는 흉내용 입력값이라 두고, 실제 연동(portal·api)만 지운다
  if (!s.lastLoginId || s.lastLoginId === loginId) return false
  setSettings({ registrantNo: '', orgName: '', orgCode: '', registrantVerifiedAt: '' })
  return true
}

/** ISO 시각을 이 컴퓨터 기준 날짜(YYYY-MM-DD)로. 같은 작품이 여럿일 때 신청일로 가르는 데 쓴다. */
/** 두 시각이 며칠 떨어져 있는지 (날짜 기준). 둘 중 하나라도 없으면 Infinity. */
function dayGap (a, b) {
  const da = localDay(a); const db2 = localDay(b)
  if (!da || !db2) return Infinity
  return Math.abs(Math.round((new Date(da) - new Date(db2)) / 86400000))
}

function localDay (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 포털 신청 현황 목록을 이력에 합친다.
 *
 * 이력은 PC 마다 따로 저장되므로 다른 PC 에서 신청한 건과 포털에서 직접 신청한 건은 보이지 않았다.
 * 같은 유형·작품명이면 같은 작품으로 보고(여럿이면 신청일이 같은 것, 그다음 UCI 가 같은 것), 있으면
 * 상태·UCI·날짜만 갱신하고 입력값(작가·장르 등)은 건드리지 않는다. 없으면 새 줄로 넣되 source: 'portal'
 * 로 표시한다 — 입력값이 비어 있는 이유를 화면이 알 수 있게.
 *
 * @param items { contentType, publishForm, title, uci, status, appliedAt, expectedAt, issuedAt, portalStatus }[]
 * @returns { added, updated }
 */
function mergePortalRecords (items, account = '') {
  const now = new Date().toISOString()
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim()
  let added = 0
  let updated = 0
  const used = new Set()   // 이번 목록에서 이미 짝이 된 기록. 포털 줄 하나에 기록 하나만 붙인다.

  for (const it of items || []) {
    const title = norm(it.title)
    if (!title) continue
    const type = it.contentType || 'webtoon'
    /*
     * 포털 줄과 이력의 짝 맞추기. 이 계정에 보이는 기록 안에서만 찾는다 (다른 계정의 같은 작품명을 건드리지 않는다).
     *   ① UCI 가 있으면 같은 UCI 의 기록 — 가장 확실한 짝.
     *   ② 없으면 같은 유형·같은 작품명 가운데 UCI 가 안 붙은 기록을, 최초신청일이 같은 날(±1일)인 것으로 고른다.
     * 예전에는 같은 작품명이면 무조건 한 기록으로 합쳤다. 그러면 포털에 같은 이름의 신청이 여럿인 계정(권별 등록,
     * 지웠다 다시 낸 신청)에서 줄이 하나로 뭉개져 건수가 줄고, 발급된 기록에 지운 신청의 상태가 덮여
     * 「UCI 는 있는데 반려」로 보였다 (2026-10-21 감리 리뷰에서 발견). 이미 다른 UCI 가 붙은 기록은 다른 신청이므로 건드리지 않는다.
     */
    const mine = records.filter((r) => !used.has(r.id) && visibleTo(r, account) && (r.contentType || 'webtoon') === type)
    let row = null
    // ⓪ 포털 키가 같으면 그 기록. 현황 줄마다 포털 내부 키가 있어 가장 확실하다 (2026-10-21).
    if (it.portalKey) row = mine.find((r) => r.portalKey && r.portalKey === it.portalKey) || null
    if (!row && it.uci) row = mine.find((r) => r.uci === it.uci) || null
    if (!row) {
      // 이 프로그램으로 낸 신청은 아직 포털 키가 없다. 키가 이미 붙은 기록은 다른 줄의 것이므로 건드리지 않는다.
      const free = mine.filter((r) => norm(r.title) === title && !r.uci && (!r.portalKey || (it.portalKey && r.portalKey === it.portalKey)))
      const day = localDay(it.appliedAt)
      const sameDay = day ? free.filter((r) => localDay(r.appliedAt) === day) : []
      // 같은 날 후보가 여럿이면(한 작품을 두 번 낸 경우) 상태·최근신청일까지 같은 줄을 먼저 고른다.
      row = sameDay.find((r) => (r.portalStatus || '') === (it.portalStatus || '') && (r.lastAppliedAt || '') === (it.lastAppliedAt || '')) ||
        sameDay[0] || (day ? free.find((r) => dayGap(r.appliedAt, it.appliedAt) === 1) : null) ||
        (!day && free.length === 1 ? free[0] : null) || null
    }
    if (row) used.add(row.id)

    if (row) {
      const patch = {}
      // 계정 표시가 없던 예전 기록이 이 계정의 포털 현황과 일치했다 — 이 계정 것으로 붙인다.
      if (account && !row.account) patch.account = account
      if (it.portalKey && it.portalKey !== row.portalKey) patch.portalKey = it.portalKey
      if (row.goneAt) patch.goneAt = ''   // 다시 보인다
      const status = it.status || row.status
      if (status !== row.status) patch.status = status
      if (it.uci && it.uci !== row.uci) patch.uci = it.uci
      if (it.issuedAt && it.issuedAt !== row.issuedAt) patch.issuedAt = it.issuedAt
      if ((it.lastAppliedAt || '') !== (row.lastAppliedAt || '')) patch.lastAppliedAt = it.lastAppliedAt || ''
      if ((it.portalStatus || '') !== (row.portalStatus || '')) patch.portalStatus = it.portalStatus || ''
      if ((it.portalNote || '') !== (row.portalNote || '')) patch.portalNote = it.portalNote || ''
      if (it.appliedAt && (!row.appliedAt || (row.source === 'portal' && it.appliedAt !== row.appliedAt))) patch.appliedAt = it.appliedAt
      // 실패 기록이 포털에서 확인되면(다른 PC 나 포털에서 다시 낸 경우) 실패 사유는 더 이상 맞지 않는다.
      if (patch.status && (patch.status !== 'failed' || row.status === 'failed')) patch.error = ''
      if (Object.keys(patch).length) {
        Object.assign(row, patch, { checkedAt: now })
        updated++
      }
      continue
    }

    const id = `r${Date.now()}-${nextSeq()}`
    used.add(id)
    records.push({
      id,
      account: account || '',
      portalKey: it.portalKey || '',
      source: 'portal',
      mode: 'portal',
      contentType: type,
      publishForm: it.publishForm || '',
      title,
      authors: [],
      writerRole: '',
      writer: '',
      genres: [],
      syndicateName: '',
      syndicateCode: '',
      url: '',
      ageGrade: '',
      priceKind: '',
      price: '',
      currency: '',
      serialStatus: '',
      episodeStart: '',
      episodeEnd: '',
      uci: it.uci || '',
      status: it.status || 'pending',
      error: '',
      appliedAt: it.appliedAt || '',
      lastAppliedAt: it.lastAppliedAt || '',
      expectedAt: it.expectedAt || '',
      issuedAt: it.issuedAt || '',
      portalStatus: it.portalStatus || '',
      portalNote: it.portalNote || '',
      checkedAt: now
    })
    added++
  }

  if (added || updated) {
    // 최신 신청이 위로. 포털에서 가져온 줄이 섞여 들어오므로 신청일로 다시 줄 세운다.
    records.sort((a, b) => String(b.appliedAt || '').localeCompare(String(a.appliedAt || '')))
  }
  return { added, updated }
}

/**
 * 끝나지 않은 연습을 정리한다. 켤 때 한 번 부른다.
 *
 * 연습(모의 연동)은 프로그램이 켜져 있는 동안만 의미가 있다. 연습 도중 프로그램이 꺼지면 설정에
 * 모의 연동이 남아 다음에 켤 때 포털에 붙지 않는데, 고급 설정을 감춘 빌드에서는 되돌릴 방법이 없었다
 * (2026-10-16 실제로 겪음). 모의 기록을 지우고 실제 연동으로 되돌린다.
 */
function clearLeftoverPractice () {
  if (getSettings().mode !== 'mock') return { reset: false, removed: 0 }
  const removed = removeRecords((r) => r.mode === 'mock')
  setSettings({ mode: 'portal' })
  return { reset: true, removed }
}

function pendingRecords (account) {
  return records.filter((r) => visibleTo(r, account) && (r.status === 'pending' || r.status === 'needsFix'))
}

function deleteRecord (id) {
  const before = records.length
  records = records.filter((r) => r.id !== id)
  return before !== records.length
}

/** 이력을 지운다. account 를 주면 그 계정 것(과 계정 표시 없는 것)만, 안 주면 전부. */
function clearRecords (account) {
  const before = records.length
  records = records.filter((r) => !visibleTo(r, account))
  const n = before - records.length
  return n
}

/** 상태별 건수. onPortal 이면 포털 현황에 있는 줄만 (대시보드·불러오기 대조가 쓴다). */
function stats (account, { onPortal = false } = {}) {
  const rows = records.filter((r) => visibleTo(r, account) && (!onPortal || (r.portalKey && !r.goneAt)))
  const today = new Date().toISOString().slice(0, 10)
  const by = (s) => rows.filter((r) => r.status === s).length
  return {
    total: rows.length,
    pending: by('pending'),
    needsFix: by('needsFix'),
    issued: by('issued'),
    rejected: by('rejected'),
    failed: by('failed'),
    todayApplied: rows.filter((r) => (r.appliedAt || '').slice(0, 10) === today).length
  }
}

/* ---------------------------------------------------------- 자격증명 저장 */

function saveCredential (loginId, password) {
  const db = load()
  const payload = JSON.stringify({ loginId, password })
  if (safeStorage.isEncryptionAvailable()) {
    db.credential = {
      encrypted: true,
      value: safeStorage.encryptString(payload).toString('base64')
    }
  } else {
    // OS 암호화 기능(Windows DPAPI)을 못 쓰는 환경(드묾). 비밀번호는 저장하지 않고 아이디만 남긴다.
    db.credential = { encrypted: false, value: JSON.stringify({ loginId, password: '' }) }
  }
  persist()
}

function getCredential () {
  const db = load()
  if (!db.credential) return null
  try {
    const raw = db.credential.encrypted
      ? safeStorage.decryptString(Buffer.from(db.credential.value, 'base64'))
      : db.credential.value
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clearCredential () {
  const db = load()
  db.credential = null
  persist()
}

module.exports = {
  markPortalSync, recordsNeedingDetail, applyEpisodes,
  removeRecords,
  DEFAULT_SETTINGS,
  filePath,
  backupPath,
  getHealth,
  getSettings,
  setSettings,
  addRecord,
  listRecords,
  getRecord,
  recordsByKeys,
  applyDetail,
  updateRecord,
  pendingRecords,
  prepareLogin,
  mergePortalRecords,
  clearLeftoverPractice,
  deleteRecord,
  clearRecords,
  stats,
  saveCredential,
  getCredential,
  clearCredential
}
