'use strict'

/* =========================================================================
   UCI 등록 도우미 — 화면 로직
   window.uci (preload) 를 통해서만 본체와 통신한다.
   ========================================================================= */

const api = window.uci

const state = {
  user: null,
  settings: null,
  portalConfigured: false,
  demo: false,
  /** 신청 화면의 작품 카드들. 1개면 건별, 2개 이상이면 엑셀 일괄. */
  works: [{}],
  view: 'dashboard',
  /** 이 계정의 신청 이력 전체 (포털에 있는 것만). 로그인 직후 불러오기가 포털에서 읽어 저장한 것을 본체에서 받는다. */
  records: [],
  history: { page: 1, pageSize: 0 },   // pageSize 0 = 아직 안 고름 → 설정값, 없으면 10
  filter: { query: '', status: 'all' },
  timing: { loginAt: 0 },
  /** 뒤에서 도는 신청 내역 불러오기. { running, scope, progress, last, dirty } — 상단 바 표시와 화면 다시 그리기에 쓴다. */
  sync: { running: false, scope: null, progress: null, last: null, dirty: false },
  lastResult: null
}

/* 포털에서 확인한 선택 목록. src/shared/uci-constants.js 에서 온다. */
const {
  CONTENT_TYPES, PUBLISH_FORMS, SERIAL_STATUS, WRITER_ROLES, AGE_GRADES, authorsOf, HISTORY_PAGE_SIZES,
  GENRES, SYNDICATES, PRICE_KINDS, CURRENCIES, RECEIVE_METHODS,
  SHOW_ADVANCED_SETTINGS, TOOLTIPS, typeProblem, normalizeUrl,
  formatMobile, isValidMobile, isValidEmail
} = window.UCI

/*
 * 상태 글자는 포털의 신청상태(접수 / 재접수 / 회차추가 / 보완요청 / 완료 / 처리불가 / 삭제)를 그대로 쓴다.
 * 여기 적힌 것은 포털 글자가 아직 없는 줄(막 신청한 건, 실패한 건)의 대체 글자다. 우리말을 새로 만들지 않는다 (2026-10-22).
 */
const STATUS_LABEL = {
  pending: '접수',
  needsFix: '보완요청',
  issued: '완료',
  rejected: '처리불가',
  failed: '신청실패'
}
/** 대시보드 묶음·이력 필터의 묶음 이름. 포털 글자를 그대로 묶는다. */
const GROUP_LABEL = {
  pending: '접수·재접수·회차추가',
  needsFix: '보완요청',
  issued: '완료',
  rejected: '처리불가·삭제'
}

const VIEW_META = {
  dashboard: { title: '대시보드', subtitle: '신청 현황과 심사 결과를 확인합니다.' },
  issue: { title: 'UCI 신청', subtitle: '작품 정보를 입력해 신청합니다. 작품을 추가하면 한 건씩 차례로 신청합니다.' },
  history: { title: '신청 이력', subtitle: '이 프로그램으로 신청한 기록을 조회합니다.' },
  settings: { title: '설정', subtitle: '신청 담당자 정보와 등록자 정보를 관리합니다.' },
  help: { title: '도움말', subtitle: 'UCI가 무엇인지, 어떻게 받는지, 어디서 확인하는지.' }
}

/* ------------------------------------------------------------------ 유틸 */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))

/** 사용자 입력이 그대로 HTML로 들어가지 않도록 항상 이 함수를 거친다. */
function esc (v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function fmtDateTime (iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDate (iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `1~10화` 형태로 보여준다. 값이 없으면 '-'. */
/*
 * 스켈레톤 — 아직 안 온 값의 자리. 글 대신 배경색이 다른 둥근 네모를 두고 은은하게 깜빡인다
 * (tooning-ionic-admin 의 app-resource-item 이 이미지를 받기 전에 보여 주는 skeleton-box 와 같은 방식).
 * 뒤에서 포털을 읽는 동안에만 쓴다. 다 읽은 뒤에 비어 있는 값은 「-」 로 그대로 둔다.
 */
// 크기는 클래스로 정한다 — 화면의 보안 설정(CSP) 이 inline style 을 막는다. 종류: count(건수) ep(회차) writer(작가) syn(연재처) meta(한 줄 요약) total(건수 글)
/** 신청 이력 UCI 칸의 복사 아이콘. 인라인 SVG 는 CSP(script/style 만 제한)에 걸리지 않는다 */
const COPY_ICON = '<svg class="uci-copy-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5H5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'

function skel (kind) {
  return `<span class="skel skel-${kind}"></span>`
}
/** 아직 줄이 하나도 없을 때 표·목록이 들어갈 자리 전체를 한 덩어리로. rows 는 대신할 줄 수 (높이). */
function skelBlock (rows) {
  return `<div class="skel skel-block skel-block-${rows}"></div>`
}
/** 읽는 중이라 아직 못 보여 주는 자리의 툴팁 첫 문장. 잠긴 버튼과 상태 글자가 같이 쓴다. */
const LOADING_TIP = '포털에서 신청 내역을 읽는 중입니다.'

/** 포털에서 읽는 중이고 이 줄의 상세(작가·연재처 등)가 아직 안 왔는가. */
function detailPending (r) {
  return state.sync.running && !r.detailAt && r.source === 'portal'
}
/** 포털에서 읽는 중이고 이 줄의 회차 범위가 아직 안 왔는가 (발급된 건만 포털이 알려 준다). */
function episodesPending (r) {
  return state.sync.running && r.status === 'issued' && !r.episodeStart && !r.episodeEnd
}

function episodeRange (r) {
  if (episodesPending(r)) return skel('ep')
  if (!r.episodeStart && !r.episodeEnd) return '-'
  if (r.episodeStart === r.episodeEnd) return `${esc(r.episodeStart)}화`
  return `${esc(r.episodeStart || '?')}~${esc(r.episodeEnd || '?')}화`
}

function typeLabel (key) {
  return (CONTENT_TYPES.find((c) => c.value === key) || CONTENT_TYPES[0]).label
}

function toast (message, kind = 'info') {
  const host = $('#toast-host')
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = message
  host.appendChild(el)
  setTimeout(() => el.remove(), 3200)
}

/** 처리 중인 버튼을 잠그고 스피너를 보여준다. */
function busy (button, on, labelWhenBusy = '처리 중…') {
  if (!button) return
  if (on) {
    button.dataset.label = button.textContent
    button.disabled = true
    button.innerHTML = `<span class="spinner"></span>${esc(labelWhenBusy)}`
  } else {
    button.disabled = false
    button.textContent = button.dataset.label || button.textContent
  }
}

function selectOptions (values, selected) {
  return values.map((v) => {
    const [val, label] = Array.isArray(v) ? v : [v, v || '(선택 안 함)']
    return `<option value="${esc(val)}"${val === selected ? ' selected' : ''}>${esc(label)}</option>`
  }).join('')
}

/* ------------------------------------------------------------------ 로그인 */

async function initLogin () {
  // 데모 여부는 빌드에 박혀 있다. 화면에서 바꿀 수 없다.
  const info = await api.app.info()
  state.demo = info?.demo === true
  const mark = $('#demo-badge')
  if (mark) mark.hidden = !state.demo

  await refreshSettings()
  applyModeBadges()

  // 로그아웃해도 아이디는 남겨 두어 다시 들어올 때 칸을 채워 준다.
  $('#login-id').value = state.settings?.lastLoginId || ''

  const saved = await api.auth.savedCredential()
  if (saved.ok && saved.credential) {
    $('#login-id').value = saved.credential.loginId || ''
    $('#login-pw').value = saved.credential.password || ''
    $('#login-remember').checked = true
    // 로그인 정보를 저장해 뒀으면 켜자마자 들어간다. (슬랙처럼)
    return autoLogin(saved.credential)
  }
  $(state.settings?.lastLoginId ? '#login-pw' : '#login-id').focus()

  // 처음 켠 사람에게는 로그인보다 먼저 'UCI 가 뭔지' 부터 보여준다.
  if (!state.settings?.onboardingDone) showOnboarding()
}

/**
 * 저장된 정보로 자동 로그인한다.
 *
 * 포털은 로그인 상태를 오래 붙잡아 두지 않아서(세션 1시간) 켤 때마다 실제로 다시
 * 로그인한다. 몇 초 걸리므로 그동안 '로그인 중' 을 보여주고, 사용자가 취소할 수 있게 한다.
 * 실패하면(비밀번호 변경·포털 점검 등) 로그인 화면으로 돌려보내고 이유를 보여준다.
 */
let autoLoginRun = 0
async function autoLogin (cred) {
  const run = ++autoLoginRun
  $('#login-auto-id').textContent = cred.loginId || ''
  $('#login-auto').hidden = false
  $('#login-form').hidden = true

  const result = await doLogin({ loginId: cred.loginId, password: cred.password, remember: true })

  // 기다리는 사이 사용자가 취소했으면, 뒤늦게 온 결과로 화면을 바꾸지 않는다.
  if (run !== autoLoginRun) {
    if (result?.ok) await api.auth.logout().catch(() => {})
    return
  }

  $('#login-auto').hidden = true
  $('#login-form').hidden = false
  if (!result.ok) {
    const box = $('#login-error')
    box.textContent = `자동 로그인에 실패했습니다. ${result.error || ''}`.trim()
    box.hidden = false
    $('#login-pw').focus()
  }
}

$('#login-auto-cancel').addEventListener('click', () => {
  autoLoginRun++ // 진행 중이던 자동 로그인의 결과를 버린다
  $('#login-auto').hidden = true
  $('#login-form').hidden = false
  $('#login-pw').focus()
})

/**
 * 지금 어느 모드인지 화면 곳곳에 표시한다.
 *
 * 요소가 없어도 그냥 건너뛴다. 여기서 터지면 이 함수를 부른 쪽(로그인 완료, 설정 저장 등)이
 * 통째로 중단돼서, 정작 중요한 동작이 조용히 실패한다. 표시가 하나 빠지는 것보다 그게 훨씬 나쁘다.
 */
function applyModeBadges () {
  const isPortal = !state.demo && state.settings?.mode !== 'mock'
  const label = state.demo ? '데모' : (isPortal ? '실제 포털 연동' : '연습 모드')

  const badge = $('#login-mode-badge')
  if (badge) {
    badge.textContent = label
    badge.className = `badge ${isPortal ? 'badge-warning' : ''}`
  }

  const sidebar = $('#sidebar-mode')
  if (sidebar) sidebar.textContent = label

  const hint = $('.login-hint')
  if (hint) {
    hint.innerHTML = state.demo
      ? '데모입니다. 아무 아이디·비밀번호나 넣으면 로그인됩니다.'
      : isPortal
        ? '국립중앙도서관 포털 계정으로 로그인합니다.'
        : '아무 아이디·비밀번호로 로그인됩니다. (비밀번호 <code>fail</code> 입력 시 실패 화면 확인)'
  }
}

/**
 * 로그인하고, 되면 앱 화면으로 들어간다. 직접 로그인과 자동 로그인이 함께 쓴다.
 * 결과를 돌려주기만 하고 오류 표시는 부른 쪽이 한다.
 */
async function doLogin (payload) {
  let result
  try {
    result = await api.auth.login(payload)
  } catch (e) {
    // 본체와의 통신 자체가 끊긴 경우. 이걸 안 잡으면 버튼이 영영 돌기만 한다.
    return { ok: false, error: `로그인 처리 중 오류가 발생했습니다: ${e?.message || '알 수 없는 오류'}` }
  }
  if (!result.ok) return { ok: false, error: result.error || '로그인에 실패했습니다.' }

  state.user = result.user
  // 신청 자격(등록자번호) 확인 결과. 로그인은 됐지만 신청은 못 하는 상태가 있다.
  state.accessError = result.access && !result.access.ok ? result.access.error : null
  state.records = []
  state.timing.loginAt = performance.now()
  state.timing.enterAt = performance.now()
  // 신청 내역 불러오기는 본체가 뒤에서(불러오기 전용 숨은 창) 돌린다. 화면은 기다리지 않고 바로 들어간다.
  if (result.syncing) setSyncRunning('full')

  try {
    enterApp()
  } catch (e) {
    return { ok: false, error: `화면을 여는 중 오류가 발생했습니다: ${e?.message || '알 수 없는 오류'}` }
  }
  return { ok: true }
}

/* ------------------------------------------------- 뒤에서 도는 불러오기 */

/*
 * 로그인하면 본체가 포털에서 신청 내역 전체(현황 + 각 건 상세 + 회차 범위)를 읽어 저장하는데, 그걸 기다리지 않는다.
 * 예전에는 「불러오는 중」 화면이 다 읽을 때까지 막고 있어서 로그인 뒤 한참을 기다려야 했다 (2026-10-22).
 * 지금은 로그인하면 바로 대시보드가 뜨고, 각 화면은 들어갈 때 저장된 이력을 읽어 그린다. 뒤에서 쪽을 읽어 저장할 때마다
 * 본체가 진행을 알려 오면 보고 있는 화면(대시보드·이력·불러오기 창)만 다시 그린다. 상단 바에 진행을 작게 보여 준다.
 */
function setSyncRunning (scope) {
  state.sync = { running: true, scope, progress: null, last: null, dirty: false, counts: null }
  renderSyncChip()
}

let syncRedrawTimer = null
function onSyncEvent (p) {
  if (!p) return
  if (p.phase === 'start') { setSyncRunning(p.scope); return }
  if (p.phase === 'done') {
    const res = p.result || { ok: false }
    state.sync = { running: false, scope: res.scope || state.sync.scope, progress: null, last: res, dirty: false, counts: res.counts || state.sync.counts || null }
    clearTimeout(syncRedrawTimer)
    if (state.timing.loginAt) {
      const ms = Math.round(performance.now() - state.timing.loginAt)
      state.timing.loginAt = 0
      state.timing.loadingMs = ms
      console.log(`[속도] 로그인 응답 → 뒤에서 불러오기 ${res.ok ? '완료' : '실패'} ${ms}ms — ${res.ok ? `현황 ${res.pages}쪽 ${res.total}건 · 상세 ${res.detailed}건 · 회차 ${res.episodes}건` : res.error}`)
    }
    renderSyncChip()
    redrawAfterSync()
    return
  }
  state.sync.running = true
  state.sync.progress = p
  // 상태 묶음별 건수가 먼저 온다. 대시보드는 목록을 다 읽기 전에 이 숫자를 보여 준다.
  if (p.phase === 'counts' && p.counts) {
    state.sync.counts = { ...p.counts }
    if (state.view === 'dashboard') render()
  }
  renderSyncChip()
  // 쪽을 읽어 저장할 때마다 화면을 다시 그리면 숫자가 차오르는 게 보인다. 너무 잦지 않게 모아서.
  if (p.phase === 'list') {
    clearTimeout(syncRedrawTimer)
    syncRedrawTimer = setTimeout(redrawAfterSync, 400)
  }
}

/** 보고 있는 화면이 이력을 쓰는 화면이면 다시 그린다. 이력 검색칸에 글을 쓰는 중이면 끝난 뒤로 미룬다. */
async function redrawAfterSync () {
  if (!state.user || $('#app-screen').hidden) return
  const typing = document.activeElement && document.activeElement.id === 'history-search'
  if (state.view === 'history' && typing && state.sync.running) { state.sync.dirty = true; return }
  if (state.view === 'dashboard' || state.view === 'history') await render()
  if (!$('#picker').hidden) { await loadRecords(); searchPicker($('#picker-search').value) }
}

/** 상단 바의 불러오기 표시. 도는 중엔 진행, 실패하면 사유와 「다시 시도」, 끝나면 잠깐 「완료」 뒤 숨김. */
let syncChipTimer = null
function renderSyncChip () {
  const chip = $('#sync-chip')
  if (!chip) return
  clearTimeout(syncChipTimer)
  const sy = state.sync
  if (sy.running) {
    const p = sy.progress
    const text = !p ? '포털에서 신청 내역을 읽는 중…'
      : p.phase === 'counts' ? `상태별 건수 읽는 중 ${p.done}/${p.total}`
        : p.phase === 'list' ? `신청 현황 읽는 중 ${p.done}/${p.total}쪽`
        : p.phase === 'detail' ? `작품 상세 읽는 중 ${p.done}/${p.total}건`
          : `회차 범위 맞추는 중 ${p.done}/${p.total}건`
    chip.className = 'sync-chip'
    chip.innerHTML = `<span class="spinner spinner-sm"></span><span>${esc(text)}</span>`
    chip.hidden = false
    return
  }
  if (sy.last && !sy.last.ok) {
    chip.className = 'sync-chip sync-chip-error'
    chip.innerHTML = `<span>신청 내역을 다 읽지 못했습니다: ${esc(sy.last.error || '포털에 연결하지 못했습니다.')}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-action="sync-retry">다시 시도</button>`
    chip.hidden = false
    bindActions(chip)
    return
  }
  if (sy.last && sy.last.ok && sy.last.mismatch && sy.last.mismatch.length) {
    // 읽은 건수가 포털 건수와 다르다. 숨기지 않고 둔다 — 무엇이 몇 건 어긋났는지 봐야 한다.
    chip.className = 'sync-chip sync-chip-error'
    chip.innerHTML = `<span>건수가 포털과 다릅니다: ${esc(sy.last.mismatch.map((m) => `${GROUP_LABEL[m.group] || m.group} 포털 ${m.portal}건 / 읽음 ${m.loaded}건`).join(', '))}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-action="sync-retry">다시 읽기</button>`
    chip.hidden = false
    bindActions(chip)
    return
  }
  if (sy.last && sy.last.ok) {
    chip.className = 'sync-chip sync-chip-done'
    chip.innerHTML = `<span>신청 내역 ${sy.last.total}건 불러옴 · 포털 건수와 일치</span>`
    chip.hidden = false
    syncChipTimer = setTimeout(() => { chip.hidden = true }, 4000)
    return
  }
  chip.hidden = true
}

// 본체가 보내는 진행은 로그인 전에 받을 준비를 해 둔다. 자동 로그인은 화면이 그려지자마자 시작되기 때문이다.
api.records.onSyncProgress(onSyncEvent)

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const errorBox = $('#login-error')
  const button = $('#login-submit')
  errorBox.hidden = true

  busy(button, true, '로그인 중…')
  const result = await doLogin({
    loginId: $('#login-id').value.trim(),
    password: $('#login-pw').value,
    remember: $('#login-remember').checked
  })
  busy(button, false)

  if (!result.ok) {
    errorBox.textContent = result.error
    errorBox.hidden = false
  }
})

function enterApp () {
  $('#login-screen').hidden = true
  $('#app-screen').hidden = false

  const name = state.user?.name || state.user?.loginId || '사용자'
  $('#user-name').textContent = name
  $('#user-org').textContent = state.user?.orgName || '기관 미설정'
  $('#user-initial').textContent = name.slice(0, 1).toUpperCase()

  applyModeBadges()
  renderSyncChip()
  navigate('dashboard')
}

$('#logout-btn').addEventListener('click', async () => {
  await api.auth.logout()
  state.records = []
  state.user = null
  state.lastResult = null
  $('#app-screen').hidden = true
  $('#login-screen').hidden = false
  // 본체가 저장된 비밀번호를 지웠다. 다음에 켜도 자동 로그인되지 않는다. 아이디만 남긴다.
  $('#login-pw').value = ''
  $('#login-remember').checked = false
  $('#login-error').hidden = true
  $('#login-auto').hidden = true
  $('#login-form').hidden = false
  $('#login-pw').focus()
})

/* ------------------------------------------------------------ 화면 전환 */

$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.view))
})

function navigate (view) {
  state.view = view
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view))

  const meta = VIEW_META[view] || VIEW_META.dashboard
  $('#view-title').textContent = meta.title
  $('#view-subtitle').textContent = meta.subtitle
  $('#topbar-actions').innerHTML = ''

  render()
  tutorialNotify('view', view)
}

async function render () {
  try {
    return await renderView()
  } catch (e) {
    // 화면 그리다 터지면 지금까지는 아무 흔적도 안 남고 빈 화면만 보였다.
    console.error('[화면 오류] render:', e && e.message, '|', (e && e.stack || '').split('\n')[1])
    $('#view').innerHTML =
      '<div class="alert alert-error">화면을 그리는 중 오류가 발생했습니다: ' + esc(e && e.message) + '</div>'
  }
}

async function renderView () {
  const host = $('#view')
  switch (state.view) {
    case 'dashboard': return renderDashboard(host)
    case 'issue': return renderIssue(host)
    case 'history': return renderHistory(host)
    case 'help': return renderHelp(host)
    case 'settings': return renderSettings(host)
  }
}

/* ------------------------------------------------ 신청 이력 (저장된 전체) */

/*
 * 화면은 본체가 메모리에 든 이력 전체를 쓴다 (파일에는 안 남긴다). 포털은 로그인 직후(뒤에서)와 이력의 「새로고침」, 신청 직후에만 읽는다.
 * 쪽 단위로 그때그때 포털을 읽던 방식은 CSV·불러오기에 빈 값이 생기고 쪽마다 기다려야 했다 (2026-10-21 감리 리뷰).
 * 화면마다 들어갈 때 본체에서 받는다(지연 로딩) — 로그인 때 미리 다 받아 두지 않는다. 메모리의 것을 받는 거라 바로 끝난다.
 */
async function loadRecords () {
  const res = await api.records.list({}).catch((e) => ({ ok: false, error: e?.message }))
  state.records = res.ok ? (res.items || []) : []
  return res
}

/** 검색어·상태로 거른 이력. 포털과 같은 차례(최신 신청이 위)다. */
function filteredRecords ({ query = '', status = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return state.records.filter((r) => {
    if (status !== 'all' && r.status !== status) return false
    if (!q) return true
    return [r.uci, r.title, r.writer, r.syndicateName, r.url].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
  })
}

/** 상태별 건수 — 대시보드 숫자. */
function countRecords () {
  const c = { pending: 0, needsFix: 0, issued: 0, rejected: 0, total: state.records.length }
  for (const r of state.records) if (c[r.status] != null) c[r.status]++
  return c
}

/**
 * 이력 한 쪽에 보여 줄 건수. 포털 조회 화면의 「작품개수」와 같은 선택지(10·20·50·100)에서 고르고, 고른 값은 설정에 남는다.
 * (감리 지적 SFR-006-03: 한 쪽 건수 설정 누락, 2026-10-22)
 */
function historyPageSize () {
  const n = Number(state.history.pageSize) || Number(state.settings?.historyPageSize)
  return HISTORY_PAGE_SIZES.includes(n) ? n : HISTORY_PAGE_SIZES[0]
}

/**
 * 포털에서 현황 전체(와 상세·회차)를 읽어 저장한 뒤 화면의 이력을 새로 받는다. 진행은 onProgress 로 알린다.
 * @param scope 'full' 전체 · 'recent' 이미 알던 줄만 나오는 쪽까지 (신청 직후)
 */
async function syncRecords (scope = 'full', onProgress) {
  const off = api.records.onSyncProgress((p) => { if (typeof onProgress === 'function') onProgress(p) })
  const t0 = performance.now()
  let res
  try {
    res = await api.records.sync({ scope })
  } catch (e) {
    res = { ok: false, error: e?.message || '포털을 읽지 못했습니다.' }
  } finally {
    off()
  }
  await loadRecords()
  state.timing.lastSyncMs = Math.round(performance.now() - t0)
  console.log(`[속도] 포털 불러오기(${scope}) ${state.timing.lastSyncMs}ms — ${res.ok ? `현황 ${res.pages}쪽 ${res.total}건 · 상세 ${res.detailed}건 · 회차 ${res.episodes}건` : `실패: ${res.error}`}`)
  return res
}

/** 불러오기 진행 글. { phase, done, total, title } */
function syncProgressText (p) {
  if (!p) return ''
  if (p.phase === 'counts') return `상태별 건수 ${p.done}/${p.total}`
  if (p.phase === 'list') return `신청 현황 ${p.done}/${p.total}쪽`
  if (p.phase === 'detail') return `작품 상세 ${p.done}/${p.total}건${p.title ? ` · ${p.title}` : ''}`
  if (p.phase === 'episodes') return `회차 범위 ${p.done}/${p.total}건`
  return ''
}

async function refreshSettings () {
  const res = await api.settings.get()
  if (res.ok) {
    state.settings = res.settings
    state.portalConfigured = res.portalConfigured
    state.portalLoginConfigured = res.portalLoginConfigured
    state.dataFile = res.dataFile
    state.selectorsFile = res.selectorsFile
    state.selectorsError = res.selectorsError
    state.dataHealth = res.dataHealth
    // 연습 중에는 자격 확인을 묻지 않는다. 처음 설치한 PC 는 실제 계정으로 확인한 적이 없어 이 값이 false 로 오는데,
    // 연습 1단계(설정 저장) 뒤 이 함수가 다시 불리면서 신청 화면이 잠기던 문제 (2026-10-21 감리 리뷰에서 발견).
    state.registrantVerified = document.body.classList.contains('practicing') ? true : res.registrantVerified
  }
}

/* --------------------------------------------------------------- 대시보드 */

async function renderDashboard (host) {
  const t0 = performance.now()
  await refreshSettings()
  // 들어올 때 본체의 이력 전체를 받아 그린다. 포털은 뒤에서 읽고 있을 수 있고, 그때는 쪽마다 다시 그려진다.
  await loadRecords()
  const rows = state.records
  // 뒤에서 읽는 중이면 포털에서 먼저 센 상태별 건수를 보여 준다. 다 읽은 뒤에는 읽어 둔 이력로 센다 (둘은 같아야 하고, 다르면 상단 바가 알린다).
  const counts = state.sync.running && state.sync.counts ? { ...countRecords(), ...state.sync.counts } : countRecords()
  const loading = state.sync.running
  // 건수가 아직 안 온 묶음은 숫자 대신 스켈레톤
  const countOf = (key) => (loading && !(state.sync.counts && state.sync.counts[key] != null) ? skel('count') : String(counts[key]))
  /*
   * 아직 결론이 안 난 건들. 보완요청도 포함한다.
   * 보완요청은 담당자가 포털에서 직접 고쳐야 넘어가는 상태라, 대시보드에서 빠지면 그냥 잊힌다.
   */
  const pending = rows.filter((r) => r.status === 'pending' || r.status === 'needsFix')
  const recent = rows.slice(0, 6)
  const waiting = counts.pending + counts.needsFix
  const isPortal = state.settings?.mode !== 'mock'
  const cannotApply = state.registrantVerified === false

  $('#topbar-actions').innerHTML = `
    <button class="btn btn-primary btn-sm" data-action="refresh-status"
            ${waiting === 0 ? 'disabled' : ''}>심사 결과 조회${waiting ? ` (${waiting})` : ''}</button>
  `
  bindActions($('#topbar-actions'))

  host.innerHTML = `
    ${state.dataHealth?.error ? `
      <div class="alert ${state.dataHealth.readOnly ? 'alert-error' : 'alert-warning'} mb-16">
        <strong>설정 파일에 문제가 있습니다.</strong> ${esc(state.dataHealth.error)}
        ${state.dataHealth.readOnly ? ' 설정 화면에서 자세히 확인해 주세요.' : ''}
      </div>` : ''}

    ${cannotApply ? `
      <div class="alert alert-warning mb-16">
        <strong>아직 UCI를 신청할 수 없는 계정입니다.</strong>
        ${esc(state.accessError || '포털이 UCI 신청 화면을 열어주지 않았습니다.')}
        <br /><a href="#" data-action="open-registrant-guide">등록자번호 신청 안내 열기</a>
        · <a href="#" data-action="recheck-access">다시 확인</a>
      </div>` : ''}

    ${isPortal ? '' : `
      <div class="alert alert-info mb-16">
        지금은 <strong>${tutorial.active ? '연습 모드' : '모의 연동 모드'}</strong>입니다. 여기서 나오는 UCI는 이 프로그램 안에서만
        쓰이는 예시이며 국립중앙도서관에 실제로 신청되지 않습니다.
        ${tutorial.active ? '연습을 마치면 실제 연동으로 돌아갑니다.' : (SHOW_ADVANCED_SETTINGS ? '실제 연동은 <strong>설정</strong>에서 전환합니다.' : '')}
      </div>`}

    <div class="stat-grid">
      <div class="stat" title="포털 신청상태가 접수·재접수·회차추가인 건">
        <div class="stat-label">${GROUP_LABEL.pending}</div>
        <div class="stat-value" data-count="pending">${countOf('pending')}</div>
      </div>
      <div class="stat">
        <div class="stat-label">${GROUP_LABEL.issued}</div>
        <div class="stat-value ok" data-count="issued">${countOf('issued')}</div>
      </div>
      <div class="stat">
        <div class="stat-label">${GROUP_LABEL.needsFix}</div>
        <div class="stat-value ${counts.needsFix ? 'bad' : ''}" data-count="needsFix">${countOf('needsFix')}</div>
      </div>
      <div class="stat">
        <div class="stat-label">${GROUP_LABEL.rejected}</div>
        <div class="stat-value" data-count="rejected">${countOf('rejected')}</div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-head">
        <div>
          <h3>심사 대기 중인 신청</h3>
          <p>처리기한은 신청일로부터 업무일 3일입니다. 결과는 이메일·알림톡으로도 통지됩니다.
             <strong>보완요청</strong>은 포털에 접속해 직접 고쳐야 넘어갑니다.</p>
        </div>
        <button class="btn btn-default btn-sm" data-action="refresh-status"
                ${waiting === 0 ? 'disabled' : ''}>결과 조회</button>
      </div>
      ${loading && !pending.length ? skelBlock(3) : pending.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>작품명</th><th>유형</th><th>연재처</th><th>회차</th><th>신청일</th><th>처리예정일</th></tr>
          </thead>
          <tbody>
            ${pending.slice(0, 20).map((r) => {
              const late = r.expectedAt && new Date(r.expectedAt) < new Date()
              return `<tr>
                <td class="cell-title" title="${esc(r.title)}">${esc(r.title || '(작품명 없음)')}
                  ${r.status === 'needsFix' ? ' <span class="badge badge-warning">보완요청</span>' : ''}</td>
                <td class="cell-muted">${esc(typeLabel(r.contentType))}</td>
                <td class="cell-muted">${detailPending(r) ? skel('syn') : esc(r.syndicateName || '-')}</td>
                <td class="cell-muted">${episodeRange(r)}</td>
                <td class="cell-muted">${fmtDate(r.appliedAt)}</td>
                <td class="cell-muted">${r.status === 'needsFix'
                  ? '<span class="badge badge-warning">포털에서 보완 필요</span>'
                  : fmtDate(r.expectedAt) + (late ? ' <span class="badge badge-warning">기한 경과</span>' : '')}</td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>${pending.length > 20 ? `<div class="card-body faint">외 ${pending.length - 20}건은 신청 이력에서 볼 수 있습니다.</div>` : ''}` : emptyState('심사 대기 중인 신청이 없습니다.', '새 작품을 신청하면 여기에 표시됩니다.')}
    </div>

    <div class="card mb-16">
      <div class="card-head">
        <div>
          <h3>바로 시작하기</h3>
          <p>자주 쓰는 작업으로 곧장 이동합니다.</p>
        </div>
      </div>
      <div class="card-body row row-wide">
        <button class="btn btn-primary" data-action="go-issue">＋ UCI 신청하기</button>
        <button class="btn btn-default" data-action="go-history">⌕ 신청 이력 보기</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h3>최근 신청</h3>
          <p>가장 최근 ${recent.length}건</p>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="go-history">전체 보기</button>
      </div>
      ${loading && !recent.length ? skelBlock(6) : recent.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>UCI</th><th>작품명</th><th>작가</th><th>유형</th><th>상태</th><th>신청일시</th></tr>
          </thead>
          <tbody>
            ${recent.map((r) => `
              <tr>
                <td class="cell-uci">${r.uci ? esc(r.uci) : '<span class="cell-muted">-</span>'}</td>
                <td class="cell-title" title="${esc(r.title)}">${esc(r.title || '(작품명 없음)')}</td>
                <td class="cell-muted">${detailPending(r) ? skel('writer') : esc(r.writer || '-')}</td>
                <td class="cell-muted">${esc(typeLabel(r.contentType))}</td>
                <td>${statusBadge(r)}</td>
                <td class="cell-muted">${fmtDateTime(r.appliedAt)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('아직 신청 기록이 없습니다.', '첫 작품을 신청해 보세요.')}
    </div>
  `

  bindActions(host)

  // 응답성 지표. 포털 읽기는 불러오기에서 따로 잰다 ([속도] 포털 불러오기).
  const drawMs = Math.round(performance.now() - t0)
  state.timing.lastDrawMs = drawMs
  console.log(`[속도] 대시보드 그리기 ${drawMs}ms (저장된 이력 ${rows.length}건)`)
  if (state.timing.enterAt) {
    const ms = Math.round(performance.now() - state.timing.enterAt)
    state.timing.enterAt = 0
    state.timing.lastDashboardMs = ms
    console.log(`[속도] 로그인 응답 → 대시보드 표시 ${ms}ms`)
  }
}

/**
 * 심사중인 건들의 결과를 조회해 화면을 갱신한다.
 *
 * 화면에 조회 버튼이 두 군데(상단·카드) 있어서, 잠금이 없으면 둘을 연달아 눌렀을 때
 * 같은 건을 두 번 조회하고 이력도 두 번 갱신된다. 그래서 실행 중에는 새 요청을 막는다.
 */
let statusRefreshing = false

async function runStatusRefresh (button) {
  if (statusRefreshing) return
  statusRefreshing = true

  // 조회 도중 사용자가 다른 화면으로 옮기면 이 버튼은 사라진다.
  // 그때 사라진 버튼에 진행 상황을 쓰려다 죽지 않도록 매번 살아 있는지 확인한다.
  const alive = () => button && button.isConnected

  busy(button, true, '조회 중…')
  const off = api.apply.onRefreshProgress(({ done, total, title }) => {
    if (alive()) button.innerHTML = `<span class="spinner"></span>${done}/${total} ${esc(title || '')}`
  })

  const res = await api.apply.refreshStatus()
  off()
  statusRefreshing = false
  if (alive()) busy(button, false)

  if (!res.ok) {
    toast(res.error || '결과 조회에 실패했습니다.', 'error')
    return
  }
  if (!res.checked) {
    toast('심사중인 신청이 없습니다.')
    return
  }

  const errored = res.items.filter((i) => i.status === 'error')
  if (errored.length) {
    toast(errored[0].error || '조회 중 오류가 발생했습니다.', 'error')
  } else if (res.updated) {
    const issued = res.items.filter((i) => i.status === 'issued').length
    const rejected = res.items.filter((i) => i.status === 'rejected').length
    toast(`결과 ${res.updated}건 확인 — 발급 ${issued}건, 반려 ${rejected}건`, rejected ? 'error' : 'success')
  } else {
    toast(`${res.checked}건 조회 — 아직 심사중입니다.`)
  }

  await loadRecords()
  render()
  tutorialNotify('refreshed', res)
}

/**
 * 상태 표시. 글자는 포털의 신청상태 그대로, 색만 묶음(status)으로 정한다.
 * 처리내용(처리불가 사유, 보완요청 안내, 신청 실패 사유)이 있으면 따로 줄을 만들지 않고 툴팁으로 보여 준다.
 */
function statusBadge (r) {
  const status = r?.status
  const cls = {
    issued: 'badge-success',
    rejected: 'badge-danger',
    failed: 'badge-danger',
    needsFix: 'badge-warning',
    pending: 'badge-warning'
  }[status] || 'badge-muted'
  const text = r?.portalStatus || STATUS_LABEL[status] || status || '-'
  /*
   * 툴팁은 처리불가일 때만, 마우스를 올리면 무조건 띄운다 (2026-10-22). 다른 상태에는 툴팁이 없다.
   * 내용: 현황 칸에 괄호로 붙어 온 사유(portalNote) → 처리내용(error) → 상세를 아직 안 읽었으면 「읽는 중」 → 사유가 없으면 그렇다고.
   */
  if (text !== '처리불가') return `<span class="badge ${cls}">${esc(text)}</span>`
  const note = String(r?.portalNote || '').trim() || String(r?.error || '').trim() || (detailPending(r) ? LOADING_TIP : '처리불가 — 포털이 사유를 적지 않았습니다.')
  return `<span class="badge ${cls} badge-note" title="${esc(note)}">${esc(text)}</span>`
}

function emptyState (title, desc) {
  return `<div class="empty">
    <div class="empty-icon">◎</div>
    <strong>${esc(title)}</strong>
    <p>${esc(desc)}</p>
  </div>`
}

/* ------------------------------------------------------------- 발급 화면 */
/* --------------------------------------------------------------- 신청 화면 */

/**
 * 작품 건별 신청 폼.
 *
 * 포털의 실제 신청 화면에는 입력칸이 46개 있지만, 그중 실제로 검사하는 필수 항목만 담았다.
 * (근거: 포털의 fn_save() 검증 코드 — 폼 매핑 명세서)
 * 담당자 정보처럼 작품마다 바뀌지 않는 값은 설정에서 자동으로 채워 넣으므로 여기 없다.
 */
/**
 * 신청 폼의 항목 제목.
 *
 * 안내 문구가 있으면 물음표 표시를 붙이고, 제목에 마우스를 올리면 말풍선으로 보여준다.
 * 문구는 CSS 가 data-tip 값을 읽어 그린다 — 자바스크립트를 쓰지 않으므로 화면이
 * 다시 그려져도 따로 붙일 것이 없다.
 */
function fieldLabel (text, key, required = true) {
  // 필수 표시는 제목 왼쪽, 안내 물음표는 오른쪽. 둘이 붙어 있으면 구분이 안 된다.
  const req = required ? '<span class="req req-lead">*</span>' : ''
  return `<span class="field-label">${req}${esc(text)}${tipMark(key)}</span>`
}

/**
 * 안내 물음표. 말풍선은 이 아이콘에 마우스를 올렸을 때만 뜬다.
 * 제목 전체에 걸면 입력칸 위 가로 영역 어디를 지나가도 뜨게 되어 거슬린다.
 * 키보드로도 닿을 수 있게 tabindex 를 준다.
 */
function tipMark (key) {
  const tip = TOOLTIPS[key]
  if (!tip) return ''
  return `<span class="tip-mark" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}">?</span>`
}

/**
 * 작품 한 건을 담는 카드.
 *
 * 예전에는 '어떤 작품인가요 / 어디에 연재하나요 / 장르 / 가격' 을 각각 흰 카드로
 * 쪼개 놨었다. 작품이 여러 건이 되면 그 방식으로는 어디까지가 한 작품인지 알 수 없어서,
 * 작품 하나를 카드 하나에 담고 안에서 소제목으로 나눈다.
 */
function workCard (index, count, data = {}) {
  const v = (k, fallback = '') => esc(data[k] ?? fallback)
  const picked = Array.isArray(data.genres) ? data.genres : []
  // 작가 줄. 빈 카드는 한 줄로 시작하고, 예전 기록(writerRole/writer 한 쌍)도 한 줄로 보인다.
  const authors = (Array.isArray(data.authors) && data.authors.length) ? data.authors
    : (data.writer || data.writerRole) ? [{ role: data.writerRole || '글/그림', name: data.writer || '' }] : [{ role: '글/그림', name: '' }]

  return `
    <div class="card work-card" data-work="${index}">
      <div class="card-head">
        <div><h3>${count > 1 ? `작품 ${index + 1}` : '작품 정보'}</h3></div>
        <div class="row">
          <button type="button" class="btn btn-ghost btn-sm" data-action="load-previous" data-i="${index}"
                  title="이전에 신청한 작품의 입력값을 이 카드에 채웁니다">이전 신청 불러오기</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="reset-work" data-i="${index}">초기화</button>
          ${count > 1 ? `<button type="button" class="btn btn-ghost btn-sm danger" data-action="remove-work" data-i="${index}">삭제</button>` : ''}
        </div>
      </div>

      <div class="card-body work-body">

        <section class="work-section">
          <h4 class="work-section-title">어떤 작품인가요</h4>
          <div class="form-grid">
            <label class="field">
              ${fieldLabel('유형', 'contentType')}
              <select name="contentType">${selectOptions(CONTENT_TYPES.map((c) => [c.value, c.label]), data.contentType || 'webtoon')}</select>
            </label>

            <label class="field">
              ${fieldLabel('연재유형', 'publishForm')}
              <select name="publishForm">${selectOptions(PUBLISH_FORMS, data.publishForm || '연재형')}</select>
            </label>

            <label class="field span-2">
              ${fieldLabel('작품명', 'title')}
              <input type="text" name="title" value="${v('title')}" placeholder="예) 우리 동네 이야기" autocomplete="off" />
            </label>

            <div class="field span-2 authors">
              ${fieldLabel('작가', 'writer')}
              ${authors.map((a, ai) => `
              <div class="row author-row">
                <select name="authorRole" class="w-role" aria-label="작가 역할">${selectOptions(WRITER_ROLES, a.role || (ai === 0 ? '글/그림' : '글'))}</select>
                <input type="text" name="authorName" class="grow" value="${esc(a.name || '')}" placeholder="예) 홍길동" autocomplete="off" aria-label="작가명" />
                ${authors.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-action="remove-author" data-i="${index}" data-a="${ai}">삭제</button>` : ''}
              </div>`).join('')}
              <div class="row">
                <button type="button" class="btn btn-ghost btn-sm" data-action="add-author" data-i="${index}">작가 추가</button>
                <span class="faint">글 작가와 그림 작가가 다르면 줄을 늘려 각각 넣으세요.</span>
              </div>
            </div>

            <label class="field">
              ${fieldLabel('연령등급', 'ageGrade')}
              <select name="ageGrade">${selectOptions([['', '선택하세요'], ...AGE_GRADES.map((g) => [g.value, g.label])], data.ageGrade || '')}</select>
            </label>
          </div>
        </section>

        <section class="work-section">
          <h4 class="work-section-title">어디에 연재하나요</h4>
          <div class="form-grid">
            <label class="field">
              ${fieldLabel('연재처', 'syndicate')}
              <select name="syndicate">
                <option value="">선택하세요</option>
                ${SYNDICATES.map((x) => `<option value="${esc(x.code)}"${x.code === data.syndicate ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
              </select>
            </label>

            <label class="field">
              ${fieldLabel('연재상태', 'serialStatus')}
              <select name="serialStatus">${selectOptions(SERIAL_STATUS, data.serialStatus || '연재중')}</select>
            </label>

            <label class="field span-2">
              ${fieldLabel('작품 URL', 'url', false)}
              <input type="text" name="url" value="${v('url')}" placeholder="https://comic.naver.com/webtoon/list?titleId=..." autocomplete="off" />
            </label>

            <div class="field span-2">
              ${fieldLabel('회차 범위', 'episodes')}
              <div class="row">
                <input type="text" name="episodeStart" class="w-num" value="${v('episodeStart')}" placeholder="1" inputmode="numeric" />
                <span class="muted">화 ~</span>
                <input type="text" name="episodeEnd" class="w-num" value="${v('episodeEnd')}" placeholder="10" inputmode="numeric" />
                <span class="muted">화</span>
                <span class="faint episode-count"></span>
              </div>
            </div>
          </div>
        </section>

        <section class="work-section">
          <h4 class="work-section-title">
            <span class="label-group"><span class="req req-lead">*</span>장르${tipMark('genres')}</span>
            <span class="faint genre-count">0개 선택</span>
          </h4>
          <p class="work-section-help">하나 이상 고르세요. 여러 개 선택할 수 있습니다.</p>
          <div class="chips">
            ${GENRES.map((g) => `
              <label class="chip">
                <input type="checkbox" name="genres" value="${esc(g)}"${picked.includes(g) ? ' checked' : ''} />
                <span>${esc(g)}</span>
              </label>`).join('')}
          </div>
        </section>

        <section class="work-section">
          <h4 class="work-section-title">가격</h4>
          <div class="form-grid">
            <label class="field">
              ${fieldLabel('가격 구분', 'priceKind')}
              <select name="priceKind">${selectOptions(PRICE_KINDS, data.priceKind || '연재가 회당')}</select>
            </label>
            <label class="field">
              ${fieldLabel('가격', 'price')}
              <div class="row">
                <input type="text" name="price" class="grow" value="${v('price')}" placeholder="0" inputmode="numeric" />
                <select name="currency" class="w-unit">${selectOptions(CURRENCIES, data.currency || '원')}</select>
              </div>
              <input type="text" name="currencyEtc" class="mt-8 currency-etc"
                     value="${v('currencyEtc')}" placeholder="단위를 직접 입력 (예: 포인트)"
                     autocomplete="off" ${data.currency === '직접입력' ? '' : 'hidden'} />
            </label>
          </div>
        </section>

      </div>
    </div>`
}

function renderIssue (host) {
  const s = state.settings || {}
  const cannotApply = state.registrantVerified === false
  const noManager = !s.managerName || !s.managerEmail || !s.managerMobile || !s.privacyAgreed

  if (!Array.isArray(state.works) || state.works.length === 0) state.works = [{}]
  // 연습의 '샘플로 채우기' 가 한 번만 켜 두는 값. 그리고 나면 바로 끈다.
  const prefillRights = state.prefillRights
  state.prefillRights = false
  const count = state.works.length
  const many = count > 1

  host.innerHTML = `
    ${state.lastResult ? resultCard(state.lastResult) : ''}

    ${cannotApply ? `
      <div class="alert alert-warning mb-16">
        ${esc(state.accessError || 'UCI 신청 자격이 확인되지 않았습니다.')}
        <br /><a href="#" data-action="recheck-access">다시 확인</a>
      </div>` : ''}

    ${noManager ? `
      <div class="alert alert-warning mb-16">
        <strong>담당자 정보를 먼저 등록해 주세요.</strong>
        포털 신청에 필수인 항목입니다. 한 번만 입력해 두면 이후 신청에 자동으로 들어갑니다.
        <br /><a href="#" data-action="go-settings">설정에서 입력하기</a>
      </div>` : ''}

    <form id="issue-form" class="stack">

      ${state.works.map((w, i) => workCard(i, count, w)).join('')}

      <button type="button" class="btn btn-dashed btn-block" data-action="add-work">
        작품 추가
      </button>

      <div class="card">
        <div class="card-body">
          <label class="checkbox">
            <input type="checkbox" name="rightsAgreed" id="rights-agreed" ${prefillRights ? 'checked' : ''} />
            <span><strong>저작권자의 동의를 받았습니다.</strong><span class="req">*</span></span>
          </label>
          <p class="faint mt-16">
            동의 없이 UCI를 등록하면 민·형사상 법적 책임이 등록자에게 있으며 발급이 취소될 수 있습니다.
            ${many ? '아래 작품 전체에 해당합니다.' : ''}
          </p>
          <div id="issue-error" class="alert alert-error mt-16" hidden></div>
        </div>
        <div class="card-head card-foot">
          <span class="faint">
            ${many
              ? `${count}건을 한 건씩 차례로 신청합니다. 건당 5~30초쯤 걸립니다.`
              : '신청 후 업무일 3일 이내에 결과가 통지됩니다.'}
          </span>
          <button type="submit" class="btn btn-primary" id="issue-submit"
                  ${cannotApply || noManager ? 'disabled' : ''}>
            ${many ? `UCI ${count}건 신청하기` : 'UCI 신청하기'}
          </button>
        </div>
      </div>
    </form>
  `

  bindActions(host)

  // 몇 건을 신청하는 중인지 화면 위에서도 알 수 있게 한다.
  const subtitle = $('#view-subtitle')
  if (subtitle) {
    subtitle.textContent = many
      ? `작품 ${count}건을 한 건씩 차례로 신청합니다.`
      : VIEW_META.issue.subtitle
  }

  const form = $('#issue-form')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    await submitIssue(e.target)
  })

  // 고른 장르 수와 회차 수를 즉시 보여준다. 300화 제한을 넘기기 전에 알 수 있게.
  // 카드마다 따로 세야 하므로 각 카드 안에서만 찾는다.
  const updateCounters = () => {
    $$('.work-card', form).forEach((card) => {
      // 가격단위를 '직접입력'으로 고르면 직접 적는 칸을 내어 준다.
      const etc = $('input[name="currencyEtc"]', card)
      if (etc) etc.hidden = $('select[name="currency"]', card).value !== '직접입력'

      const picked = $$('input[name="genres"]:checked', card).length
      const gc = $('.genre-count', card)
      if (gc) gc.textContent = `${picked}개 선택`

      const a = Number($('input[name="episodeStart"]', card).value)
      const b = Number($('input[name="episodeEnd"]', card).value)
      const box = $('.episode-count', card)
      if (!box) return
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a) {
        const n = b - a + 1
        box.textContent = `총 ${n}화${n > 300 ? ' — 300화를 넘습니다' : ''}`
        box.classList.toggle('warn', n > 300)
      } else {
        box.textContent = ''
        box.classList.remove('warn')
      }
    })
  }
  form.addEventListener('input', enforceNumeric)   // 숫자 칸 걸러내기가 먼저. 그 뒤 계산이 깨끗한 값을 본다
  form.addEventListener('change', normalizeUrlField)
  form.addEventListener('change', updateCounters)
  form.addEventListener('input', updateCounters)
  updateCounters()
}

/**
 * 화면에 입력된 값을 작품별로 걷어 온다.
 *
 * 카드를 추가·삭제하면 화면을 다시 그리는데, 그 전에 이걸로 담아 두지 않으면
 * 사용자가 입력하던 내용이 통째로 날아간다.
 */
function collectWorks () {
  const form = $('#issue-form')
  if (!form) return state.works || [{}]

  return $$('.work-card', form).map((card) => {
    const val = (name) => {
      const el = $(`[name="${name}"]`, card)
      return el ? el.value.trim() : ''
    }
    return {
      contentType: val('contentType'),
      publishForm: val('publishForm'),
      title: val('title'),
      authors: readAuthors(card),
      ageGrade: val('ageGrade'),
      syndicate: val('syndicate'),
      serialStatus: val('serialStatus'),
      url: normalizeUrl(val('url')),
      episodeStart: val('episodeStart'),
      episodeEnd: val('episodeEnd'),
      priceKind: val('priceKind'),
      price: val('price'),
      currency: val('currency'),
      currencyEtc: val('currencyEtc'),
      genres: $$('input[name="genres"]:checked', card).map((c) => c.value)
    }
  })
}

/** 신청 직후 보여주는 접수 안내. 이 시점에 UCI는 아직 나오지 않는다. */
function resultCard (r) {
  const many = Number(r.count) > 1
  return `
    <div class="result-card">
      <div class="result-label">${many ? `${esc(String(r.count))}건 신청 접수됨` : '신청 접수됨'}</div>
      <div class="result-title">${esc(r.title || '')}</div>
      <p class="faint mt-16">
        처리예정일 <strong>${fmtDate(r.expectedAt)}</strong> · 결과는 이메일·알림톡으로도 통지됩니다.<br />
        대시보드의 <strong>심사 결과 조회</strong>로 진행 상황을 확인할 수 있습니다.
      </p>
      <div class="row row-center mt-16">
        <button class="btn btn-default btn-sm" data-action="go-dashboard">대시보드로</button>
        <button class="btn btn-ghost btn-sm" data-action="dismiss-result">계속 신청하기</button>
      </div>
    </div>`
}

/**
 * 작품 카드 하나를 포털에 보낼 형태로 읽는다.
 *
 * 예전에는 폼 전체를 한 번에 읽었다. 이제 카드가 여럿이라 카드 안에서만 찾는다.
 */
function readWork (card) {
  const data = {}
  $$('input, select, textarea', card).forEach((el) => {
    if (!el.name || el.name === 'genres') return
    data[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value
  })

  data.genres = $$('input[name="genres"]:checked', card).map((el) => el.value)
  delete data.authorRole
  delete data.authorName
  data.authors = readAuthors(card)
  // 예전 코드·표·CSV 가 보는 한 줄 표기. 포털에는 authors 로 줄마다 넣는다.
  data.writerRole = data.authors.map((a) => a.role).join(', ')
  data.writer = data.authors.map((a) => a.name).join(', ')

  // 연재처는 화면에서 코드로 고르지만, 포털에는 이름과 코드를 함께 넣어야 한다.
  const picked = SYNDICATES.find((x) => x.code === data.syndicate)
  data.syndicateCode = picked?.code || ''
  data.syndicateName = picked?.name || ''
  delete data.syndicate

  return data
}

/** 카드의 작가 줄을 읽는다. 빈 줄(이름 없음)은 뺀다 — 추가만 해 두고 안 채운 줄이 검증에 걸리지 않게. */
function readAuthors (card) {
  return $$('.author-row', card).map((row) => ({
    role: $('[name="authorRole"]', row)?.value || '',
    name: ($('[name="authorName"]', row)?.value || '').trim()
  })).filter((a) => a.name)
}

/** 신청 전 검증. 포털의 fn_save() 가 보는 것과 같은 항목을 같은 순서로 본다. */
function validateMeta (meta) {
  const required = [
    ['publishForm', '연재유형'],
    ['title', '작품명'],
    ['ageGrade', '연령등급'],
    ['syndicateCode', '연재처'],
    ['serialStatus', '연재상태'],
    ['priceKind', '가격 구분'],
    ['price', '가격'],
    ['episodeStart', '회차 시작번호'],
    ['episodeEnd', '회차 끝번호']
  ]
  for (const [key, label] of required) {
    if (key === 'ageGrade') {
      // 작가는 연령등급 앞 순서. 한 줄에 한 사람, 첫 줄은 반드시 이름이 있어야 한다.
      const authors = authorsOf(meta)
      if (!authors.length) return { field: 'authorName', message: '작가명을(를) 입력하세요.' }
      if (authors.some((a) => !a.role)) return { field: 'authorRole', message: '작가 역할을(를) 선택하세요.' }
    }
    if (!String(meta[key] ?? '').trim()) {
      return { field: key === 'syndicateCode' ? 'syndicate' : key, message: `${label}을(를) 입력하세요.` }
    }
  }

  if (!meta.genres?.length) return { field: 'genres', message: '장르를 하나 이상 선택하세요.' }

  // 숫자 칸에 글자, URL 형식 같은 자료형 오류. 본체도 보내기 직전에 같은 함수로 한 번 더 본다.
  const typed = typeProblem(meta)
  if (typed) return typed

  const a = Number(meta.episodeStart)
  const b = Number(meta.episodeEnd)
  if (a < 1) return { field: 'episodeStart', message: '회차 번호는 1 이상의 숫자로 입력하세요.' }
  if (b < a) return { field: 'episodeEnd', message: '회차 끝번호가 시작번호보다 작습니다.' }
  if (b - a + 1 > 300) return { field: 'episodeEnd', message: '한 번에 최대 300화까지 신청할 수 있습니다.' }
  return null
}

/**
 * 숫자 칸(가격·회차)에 글자가 들어오면 그 자리에서 지운다. 포털 입력칸의 fn_numberOnly 와 같은 동작이다.
 * 지운 게 있으면 왜 지웠는지 한 번 알려 준다 (글자마다 알림이 뜨지 않도록 잠깐 쉰다).
 */
let numericHintAt = 0
function enforceNumeric (e) {
  const el = e.target
  if (!(el instanceof HTMLInputElement) || el.getAttribute('inputmode') !== 'numeric') return
  const cleaned = el.value.replace(/\D/g, '')
  if (cleaned === el.value) return
  const pos = Math.max(0, (el.selectionStart || 0) - (el.value.length - cleaned.length))
  el.value = cleaned
  try { el.setSelectionRange(pos, pos) } catch { /* 선택 범위를 못 잡는 입력칸이면 그대로 둔다 */ }
  if (Date.now() - numericHintAt > 1500) {
    numericHintAt = Date.now()
    toast('이 칸은 숫자만 입력할 수 있습니다.', 'error')
  }
}

/** 작품 URL 칸을 벗어나면 빠진 앞부분(https://)을 채워 준다. */
function normalizeUrlField (e) {
  const el = e.target
  if (el instanceof HTMLInputElement && el.name === 'url') el.value = normalizeUrl(el.value)
}

/**
 * collectWorks 와 같지만 작가 줄은 빈 줄까지 그대로 담는다.
 * 줄을 추가·삭제해 다시 그릴 때 쓴다 — 빈 줄을 걸러 버리면 방금 추가한 줄이 사라진다.
 */
function collectWorksRaw () {
  const works = collectWorks()
  $$('.work-card', $('#issue-form')).forEach((card, i) => {
    if (!works[i]) return
    works[i].authors = $$('.author-row', card).map((row) => ({
      role: $('[name="authorRole"]', row)?.value || '',
      name: ($('[name="authorName"]', row)?.value || '').trim()
    }))
  })
  return works
}

/* -------------------------------------------------------------- 같은 작품명이 이미 있을 때 */

const PORTAL_APPLY_MENU = {
  webtoon: 'https://www.nl.go.kr/seoji/contents/S90202000000.do',
  webnovel: 'https://www.nl.go.kr/seoji/contents/S90203000000.do'
}

/**
 * 포털이 같은 작품명을 찾아 접수를 멈췄을 때. 포털의 중복 확인 창과 같은 두 갈래를 여기서 고르게 한다.
 * 고르기 전에는 아무것도 보내지 않고 이력에도 남기지 않는다 — 아직 신청한 게 아니다.
 */
/**
 * 포털이 같은 작품명을 찾아 멈췄을 때 갈래를 묻는다. 고를 때까지 기다렸다가 'forceNew' | 'episodes' | 'cancel' 을 돌려준다.
 * 여러 건을 차례로 보낼 때도 그 작품에서 멈춰 단건과 똑같이 묻고, 고르면 이어 간다.
 * @param label 여러 건일 때 몇 번째 작품인지 (예: '작품 2')
 */
let duplicateResolve = null
function askDuplicate (result, meta, label = '') {
  const box = $('#issue-error')
  const type = meta?.contentType === 'webnovel' ? 'webnovel' : 'webtoon'
  box.innerHTML = `
    <strong>${label ? `${esc(label)} — ` : ''}${esc(result.error || '같은 작품명이 이미 등록되어 있습니다.')}</strong>
    <p class="mt-8">같은 작품의 다음 회차·권이라면 포털에서 「회차 추가」로 올려야 합니다. 이 프로그램은 회차 추가를 다루지 않습니다.<br />
    이름만 같은 다른 작품이라면 새 작품으로 등록할 수 있습니다. 포털에 작품이 두 개로 잡히므로 확실할 때만 누르세요.</p>
    <div class="row row-wrap mt-16">
      <button type="button" class="btn btn-default btn-sm" data-action="dup-add-episodes" data-type="${type}">포털에서 회차 추가하기</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="dup-force-new">다른 작품입니다 — 새 작품으로 등록하고 계속</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="dup-cancel">취소</button>
    </div>`
  box.hidden = false
  bindActions(box)
  box.scrollIntoView({ block: 'center' })
  toast('포털에 같은 작품명이 있습니다. 어떻게 할지 골라 주세요.', 'error')
  return new Promise((resolve) => {
    duplicateResolve = (choice) => {
      duplicateResolve = null
      box.hidden = true
      resolve(choice)
    }
  })
}

/* -------------------------------------------------------------- 이전 신청 불러오기 */

const picker = { index: 0, items: [] }

/**
 * 이력 한 건을 작품 카드 입력값으로 바꾼다.
 * 작품명까지 가져오되 회차 범위는 비운다 — 매번 달라지는 값이라 그대로 두면 사고가 난다.
 */
function workFromRecord (r) {
  return {
    contentType: r.contentType || 'webtoon',
    publishForm: r.publishForm || '',
    title: r.title || '',
    authors: authorsOf(r),
    ageGrade: r.ageGrade || '',
    syndicate: r.syndicateCode || '',
    serialStatus: r.serialStatus || '',
    url: r.url || '',
    priceKind: r.priceKind || '',
    price: r.price ?? '',
    currency: r.currency || '',
    currencyEtc: r.currencyEtc || '',
    genres: Array.isArray(r.genres) ? [...r.genres] : [],
    episodeStart: '',
    episodeEnd: ''
  }
}

async function openPicker (index) {
  picker.index = index
  $('#picker-search').value = ''
  $('#picker').hidden = false
  searchPicker('')
  $('#picker-search').focus()
}

function closePicker () {
  $('#picker').hidden = true
}

/** 저장된 이력(포털에 있는 신청)에서 작품명·작가·UCI 로 찾는다. 포털을 기다리지 않는다. */
function searchPicker (query) {
  const q = String(query || '').trim().toLowerCase()
  const hits = state.records.filter((r) => r.id && (!q || [r.title, r.writer, r.uci].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))))
  picker.items = hits.slice(0, 50)
  renderPickerList(hits.length)
}

function renderPickerList (total) {
  const box = $('#picker-list')
  if (!picker.items.length) {
    // 뒤에서 읽는 중이라 아직 한 줄도 없으면 스켈레톤 항목
    box.innerHTML = state.sync.running && !state.records.length
      ? skelBlock(4)
      : `<p class="faint picker-empty">${!state.records.length ? '포털에 신청 내역이 없습니다.' : '그런 작품명의 신청이 없습니다.'}</p>`
    return
  }
  const typeLabelOf = (v) => CONTENT_TYPES.find((c) => c.value === v)?.label || v || ''
  box.innerHTML = picker.items.map((r) => `
    <button type="button" class="picker-item" data-pick="${esc(r.id)}">
      <span class="picker-title">${esc(r.title || '(작품명 없음)')}</span>
      ${statusBadge(r)}
      <span class="picker-meta">${detailPending(r) ? skel('meta') : `${esc(r.writer || '-')} · ${esc(r.syndicateName || '-')}`} · ${esc(typeLabelOf(r.contentType))} · ${esc(fmtDate(r.appliedAt))}</span>
    </button>`).join('') +
    (total > picker.items.length ? `<p class="faint picker-empty">${total}건 가운데 앞 ${picker.items.length}건입니다. 작품명을 더 입력해 주세요.</p>` : '')
}

/**
 * 처리불가·삭제 건의 줄 끝에 「재신청」. 누르면 그 줄의 내용으로 신청 카드를 채우고 신청 화면으로 간다.
 * 포털 상세(작가·장르·연재처 등)를 아직 못 읽은 줄은 채울 값이 비어 있으니 다 읽을 때까지 잠근다.
 */
function reapplyButton (r) {
  if (r.status !== 'rejected' || !r.id) return ''
  if (detailPending(r)) {
    return `<span class="tip-wrap" title="${LOADING_TIP} 다 읽으면 재신청할 수 있습니다."><button type="button" class="btn btn-ghost btn-sm" disabled>재신청</button></span>`
  }
  return `<button type="button" class="btn btn-ghost btn-sm" data-action="reapply" data-id="${esc(r.id)}" title="이 줄의 내용으로 UCI 신청 화면을 채웁니다">재신청</button>`
}

/** 이력의 「재신청」 — 그 줄의 내용으로 첫 카드를 채우고 신청 화면으로 간다. 회차 범위는 비워 둔다. */
function reapply (id) {
  const r = state.records.find((x) => x.id === id)
  if (!r) return toast('그 신청을 찾지 못했습니다. 새로고침한 뒤 다시 해 보세요.', 'error')
  state.works = [workFromRecord(r)]
  state.lastResult = null
  navigate('issue')
  const card = $$('.work-card')[0]
  if (card) {
    card.classList.add('loaded')
    card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    $('[name="title"]', card)?.focus()
  }
  toast(`「${r.title || ''}」의 신청 내용을 채웠습니다. 작품명과 회차 범위를 확인하고 신청하세요.`)
}

async function pickPrevious (id) {
  const r = picker.items.find((x) => x.id === id)
  if (!r) return
  const works = collectWorks()
  works[picker.index] = workFromRecord(r)
  state.works = works
  state.lastResult = null   // 새 신청을 시작하는 것이니 이전 접수 안내는 내린다
  closePicker()
  renderIssue($('#view'))
  const card = $$('.work-card')[picker.index]
  if (card) {
    card.classList.add('loaded')
    card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    $('[name="title"]', card)?.focus()
  }
  toast(`「${r.title || ''}」의 신청 내용을 불러왔습니다. 작품명과 회차 범위를 확인하세요.`)
}

/** 불러오기 창의 고정 요소들. 한 번만 건다. */
function initPicker () {
  const overlay = $('#picker')
  if (!overlay) return
  $('#picker-close').addEventListener('click', closePicker)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePicker() })
  let timer
  $('#picker-search').addEventListener('input', (e) => {
    clearTimeout(timer)
    const value = e.target.value
    timer = setTimeout(() => searchPicker(value), 150)
  })
  $('#picker-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]')
    if (b) pickPrevious(b.dataset.pick)
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closePicker() })
}

/*
 * 신청하기. 카드가 여럿이면 단건 신청을 작품마다 차례로 되풀이한다 — 수행 계획서의 「복수 건 연속 신청(단건 폼 반복 호출)」.
 * 포털의 엑셀 일괄신청은 쓰지 않는다. 한 건씩 보내면 어느 작품이 왜 막혔는지도 바로 안다.
 *   · 보내기 전에 모든 카드를 먼저 검사한다. 하나라도 틀리면 아무것도 보내지 않는다.
 *   · 한 건이 막혀도 나머지는 계속 보낸다. 접수된 카드는 지우고 막힌 카드만 사유와 함께 남긴다.
 *   · 같은 작품명이 포털에 있으면 그 작품에서 멈춰 단건과 똑같이 갈래를 묻고, 고른 뒤 이어 간다.
 */
let submitting = false
async function submitIssue (form) {
  if (submitting) return
  const errorBox = $('#issue-error')
  const button = $('#issue-submit')
  errorBox.hidden = true
  $$('.invalid', form).forEach((el) => el.classList.remove('invalid'))

  const cards = $$('.work-card', form)
  const metas = cards.map(readWork)
  const many = metas.length > 1

  // 저작권 동의는 전체에 한 번만 받는다.
  const rightsAgreed = Boolean(form.elements.rightsAgreed?.checked)

  const fail = (message, card, fieldName) => {
    errorBox.textContent = message
    errorBox.hidden = false
    if (card) {
      const el = fieldName ? $(`[name="${fieldName}"]`, card) : card
      const target = el?.length ? el[0] : el
      target?.classList?.add('invalid')
      target?.scrollIntoView?.({ block: 'center' })
      target?.focus?.()
    }
    toast('입력을 확인해 주세요.', 'error')
  }

  for (let i = 0; i < metas.length; i++) {
    const problem = validateMeta({ ...metas[i], rightsAgreed })
    if (problem) {
      // 여러 건이면 몇 번째 작품인지 짚어 준다. 안 그러면 어디를 고쳐야 할지 알 수 없다.
      return fail(many ? `작품 ${i + 1}: ${problem.message}` : problem.message, cards[i], problem.field)
    }
  }

  if (!rightsAgreed) {
    errorBox.textContent = '저작권자 동의 확인에 체크해야 신청할 수 있습니다.'
    errorBox.hidden = false
    $('#rights-agreed')?.focus()
    return
  }

  submitting = true
  const total = metas.length
  const accepted = []   // { index, title, expectedAt }
  const failed = []     // { index, title, error }
  const show = (i, text) => {
    if (!button.isConnected) return
    button.innerHTML = `<span class="spinner"></span>${esc(many ? `${i + 1}/${total} · ${text}` : text)}`
  }
  busy(button, true, '신청 중…')
  try {
    for (let i = 0; i < total; i++) {
      const meta = metas[i]
      const title = meta.title || ''
      show(i, `신청 중 · ${title}`)
      let result = await api.apply.one({ ...meta, rightsAgreed, forceNew: false }).catch((e) => ({ ok: false, error: e?.message }))
      if (!result.ok && result.duplicate) {
        show(i, `같은 작품명 확인 · ${title}`)
        const choice = await askDuplicate(result, meta, many ? `작품 ${i + 1}` : '')
        if (choice === 'forceNew') {
          show(i, `새 작품으로 신청 중 · ${title}`)
          result = await api.apply.one({ ...meta, rightsAgreed, forceNew: true }).catch((e) => ({ ok: false, error: e?.message }))
        } else {
          // 한 건뿐이면 사용자가 방금 고른 일이라 사유를 다시 띄우지 않는다 (quiet). 여러 건이면 어느 카드가 남았는지 알려야 한다.
          failed.push({ index: i, title, quiet: !many, error: choice === 'episodes' ? '포털에서 회차 추가로 올릴 작품이라 보내지 않았습니다.' : '같은 작품명이 포털에 있어 보내지 않았습니다. 작품명을 고치거나 새 작품으로 등록하세요.' })
          continue
        }
      }
      if (result.ok) accepted.push({ index: i, title, expectedAt: result.record?.expectedAt })
      else failed.push({ index: i, title, error: result.error || '신청에 실패했습니다.' })
    }
  } finally {
    submitting = false
    if (button.isConnected) busy(button, false)
  }

  // 접수된 카드는 지우고 막힌 카드만 남긴다. 동의 체크는 다시 묻지 않는다.
  const works = collectWorks()
  state.works = failed.length ? failed.map((f) => works[f.index]) : [{}]
  state.prefillRights = failed.length > 0
  state.lastResult = accepted.length
    ? { count: accepted.length, title: accepted.map((a) => a.title).join(', '), expectedAt: accepted[0].expectedAt }
    : null
  if (accepted.length) {
    // 포털에 줄이 늘었다. 새 줄이 나오는 쪽까지만 다시 읽어 저장한다 (상세는 새 줄만).
    // 읽는 동안 사용자가 다른 화면이나 불러오기 창을 열어 두었을 수 있으니, 끝나면 보이는 것만 다시 그린다.
    syncRecords('recent').then(() => {
      if (state.view === 'dashboard' || state.view === 'history') render()
      if (!$('#picker').hidden) searchPicker($('#picker-search').value)
    })
  }
  renderIssue($('#view'))
  if (failed.length && failed.every((f) => f.quiet)) return   // 혼자 낸 신청을 스스로 취소한 것. 입력은 그대로 둔다.
  if (failed.length) {
    const box = $('#issue-error')
    box.innerHTML = failed.map((f, k) =>
      `<div>${state.works.length > 1 ? `<strong>작품 ${k + 1}</strong> ` : ''}${f.title ? `「${esc(f.title)}」 ` : ''}${esc(f.error)}</div>`).join('')
    box.hidden = false
    toast(accepted.length
      ? `${accepted.length}건 접수, ${failed.length}건은 보내지 못했습니다. 남은 카드를 확인해 주세요.`
      : (many ? `${failed.length}건 모두 보내지 못했습니다.` : '신청에 실패했습니다.'), 'error')
    $$('.work-card')[0]?.scrollIntoView({ block: 'start' })
  } else {
    toast(many ? `${accepted.length}건이 모두 접수되었습니다.` : '신청이 접수되었습니다.', 'success')
    $('#view').scrollTop = 0
  }
  if (accepted.length) tutorialNotify('applied')
}

/* -------------------------------------------------------------- 발급 이력 */

async function renderHistory (host) {
  const t0 = performance.now()
  await loadRecords()
  const { query, status } = state.filter
  const all = filteredRecords({ query, status })
  const size = historyPageSize()
  const pages = Math.max(1, Math.ceil(all.length / size))
  const page = Math.min(Math.max(1, state.history.page || 1), pages)
  state.history.page = page
  const items = all.slice((page - 1) * size, page * size)
  const total = all.length
  // 뒤에서 읽는 중인데 아직 보여 줄 줄이 없으면(걸러서 없는 게 아니라) 스켈레톤 줄을 둔다
  const skeleton = state.sync.running && !items.length && !query && status === 'all'

  /*
   * 뒤에서 포털을 읽는 중에는 둘 다 잠근다 — 새로고침은 어차피 그 읽기를 기다리게 되고, CSV 는 덜 읽힌 이력이 나간다.
   * 잠긴 버튼은 마우스 이벤트를 안 받아 title 툴팁이 안 뜨는 브라우저가 있어서, 감싸는 요소에 사유를 단다.
   */
  const loading = state.sync.running
  const lock = (html) => loading ? `<span class="tip-wrap" title="${LOADING_TIP} 다 읽으면 쓸 수 있습니다.">${html}</span>` : html
  $('#topbar-actions').innerHTML = lock(`
    <button class="btn btn-default btn-sm" data-action="history-refresh" ${loading ? 'disabled' : ''} title="포털 현황 전체를 다시 읽습니다. 상세는 새로 생긴 줄만 읽습니다.">새로고침</button>
  `) + lock(`
    <button class="btn btn-default btn-sm" data-action="export-csv" ${loading ? 'disabled' : ''} title="읽어 둔 이력을 검색·필터 그대로 CSV로 저장합니다.">CSV로 내보내기</button>
  `)
  bindActions($('#topbar-actions'))

  host.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="row grow">
          <input type="text" id="history-search" class="grow" placeholder="UCI · 작품명 · 작가 · 연재처 · URL로 찾기"
                 value="${esc(query)}" />
          <select id="history-status" class="w-status">
            ${[['all', '전체 상태'], ['pending', GROUP_LABEL.pending], ['needsFix', GROUP_LABEL.needsFix], ['issued', GROUP_LABEL.issued], ['rejected', GROUP_LABEL.rejected]]
              .map(([v, label]) =>
                `<option value="${v}"${status === v ? ' selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </div>
        <div class="row history-meta">
          <label class="faint history-size">한 쪽에
            <select id="history-page-size" title="한 쪽에 보여 줄 건수. 포털 조회 화면의 작품개수와 같은 선택지입니다.">
              ${HISTORY_PAGE_SIZES.map((n) => `<option value="${n}"${n === size ? ' selected' : ''}>${n}건</option>`).join('')}
            </select>
          </label>
          <span class="faint">${skeleton ? skel('total') : `총 ${total}건 · ${page}/${pages}쪽`}</span>
        </div>
      </div>

      ${skeleton ? skelBlock(size) : items.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UCI</th><th>작품명</th><th>작가</th><th>연재처</th><th>회차</th>
              <th>상태</th><th>신청일</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((r) => `
              <tr>
                <td class="cell-uci">${r.uci ? `<button type="button" class="uci-copy" data-action="copy-uci" data-uci="${esc(r.uci)}" title="누르면 UCI 코드를 복사합니다">${esc(r.uci)}${COPY_ICON}</button>` : '<span class="cell-muted">-</span>'}</td>
                <td class="cell-title" title="${esc(r.title)}">${esc(r.title || '(작품명 없음)')}</td>
                <td class="cell-muted">${detailPending(r) ? skel('writer') : esc(r.writer || '-') + (!r.detailAt && r.source === 'portal' ? ' <span class="faint" title="포털 상세를 읽지 못한 줄입니다. 새로고침하면 다시 읽습니다.">(상세 못 읽음)</span>' : '')}</td>
                <td class="cell-muted">${detailPending(r) ? skel('syn') : esc(r.syndicateName || '-')}</td>
                <td class="cell-muted">${episodeRange(r)}</td>
                <td>${statusBadge(r)}</td>
                <td class="cell-muted">${fmtDate(r.appliedAt)}</td>
                <td class="cell-actions">${reapplyButton(r)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagerHTML(page, pages)}` : emptyState(
        query || status !== 'all' ? '조건에 맞는 신청이 없습니다.' : '포털에 신청 내역이 없습니다.',
        'UCI 신청 화면에서 첫 건을 신청해 보세요.'
      )}
    </div>
  `

  bindActions(host)
  const drawMs = Math.round(performance.now() - t0)
  state.timing.lastDrawMs = drawMs
  console.log(`[속도] 이력 ${page}쪽 그리기 ${drawMs}ms (저장된 이력 ${state.records.length}건)`)

  let timer
  $('#history-search').addEventListener('input', (e) => {
    clearTimeout(timer)
    const value = e.target.value
    timer = setTimeout(() => {
      state.filter.query = value
      state.history.page = 1
      renderHistory(host).then(() => {
        const input = $('#history-search')
        if (!input) return
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      })
    }, 150)
  })

  $('#history-status').addEventListener('change', (e) => {
    state.filter.status = e.target.value
    state.history.page = 1
    renderHistory(host)
  })

  // 한 쪽 건수. 고르면 첫 쪽으로 돌아가고, 값은 설정에 남아 다음에 켜도 유지된다.
  $('#history-page-size').addEventListener('change', (e) => {
    const n = Number(e.target.value)
    if (!HISTORY_PAGE_SIZES.includes(n)) return
    state.history.pageSize = n
    state.history.page = 1
    api.settings.set({ historyPageSize: n }).then(refreshSettings).catch(() => {})
    renderHistory(host)
  })
}

/** 쪽 넘김 단추. 현재 쪽 둘레와 처음·끝 쪽. */
function pagerHTML (page, pages) {
  if (pages <= 1) return ''
  const nums = []
  const from = Math.max(1, page - 2)
  const to = Math.min(pages, page + 2)
  if (from > 1) nums.push(1)
  if (from > 2) nums.push('…')
  for (let n = from; n <= to; n++) nums.push(n)
  if (to < pages - 1) nums.push('…')
  if (to < pages) nums.push(pages)
  const btn = (n, label, disabled, primary) =>
    `<button class="btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}" data-action="history-page" data-page="${n}" ${disabled ? 'disabled' : ''}>${label}</button>`
  return `<div class="pager">
    ${btn(page - 1, '‹ 이전', page <= 1, false)}
    ${nums.map((n) => (n === '…' ? '<span class="pager-gap">…</span>' : btn(n, n, n === page, n === page))).join('')}
    ${btn(page + 1, '다음 ›', page >= pages, false)}
  </div>`
}

/* ----------------------------------------------------------------- 설정 */

async function renderSettings (host) {
  await refreshSettings()
  const s = state.settings
  const isPortal = s.mode !== 'mock'

  /*
   * 화면을 둘로 나눈다.
   *
   * 위쪽은 담당자가 실제로 채워야 하는 것들이다. 아래 '고급 설정'은 연동 방식이나 설정 파일처럼
   * 잘못 건드리면 신청이 조용히 안 되는 항목들이라 접어 둔다. (예: 발급 모드를 모의로 바꾸면
   * 신청한 줄 알았는데 포털에는 아무것도 안 간다)
   * 아예 빼지 않는 이유는, 문제가 생겼을 때 손댈 데가 없으면 결국 JSON 파일을 직접 고쳐야 해서다.
   */
  host.innerHTML = `
    <div class="stack">
<div class="card">
        <div class="card-head">
          <div>
            <h3>신청 담당자</h3>
            <p>포털 신청에 반드시 들어가는 정보입니다. 한 번 입력해 두면 매 신청에 자동으로 채워집니다.</p>
          </div>
        </div>
        <div class="card-body">
          <div class="form-grid">
            <label class="field">
              <span class="field-label">담당자명<span class="req">*</span></span>
              <input type="text" id="set-manager-name" value="${esc(s.managerName || '')}" placeholder="예) 김담당" />
            </label>
            <label class="field">
              <span class="field-label">담당자 휴대폰<span class="req">*</span></span>
              <input type="text" id="set-manager-mobile" value="${esc(s.managerMobile || '')}" placeholder="010-0000-0000" />
              <span class="field-help">포털은 <code>010-1234-5678</code> 형식만 받습니다. 숫자만 넣어도 알아서 맞춰집니다.</span>
            </label>
            <label class="field span-2">
              <span class="field-label">담당자 이메일<span class="req">*</span></span>
              <input type="text" id="set-manager-email" value="${esc(s.managerEmail || '')}" placeholder="name@tooning.io" />
            </label>
            <label class="field span-2">
              <span class="field-label">결과 안내방법<span class="req">*</span></span>
              <select id="set-receive-method">
                ${RECEIVE_METHODS.map((m) =>
                  `<option value="${esc(m.value)}"${(s.receiveMethod || 'handphone') === m.value ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
              </select>
              <span class="field-help">심사 결과를 어디로 받을지 정합니다.</span>
            </label>
          </div>
          <label class="checkbox mt-16">
            <input type="checkbox" id="set-privacy-agreed"${s.privacyAgreed ? ' checked' : ''} />
            <span>개인정보 수집 및 이용에 동의합니다.<span class="req">*</span></span>
          </label>
          <span class="faint">포털 신청 시 필수 동의 항목입니다. 체크하지 않으면 신청이 거부됩니다.</span>
        </div>
      </div>

<div class="card">
        <div class="card-head">
          <div>
            <h3>등록자 정보</h3>
            <p>${isPortal
              ? '로그인할 때 포털에서 직접 읽어온 값입니다. 프로그램이 고치지 않습니다.'
              : '모의 연동에서는 등록자번호 보유 상황을 흉내내는 데 씁니다.'}</p>
          </div>
          ${isPortal ? '<button class="btn btn-ghost btn-sm" data-action="recheck-access">다시 읽기</button>' : ''}
        </div>
        <div class="card-body">
          ${state.registrantVerified === false ? `
            <div class="alert alert-warning mb-16">
              <strong>등록자번호는 UCI 신청의 필수 조건입니다.</strong><br />
              웹툰·웹소설 제작 또는 유통 사업자이면서, 관할 시·구청에 <strong>출판사신고</strong>가 완료되어
              <strong>출판사 신고확인증</strong>을 발급받은 곳만 신청할 수 있습니다.
              포털에 로그인해 신고확인증을 첨부하여 등록자번호를 먼저 신청하세요.
              한 번 발급되면 변경할 수 없습니다.
              <br /><br />
              <a href="#" data-action="open-registrant-guide">등록자번호 신청 안내 열기</a>
              · <a href="#" data-action="recheck-access">지금 다시 확인</a>
            </div>` : ''}
          <div class="form-grid">
            <label class="field span-2">
              <span class="field-label">등록자번호</span>
              <input type="text" id="set-registrant-no" value="${esc(s.registrantNo || '')}"
                     placeholder="${isPortal ? '로그인하면 포털에서 자동으로 읽어옵니다' : '아무 값이나 넣으면 보유한 것으로 간주합니다'}"
                     ${isPortal ? 'readonly' : ''} />
              <span class="field-help">
                ${isPortal
                  ? (s.registrantNo
                      ? '✓ 포털에서 확인된 값입니다. 이 계정으로 UCI를 신청할 수 있습니다.'
                      : '아직 읽어오지 못했습니다. 로그인하면 자동으로 채워집니다.')
                  : '모의 연동에서는 이 칸이 비어 있으면 등록자번호가 없는 상황을 흉내냅니다.'}
              </span>
            </label>
            <label class="field">
              <span class="field-label">기관명</span>
              <input type="text" id="set-org-name" value="${esc(s.orgName || '')}" placeholder="예) 투니스퀘어" />
            </label>
            <label class="field">
              <span class="field-label">기관 코드</span>
              <input type="text" id="set-org-code" value="${esc(s.orgCode || '')}" placeholder="예) I410" />
            </label>
            ${isPortal ? '' : `
            <label class="field span-2">
              <span class="field-label">UCI 접두어</span>
              <input type="text" id="set-prefix" value="${esc(s.uciPrefix || '')}" placeholder="I410-ECN-0102" />
              <span class="field-help">모의 연동에서 만들어지는 코드의 앞부분입니다.</span>
            </label>`}
          </div>
        </div>
      </div>

      <div class="row">
        <button class="btn btn-primary" id="settings-save">설정 저장</button>
      </div>

      ${SHOW_ADVANCED_SETTINGS ? `
      <details class="advanced">
        <summary>
          고급 설정
          <span class="faint">연동 방식 · 설정 파일 · 저장 위치 — 평소에는 건드릴 일이 없습니다</span>
        </summary>
        <div class="stack mt-16">
<div class="card">
        <div class="card-head">
          <div>
            <h3>연동 방식</h3>
            <p>UCI를 어디서 발급받을지 결정합니다.</p>
          </div>
        </div>
        <div class="card-body stack">
          ${isPortal ? '' : `
            <div class="alert alert-warning mb-16">
              <strong>지금은 모의 연동입니다.</strong> 신청해도 국립중앙도서관에 접수되지 않습니다.
              실제로 신청하려면 아래에서 <strong>실제 포털 연동</strong>으로 바꾸세요.
            </div>`}
          <label class="field">
            <span class="field-label">발급 모드</span>
            <select id="set-mode">
              <option value="portal"${s.mode === 'portal' ? ' selected' : ''}>실제 포털 연동 — 국립중앙도서관에 실제로 신청 (기본값)</option>
              <option value="mock"${s.mode === 'mock' ? ' selected' : ''}>연습용 — 포털에 접속하지 않음. 화면만 익힐 때</option>
              <option value="api"${s.mode === 'api' ? ' selected' : ''}>API 연동 — 국립중앙도서관 API 개통 시 (아직 미개통)</option>
            </select>
          </label>

          ${s.mode === 'portal' && !state.portalConfigured ? `
            <div class="alert alert-warning">
              ${state.portalLoginConfigured
                ? `로그인 설정은 준비됐지만 <strong>UCI 신청 화면의 입력칸 정보</strong>가 아직 비어 있습니다.
                   로그인은 시도할 수 있고, 발급은 <code>selectors.json</code> 의 <code>issue</code> 항목을
                   채워야 동작합니다.`
                : `실제 포털 연동이 아직 준비되지 않았습니다.
                   <code>src/main/providers/selectors.json</code> 의 <code>configured</code> 를
                   <code>true</code> 로 바꿔 주세요. 그때까지는 포털에 접속하지 않습니다.`}
              <br />파일 안에 채우는 방법이 적혀 있습니다.
            </div>` : ''}

          <label class="field">
            <span class="field-label">포털 주소</span>
            <input type="text" id="set-portal-url" value="${esc(s.portalUrl || '')}" placeholder="https://uci.or.kr" />
            <span class="field-help">실제 포털 연동 시 접속할 기본 주소입니다.</span>
          </label>

          <label class="checkbox">
            <input type="checkbox" id="set-show-window"${s.showAutomationWindow ? ' checked' : ''} />
            <span>포털 연동 중 브라우저 창 표시 (동작 확인·문제 해결용)</span>
          </label>
        </div>
      </div>

<div class="card">
        <div class="card-head">
          <div>
            <h3>포털 연동 설정 파일</h3>
            <p>포털 화면의 입력칸 정보입니다. 이 파일만 고치면 되고 프로그램은 다시 설치하지 않아도 됩니다.</p>
          </div>
          <div class="row">
            <button class="btn btn-ghost btn-sm" data-action="reset-selectors">기본값 복원</button>
            <button class="btn btn-default btn-sm" data-action="open-selectors">파일 열기</button>
          </div>
        </div>
        <div class="card-body stack-sm">
          ${state.selectorsError ? `
            <div class="alert alert-error">
              설정 파일에 문제가 있습니다 — ${esc(state.selectorsError)}<br />
              쉼표나 따옴표가 빠지지 않았는지 확인해 주세요. 꼬였으면 <strong>기본값 복원</strong>을 쓰시면 됩니다.
            </div>` : ''}
          <div class="row-between">
            <span class="muted">파일 위치</span>
            <button class="btn btn-ghost btn-sm" data-action="reveal-selectors">폴더에서 보기</button>
          </div>
          <code class="break-all">${esc(state.selectorsFile || '')}</code>
          <span class="faint">고친 내용은 저장하는 즉시 반영됩니다. 프로그램을 껐다 켤 필요 없습니다.</span>
        </div>
      </div>

<div class="card">
        <div class="card-head">
          <div><h3>저장된 정보</h3><p>이 컴퓨터에 보관되는 것은 설정과 로그인 정보뿐입니다. 신청 이력은 파일에 남기지 않고 로그인할 때마다 포털에서 읽어 옵니다.</p></div>
        </div>
        <div class="card-body stack-sm">
          ${state.dataHealth?.error ? `
            <div class="alert ${state.dataHealth.readOnly ? 'alert-error' : 'alert-warning'}">
              ${esc(state.dataHealth.error)}
              ${state.dataHealth.readOnly
                ? '<br /><strong>이번 실행에서는 설정이 저장되지 않습니다.</strong> 폴더를 열어 보관된 파일을 확인해 주세요.'
                : ''}
            </div>` : ''}
          <div class="row-between">
            <span class="muted">설정 파일</span>
            <button class="btn btn-ghost btn-sm" data-action="reveal-data">폴더에서 보기</button>
          </div>
          <code class="break-all">${esc(state.dataFile || '')}</code>
          <div class="row-between mt-16">
            <span class="muted">저장된 로그인 정보</span>
            <button class="btn btn-ghost btn-sm" data-action="clear-credential">지우기</button>
          </div>
          <span class="faint">비밀번호는 운영체제 보안 저장소로 암호화되어 보관됩니다.</span>
        </div>
      </div>

        </div>
      </details>` : ''}

      <p class="faint" id="app-version"></p>
    </div>
  `

  bindActions(host)

  api.app.info().then((info) => {
    if (info.ok) {
      // 요소가 없어도 그냥 넘어간다. 여기서 터지면 이 화면 준비가 통째로 중단된다.
      const box = $('#app-version')
      if (box) box.textContent = `UCI 등록 도우미 v${info.version} · Electron ${info.electron}`
    }
  })

  // 발급 모드는 고급 설정에만 있다. 감춰 두면 요소가 없으므로 그때는 건너뛴다.
  // 여기서 터지면 아래의 저장 버튼 연결까지 통째로 중단돼 설정 저장이 조용히 먹통이 된다.
  $('#set-mode')?.addEventListener('change', async (e) => {
    await api.settings.set({ mode: e.target.value })
    await renderSettings(host)
    applyModeBadges()
  })

  // 휴대폰은 입력칸을 벗어날 때 바로 형식을 맞춰준다. 저장 후에 틀렸다고 하면 늦다.
  $('#set-manager-mobile')?.addEventListener('blur', (e) => {
    if (e.target.value.trim()) e.target.value = formatMobile(e.target.value)
  })

  $('#settings-save').addEventListener('click', async () => {
    const mobile = formatMobile($('#set-manager-mobile').value)
    const email = $('#set-manager-email').value.trim()

    // 포털과 같은 규칙으로 먼저 거른다. 신청 도중에 튕기는 것보다 여기서 막는 게 낫다.
    if (mobile && !isValidMobile(mobile)) {
      toast('휴대폰번호 형식이 올바르지 않습니다. (예: 010-1234-5678)', 'error')
      $('#set-manager-mobile').classList.add('invalid')
      $('#set-manager-mobile').focus()
      return
    }
    if (email && !isValidEmail(email)) {
      toast('이메일 형식이 올바르지 않습니다.', 'error')
      $('#set-manager-email').classList.add('invalid')
      $('#set-manager-email').focus()
      return
    }
    $$('.invalid', $('#view')).forEach((el) => el.classList.remove('invalid'))

    await api.settings.set({
      // 아래 둘은 고급 설정 안에 있다. 감춰 두면 요소가 없으므로 저장에서 빼고
      // 기존 값을 그대로 유지한다. (없는 요소를 읽으면 저장 자체가 실패한다)
      ...($('#set-portal-url') ? { portalUrl: $('#set-portal-url').value.trim() } : {}),
      ...($('#set-show-window') ? { showAutomationWindow: $('#set-show-window').checked } : {}),
      managerName: $('#set-manager-name').value.trim(),
      managerEmail: email,
      managerMobile: mobile,
      receiveMethod: $('#set-receive-method').value,
      privacyAgreed: $('#set-privacy-agreed').checked,
      // 포털 모드에서는 이 값을 포털에서 읽어오므로 화면에서 덮어쓰지 않는다.
      ...(isPortal ? {} : { registrantNo: $('#set-registrant-no').value.trim() }),
      orgName: $('#set-org-name').value.trim(),
      orgCode: $('#set-org-code').value.trim(),
      // 실제 연동에서는 이 칸을 감추므로 있을 때만 읽는다.
      ...($('#set-prefix') ? { uciPrefix: $('#set-prefix').value.trim() || 'I410-ECN-0102' } : {})
    })
    await refreshSettings()
    applyModeBadges()
    toast('설정이 저장되었습니다.', 'success')
    tutorialNotify('settings-saved')
  })
}

/* ------------------------------------------------------- 공통 동작 바인딩 */

/** data-action 속성이 붙은 버튼들을 한 곳에서 처리한다. */
function bindActions (root) {
  $$('[data-action]', root).forEach((el) => {
    el.addEventListener('click', async () => {
      const action = el.dataset.action

      switch (action) {
        case 'go-issue': return navigate('issue')
        case 'go-history': return navigate('history')
        case 'go-dashboard': return navigate('dashboard')
        case 'go-settings': return navigate('settings')

        case 'refresh-status':
          return runStatusRefresh(el)

        case 'start-edu':
          return showOnboarding()

        case 'start-practice': {
          if (tutorial.active) return
          const ok = window.confirm('연습을 시작하면 지금 로그인은 끊기고 연습 계정으로 들어갑니다. 계속할까요?')
          if (ok) await startPractice()
          return
        }

        case 'open-portal':
          return api.app.openExternal(state.settings?.portalUrl || 'https://www.nl.go.kr/seoji/')

        case 'open-registrant-guide':
          return api.app.openExternal('https://www.nl.go.kr/seoji/contents/S90101000000.do')

        case 'recheck-access': {
          // 연습 중에는 포털이 없으니 자격을 물을 곳이 없다. 등록자번호가 없다는 모의 응답으로 화면을 잠그지 않는다.
          if (tutorial.active) { toast('연습 모드에서는 신청 자격을 확인하지 않습니다. 바로 신청해 보세요.'); return }
          toast('포털에 신청 자격을 확인하는 중…')
          const res = await api.auth.verifyAccess()
          state.accessError = res.ok ? null : res.error
          await refreshSettings()
          toast(res.ok
            ? `UCI 신청이 가능한 계정입니다.${res.account?.registrantNo ? ` (등록자번호 ${res.account.registrantNo})` : ''}`
            : (res.error || '확인하지 못했습니다.'), res.ok ? 'success' : 'error')
          return render()
        }

        case 'load-previous':
          return openPicker(Number(el.dataset.i))

        case 'reapply':
          return reapply(el.dataset.id)

        case 'add-author': {
          const i = Number(el.dataset.i)
          state.works = collectWorksRaw()
          const w = state.works[i] || (state.works[i] = {})
          w.authors = [...(w.authors || []), { role: '글', name: '' }]
          renderIssue($('#view'))
          const rows = $$('.work-card')[i] ? $$('.author-row', $$('.work-card')[i]) : []
          $('[name="authorName"]', rows[rows.length - 1])?.focus()
          return
        }

        case 'remove-author': {
          const i = Number(el.dataset.i), a = Number(el.dataset.a)
          state.works = collectWorksRaw()
          const w = state.works[i]
          if (w && Array.isArray(w.authors) && w.authors.length > 1) w.authors.splice(a, 1)
          renderIssue($('#view'))
          return
        }

        case 'dup-add-episodes':
          api.app.openExternal(PORTAL_APPLY_MENU[el.dataset.type === 'webnovel' ? 'webnovel' : 'webtoon'])
          if (duplicateResolve) duplicateResolve('episodes')
          return

        case 'dup-force-new':
          if (duplicateResolve) duplicateResolve('forceNew')
          return

        case 'dup-cancel':
          if (duplicateResolve) duplicateResolve('cancel')
          else $('#issue-error').hidden = true
          return

        case 'add-work': {
          // 다시 그리기 전에 입력값을 담아 둔다. 안 그러면 쓰던 내용이 날아간다.
          state.works = collectWorks()
          state.works.push({})
          renderIssue($('#view'))
          const cards = $$('.work-card')
          cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return
        }

        case 'remove-work': {
          const i = Number(el.dataset.i)
          state.works = collectWorks()
          if (state.works.length <= 1) return
          state.works.splice(i, 1)
          renderIssue($('#view'))
          return
        }

        case 'reset-work': {
          const i = Number(el.dataset.i)
          state.works = collectWorks()
          state.works[i] = {}
          renderIssue($('#view'))
          return
        }

        case 'reset-form': {
          const form = $('#issue-form')
          if (form) {
            form.reset()
            $$('.invalid', form).forEach((f) => f.classList.remove('invalid'))
            $('#issue-error').hidden = true
          }
          return
        }

        case 'copy-uci':
          await api.app.copy(el.dataset.uci)
          toast('클립보드에 복사했습니다.', 'success')
          return

        case 'dismiss-result':
          state.lastResult = null
          return renderIssue($('#view'))

        case 'history-page': {
          const n = Number(el.dataset.page)
          if (n >= 1) { state.history.page = n; renderHistory($('#view')) }
          return
        }

        case 'sync-retry': {
          // 뒤에서 도는 불러오기를 다시 건다. 진행과 결과는 onSyncEvent 가 받아 상단 바에 보여 준다.
          setSyncRunning('full')
          syncRecords('full').then(() => { if (state.view === 'dashboard' || state.view === 'history') render() })
          return
        }

        case 'history-refresh': {
          busy(el, true, '읽는 중…')
          const res = await syncRecords('full', (p) => { if (el.isConnected) el.innerHTML = `<span class="spinner"></span>${esc(syncProgressText(p))}` })
          if (el.isConnected) busy(el, false)
          if (!res.ok) toast(res.error || '포털 현황을 읽지 못했습니다.', 'error')
          else toast(`포털 현황 ${res.total}건을 다시 읽었습니다.${res.detailed ? ` 상세 ${res.detailed}건을 채웠습니다.` : ''}`, 'success')
          return render()
        }

        case 'export-csv': {
          busy(el, true, '저장 중…')
          const res = await api.records.exportCsv(state.filter).catch((e) => ({ ok: false, error: e?.message }))
          if (el.isConnected) busy(el, false)
          if (res.ok) toast(`${res.count}건을 CSV로 저장했습니다.`, 'success')
          else if (!res.cancelled) toast(res.error || '내보내기에 실패했습니다.', 'error')
          return
        }

        case 'reveal-data':
          return api.app.revealData()

        case 'open-selectors': {
          const res = await api.settings.openSelectors()
          if (res.revealedInstead) {
            toast('연결된 편집기가 없어 폴더를 열었습니다. 메모장으로 열어 주세요.')
          }
          return
        }

        case 'reveal-selectors':
          return api.settings.revealSelectors()

        case 'reset-selectors': {
          const res = await api.settings.resetSelectors()
          if (res.ok) toast('설정을 기본값으로 되돌렸습니다.', 'success')
          return renderSettings($('#view'))
        }

        case 'clear-credential':
          await api.auth.clearCredential()
          toast('저장된 로그인 정보를 지웠습니다.')
          return
      }
    })
  })
}

/* ------------------------------------------------- 처음 사용자 안내 (온보딩) */

/*
 * 도움말 화면의 요점 카드 세 장. (처음 사용자 교육은 edu/ 의 대화형 페이지가 맡는다)
 *
 * UCI 가 뭔지 → 받으려면 먼저 뭐가 필요한지 → 신청하면 어떻게 진행되는지.
 * 수치나 법령은 넣지 않는다 — 바뀔 수 있고 확인도 어렵다. 절차만 담는다.
 */
const HELP_PAGES = [
  {
    title: 'UCI가 뭔가요',
    lead: '콘텐츠 하나하나에 붙는 고유 번호입니다. 책에 ISBN이 있듯, 웹툰·웹소설에는 UCI를 씁니다.',
    points: [
      ['작가가 아니라 작품에 붙습니다', '회차 단위로도 받을 수 있고, 연재하는 플랫폼이 바뀌어도 번호는 그대로입니다.'],
      ['국립중앙도서관이 발급합니다', '연재형 웹콘텐츠는 ISBN 대상에서 빠졌고, 그 자리를 UCI가 이어받았습니다.'],
      ['한 번 받으면 계속 씁니다', '매년 갱신하는 번호가 아닙니다. 연재 허가증 같은 것도 아니고, 식별 번호입니다.']
    ]
  },
  {
    title: '받으려면 먼저 준비할 것',
    lead: '두 가지가 갖춰져 있어야 신청할 수 있습니다.',
    points: [
      ['등록자번호', '출판사 신고확인증이 있는 사업자(제작사·유통사)만 받습니다. 시·구청 출판사 신고 → 국립중앙도서관 포털에서 등록자번호 신청. 한 번만 받으면 되고 발급 후에는 바꿀 수 없습니다.'],
      ['저작권자 동의', '작가의 동의 없이 등록하면 법적 책임은 등록자에게 있고 발급이 취소될 수 있습니다. 계약서의 동의 조항을 확인하세요.']
    ],
    note: '등록자번호가 없는 계정은 이 프로그램에서 신청 버튼이 잠깁니다. 그 경우 안내 링크로 발급 절차를 확인할 수 있습니다.'
  },
  {
    title: '신청하면 이렇게 진행됩니다',
    flow: ['작품 정보 입력', '신청', '업무일 3일 심사', 'UCI 발급', '결과 확인'],
    points: [
      ['이 프로그램이 포털 신청 화면을 대신 채웁니다', '포털의 입력칸 46개 중 실제 필수 항목만 추렸습니다. 담당자 정보는 한 번 저장해 두면 매번 자동으로 들어갑니다.'],
      ['결과는 대시보드에서 확인합니다', '심사 결과는 이메일·알림톡으로도 오지만, 대시보드의 「심사 결과 조회」 한 번으로 심사중인 건을 한꺼번에 확인합니다.'],
      ['발급된 UCI는 신청 이력에서 봅니다', '코드를 복사하거나 엑셀로 내보낼 수 있습니다.']
    ],
    note: '이미 UCI를 받은 작품에 회차를 더하는 「회차 추가」는 이 프로그램이 다루지 않습니다. 포털에서 직접 하세요.',
    practice: true
  }
]

/*
 * 교육은 edu/ 폴더의 대화형 페이지를 iframe 으로 띄운다. 바깥과는 메시지로만 이야기한다.
 *   ready    — 페이지가 떴다 (로드·보안 설정 확인용)
 *   practice — 교육 끝에서 '연습 시작' → 연습 모드로 들어간다
 *   close    — 닫거나 '나중에' → 처음 안내는 본 것으로 친다
 */
const EDU_URL = 'edu/index.html'

function showOnboarding () {
  state.eduReady = false
  $('#edu-frame').src = EDU_URL // 매번 처음부터
  $('#edu').hidden = false
}

function hideOnboarding () {
  $('#edu').hidden = true
  $('#edu-frame').src = 'about:blank'
}

window.addEventListener('message', async (e) => {
  const m = e.data
  if (!m || m.source !== 'uci-edu') return
  if (m.event === 'ready') { state.eduReady = true; return }
  if (m.event === 'practice') { hideOnboarding(); await startPractice(); return }
  if (m.event === 'close') {
    hideOnboarding()
    if (!state.settings?.onboardingDone) { await api.tutorial.skip(); await refreshSettings() }
  }
})

/* ------------------------------------------------------------ 연습 (코치) */

/*
 * 연습은 실제 화면을 그대로 쓴다. 모의 연동으로 바꾸고 연습 계정으로 들어간 뒤,
 * 화면 아래 코치 띠가 '지금 할 일' 을 알려주고, 사용자가 그걸 마치면 다음으로 넘어간다.
 *
 * 단계: 담당자 정보 → 작품 신청 → 결과 조회 → UCI 확인.
 * 실제 담당자가 처음 쓸 때 거치는 순서 그대로다. 담당자 정보는 연습이 끝나도 남는다 —
 * 어차피 실제 신청에도 필요한 값이라, 연습하면서 설정까지 끝나는 셈이다.
 */
const SAMPLE_WORK = {
  contentType: 'webtoon', publishForm: '연재형', title: '연습용 작품',
  authors: [{ role: '글/그림', name: '홍길동' }], ageGrade: 'AL', syndicate: 'NC', serialStatus: '연재중',
  url: 'https://comic.naver.com/webtoon/list?titleId=000000',
  episodeStart: '1', episodeEnd: '10', priceKind: '비매품 무료', price: '0', currency: '원',
  genres: ['드라마']
}

const COACH_STEPS = {
  settings: {
    n: 1, target: 'settings', title: '담당자 정보 입력',
    text: '신청할 때 포털이 요구하는 담당자 정보입니다. 한 번 저장해 두면 매번 자동으로 들어갑니다. 실제 정보를 입력하세요 — 연습이 끝나도 그대로 쓰입니다.',
    actions: [['설정으로 이동', () => navigate('settings')]]
  },
  apply: {
    n: 2, target: 'issue', title: '작품 신청',
    text: '작품 정보를 채우고 「UCI 신청하기」를 누르세요. 연습이라 포털에는 보내지 않습니다. 항목 옆 물음표에 입력 요령이 있습니다.',
    actions: [['신청 화면으로 이동', () => navigate('issue')], ['샘플로 채우기', fillSampleWork]]
  },
  refresh: {
    n: 3, target: 'dashboard', title: '심사 결과 조회',
    text: '실제로는 업무일 3일이 걸리지만 연습에서는 10초면 끝납니다. 대시보드에서 「심사 결과 조회」를 누르세요.',
    actions: [['대시보드로 이동', () => navigate('dashboard')]]
  },
  history: {
    n: 4, target: 'history', title: '발급된 UCI 확인',
    text: '발급된 UCI는 신청 이력에서 봅니다. 표의 UCI 칸에서 코드를 확인하고, 코드나 옆의 복사 아이콘을 누르면 복사됩니다.',
    actions: [['신청 이력으로 이동', () => navigate('history')]]
  }
}

const tutorial = { active: false, step: null, appliedAt: 0, timer: null }

async function startPractice () {
  const res = await api.tutorial.start()
  if (!res.ok) { toast(res.error || '연습을 시작하지 못했습니다.', 'error'); return }

  await refreshSettings()
  state.user = res.user
  state.accessError = null
  state.registrantVerified = true // 연습에서는 자격 확인을 막지 않는다
  state.lastResult = null
  state.works = [{}]

  tutorial.active = true
  document.body.classList.add('practicing')
  $('#practice-bar').hidden = false
  await syncRecords('full')   // 연습용(모의) 포털에서 읽는다. 바로 끝난다.
  enterApp()

  // 담당자 정보가 이미 있으면(다시 연습하는 경우) 그 단계는 건너뛴다.
  const s = state.settings || {}
  const hasManager = s.managerName && s.managerEmail && s.managerMobile && s.privacyAgreed
  setCoachStep(hasManager ? 'apply' : 'settings')
}

function setCoachStep (step) {
  tutorial.step = step
  clearInterval(tutorial.timer)
  const def = COACH_STEPS[step]

  $$('.nav-item').forEach((b) => b.classList.toggle('coach-target', b.dataset.view === def.target))
  $('#coach-step').textContent = `${def.n} / 4`
  $('#coach-title').textContent = def.title
  $('#coach-text').textContent = def.text

  const host = $('#coach-actions')
  host.innerHTML = ''
  def.actions.forEach(([label, fn], i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = i === 0 ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'
    b.textContent = label
    b.addEventListener('click', fn)
    host.appendChild(b)
  })
  $('#coach').hidden = false
}

/** 화면 곳곳에서 '이런 일이 있었다' 고 알려주면, 지금 단계가 끝났는지 보고 넘어간다. */
function tutorialNotify (event, data) {
  if (!tutorial.active) return
  const s = state.settings || {}

  switch (tutorial.step) {
    case 'settings':
      if (event === 'settings-saved' && s.managerName && s.managerEmail && s.managerMobile && s.privacyAgreed) {
        toast('담당자 정보 저장 완료. 다음은 작품 신청입니다.', 'success')
        setCoachStep('apply')
      }
      return

    case 'apply':
      if (event === 'applied') {
        tutorial.appliedAt = Date.now()
        setCoachStep('refresh')
        startRefreshCountdown()
      }
      return

    case 'refresh':
      if (event === 'refreshed' && data?.items?.some((i) => i.status === 'issued')) {
        clearInterval(tutorial.timer)
        toast('발급됐습니다. 신청 이력에서 확인해 보세요.', 'success')
        setCoachStep('history')
      } else if (event === 'refreshed') {
        startRefreshCountdown()
      }
      return

    case 'history':
      if (event === 'view' && data === 'history') showFinishButton()
  }
}

/** 연습의 심사는 10초. 몇 초 남았는지 보여주면 왜 아직 심사중인지 헷갈리지 않는다. */
function startRefreshCountdown () {
  clearInterval(tutorial.timer)
  const tick = () => {
    const left = Math.ceil((tutorial.appliedAt + 10000 - Date.now()) / 1000)
    $('#coach-text').textContent = left > 0
      ? `연습에서는 심사가 10초 걸립니다. ${left}초 뒤 대시보드에서 「심사 결과 조회」를 누르세요.`
      : '지금 대시보드에서 「심사 결과 조회」를 누르세요. 발급완료로 바뀝니다.'
    if (left <= 0) clearInterval(tutorial.timer)
  }
  tick()
  tutorial.timer = setInterval(tick, 1000)
}

function showFinishButton () {
  $('#coach-text').textContent = '표의 UCI 칸에 발급된 코드가 보입니다. 실제 신청도 이 순서 그대로입니다 — 신청 → 업무일 3일 뒤 결과 조회 → 여기서 확인.'
  const host = $('#coach-actions')
  host.innerHTML = ''
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn btn-primary btn-sm'
  b.textContent = '연습 마치고 실제로 시작하기'
  b.addEventListener('click', finishPractice)
  host.appendChild(b)
}

function fillSampleWork () {
  state.works = [{ ...SAMPLE_WORK }]
  state.prefillRights = true
  if (state.view !== 'issue') navigate('issue')
  else renderIssue($('#view'))
  toast('샘플 작품으로 채웠습니다. 맨 아래 「UCI 신청하기」를 누르세요.')
}

/**
 * 연습을 끝낸다. 연습 기록을 지우고 실제 연동으로 되돌린 뒤 로그인 화면으로 보낸다.
 * 그만두기도 같은 길을 탄다 — 중간에 그만둬도 연습 흔적을 남기면 안 된다.
 */
async function finishPractice (quit = false) {
  clearInterval(tutorial.timer)
  await api.tutorial.finish()
  await refreshSettings()

  tutorial.active = false
  tutorial.step = null
  state.records = []
  document.body.classList.remove('practicing')
  $('#coach').hidden = true
  $('#practice-bar').hidden = true
  $$('.nav-item').forEach((b) => b.classList.remove('coach-target'))

  state.user = null
  state.lastResult = null
  state.works = [{}]
  state.registrantVerified = undefined
  $('#app-screen').hidden = true
  $('#login-screen').hidden = false
  $('#login-pw').value = ''
  $('#login-error').hidden = true
  applyModeBadges()

  const notice = $('#login-notice')
  notice.textContent = quit === true
    ? '연습을 그만뒀습니다. 연습 기록은 지웠습니다. 도움말 메뉴에서 언제든 다시 할 수 있습니다.'
    : '연습을 마쳤습니다. 연습 기록은 지웠습니다. 이제 실제 포털 계정으로 로그인하세요.'
  notice.hidden = false
  $('#login-id').focus()
}

$('#practice-quit').addEventListener('click', () => finishPractice(true))

/* ------------------------------------------------------------ 도움말 화면 */

function renderHelp (host) {
  const cards = HELP_PAGES.map((page) => `
    <div class="card help-card">
      <div class="card-body">
        <h3>${esc(page.title)}</h3>
        ${page.lead ? `<p class="faint mb-16">${esc(page.lead)}</p>` : ''}
        ${page.flow ? `<div class="ob-flow">${page.flow.map((f, i) =>
          `${i ? '<span class="arrow">→</span>' : ''}<span>${esc(f)}</span>`).join('')}</div>` : ''}
        <ul class="ob-points">
          ${page.points.map(([t, d], i) => `
            <li><span class="n">${i + 1}</span><div><strong>${esc(t)}</strong><span class="faint">${esc(d)}</span></div></li>`).join('')}
        </ul>
        ${page.note ? `<p class="ob-note">${esc(page.note)}</p>` : ''}
      </div>
    </div>`).join('')

  host.innerHTML = `
    <div class="stack">
      <div class="help-grid">${cards}</div>

      <div class="card">
        <div class="card-head">
          <div><h3>교육 다시 보기</h3><p>선배와 함께 UCI 개념부터 신청 절차까지 대화로 배웁니다. 약 15분.</p></div>
          <button class="btn btn-default" data-action="start-edu">교육 보기</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>연습해 보기</h3><p>실제 화면 그대로 신청부터 결과 확인까지 해봅니다. 포털에는 아무것도 보내지 않습니다.</p></div>
          <button class="btn btn-primary" data-action="start-practice" ${tutorial.active ? 'disabled' : ''}>연습 시작</button>
        </div>
        <div class="card-body">
          <p class="faint">연습을 시작하면 지금 로그인은 끊기고 연습 계정으로 들어갑니다. 끝나면 연습 기록은 지워지고 다시 로그인 화면으로 돌아옵니다. 약 2분 걸립니다.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>바로 가기</h3></div></div>
        <div class="card-body stack-sm">
          <a href="#" data-action="open-registrant-guide">등록자번호 신청 안내 (국립중앙도서관)</a>
          <a href="#" data-action="open-portal">국립중앙도서관 포털 열기</a>
          <a href="#" data-action="dup-add-episodes" data-type="webtoon">회차 추가 — 웹툰 신청 화면 (포털에서 직접)</a>
          <a href="#" data-action="dup-add-episodes" data-type="webnovel">회차 추가 — 웹소설 신청 화면 (포털에서 직접)</a>
        </div>
      </div>
    </div>
  `
  bindActions(host)
}

/* ------------------------------------------------------------- 안내 말풍선 */

/**
 * 말풍선이 화면 오른쪽 밖으로 잘릴 것 같으면 왼쪽으로 뒤집는다.
 *
 * 말풍선은 물음표에서 오른쪽으로 최대 300px 펼쳐진다. 창이 좁거나 오른쪽 칸이면
 * 잘릴 수 있는데, 어느 칸인지는 CSS 로 알 수 없어 보여주기 직전에 실제 위치를 잰다.
 * 화면을 다시 그려도 따로 붙일 필요가 없도록 문서 전체에서 한 번만 받는다.
 */
const TIP_WIDTH = 300
function placeTip (e) {
  const mark = e.target?.closest?.('.tip-mark')
  if (!mark) return
  const bound = ($('#view') || document.body).getBoundingClientRect()
  const left = mark.getBoundingClientRect().left
  mark.classList.toggle('tip-flip', left + TIP_WIDTH > bound.right - 16)
}
document.addEventListener('mouseover', placeTip)
document.addEventListener('focusin', placeTip)

/*
 * title 툴팁은 브라우저가 띄우는데 마우스를 올리고 1초 가까이 지나야 뜬다. 상태 글자의 사유, 잠긴 버튼의 이유처럼
 * 바로 봐야 하는 안내가 늦게 떠서 없는 줄 알게 된다 (2026-10-22). 그래서 title 을 가로채 80ms 안에 직접 그린다.
 * 그린 문구는 data-tip-text 로 옮겨 두고 title 은 지운다 — 브라우저 툴팁이 겹쳐 뜨지 않도록.
 */
const TIP_DELAY = 80
let tipTimer = null
let tipFor = null
function tipBox () {
  let box = $('#tipbox')
  if (!box) {
    box = document.createElement('div')
    box.id = 'tipbox'
    box.className = 'tipbox'
    box.hidden = true
    document.body.appendChild(box)
  }
  return box
}
function showTip (el) {
  const text = el.getAttribute('data-tip-text')
  if (!text) return
  const box = tipBox()
  box.textContent = text
  box.hidden = false
  box.style.left = '0px'
  box.style.top = '0px'
  const r = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  let left = r.left
  if (left + b.width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - 12 - b.width)
  let top = r.bottom + 8
  if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - 8 - b.height)
  box.style.left = `${Math.round(left)}px`
  box.style.top = `${Math.round(top)}px`
  box.classList.add('on')
  tipFor = el
}
function hideTip () {
  clearTimeout(tipTimer)
  tipTimer = null
  tipFor = null
  const box = $('#tipbox')
  if (box) { box.classList.remove('on'); box.hidden = true }
}
document.addEventListener('mouseover', (e) => {
  const el = e.target?.closest?.('[title], [data-tip-text]')
  if (!el || el.closest('.tip-mark')) return
  if (el.hasAttribute('title')) {
    el.setAttribute('data-tip-text', el.getAttribute('title'))
    el.removeAttribute('title')
  }
  if (tipFor === el) return
  hideTip()
  tipTimer = setTimeout(() => showTip(el), TIP_DELAY)
})
document.addEventListener('mouseout', (e) => {
  const el = e.target?.closest?.('[data-tip-text]')
  if (!el) return
  if (e.relatedTarget && el.contains(e.relatedTarget)) return
  hideTip()
})
document.addEventListener('mousedown', hideTip)
document.addEventListener('scroll', hideTip, true)

/* ------------------------------------------------------------------ 시작 */

initLogin()
initPicker()
