'use strict'

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const store = require('./store')
const { IS_DEMO } = require('../shared/app-mode')
const providers = require('./providers')
const csv = require('./csv')
const selectorConfig = require('./selector-config')
const { addBusinessDays } = require('./business-days')
const constants = require('../shared/uci-constants')

const isDev = process.argv.includes('--dev')

let mainWindow = null

/* --------------------------------------------------------------- 창 생성 */

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'UCI 등록 도우미',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  /*
   * 화면 쪽에서 난 오류는 아무 데도 안 남아서, 사용자에게는 '버튼을 눌러도 아무 일이 없다'
   * 로만 보인다. 원인을 추적할 수 있도록 콘솔 메시지를 프로그램 로그로 끌어온다.
   */
  mainWindow.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level < 2 && !isDev) return   // 평소에는 경고·오류만 남긴다
    const tag = ['로그', '경고', '오류', '디버그'][level] ?? level
    console.log(`[화면 ${tag}] ${message} (${String(source).split('/').pop()}:${line})`)
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  // 외부 링크는 앱 창이 아니라 기본 브라우저에서 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

/**
 * 인스턴스는 하나만 띄운다.
 *
 * 두 개가 동시에 뜨면 각자 이력을 통째로 메모리에 들고 있다가 파일을 덮어쓰기 때문에,
 * 나중에 저장한 쪽이 앞선 쪽의 신청 기록을 지워버린다. 접수번호가 사라지면 심사 결과를
 * 추적할 방법이 없어지므로 아예 두 번째 실행을 막는다.
 * Windows 는 바탕화면 아이콘을 두 번 눌러도 프로세스가 두 개 뜨기 때문에 실제로 흔한 상황이다.
 */
const isPrimaryInstance = app.requestSingleInstanceLock()

if (!isPrimaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    // 설치본 안의 설정 파일은 고칠 수 없으므로 사용자 폴더로 꺼내 쓴다.
    // 새 버전에서 설정 항목이 늘었으면 빠진 것만 채운다. (기존 값은 그대로 둔다)
    try {
      const seeded = selectorConfig.ensureSeeded()
      if (seeded.created) console.log('[selector-config] 설정 파일 생성:', seeded.path)
      if (seeded.added?.length) {
        console.log('[selector-config] 새 설정 항목 추가:', seeded.added.join(', '))
      }
    } catch (e) {
      console.error('[selector-config] 설정 파일 준비 실패:', e)
    }

    // 연습 도중 꺼졌으면 모의 연동이 남아 있다. 데모 빌드와 고급 설정이 보이는 빌드(일부러 모의로 둘 수 있음)는 제외.
    if (!IS_DEMO && !constants.SHOW_ADVANCED_SETTINGS) {
      const leftover = store.clearLeftoverPractice()
      if (leftover.reset) console.log(`[store] 끝나지 않은 연습을 정리했습니다 — 모의 기록 ${leftover.removed}건 삭제, 실제 연동으로 복귀`)
    }

    createWindow()
  })
}

app.on('window-all-closed', () => {
  providers.portal.destroyWindow()
  app.quit()
})

/* ------------------------------------------------------------------ IPC */

/** 핸들러에서 예외가 나도 화면이 멈추지 않도록 공통으로 감싼다. */
function handle (channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      console.error(`[ipc:${channel}]`, e)
      return { ok: false, error: e?.message || '알 수 없는 오류가 발생했습니다.' }
    }
  })
}

/* -- 인증 -- */

/**
 * 로그인 후 UCI 신청 자격을 한 번 확인한다.
 *
 * 등록자번호는 계정에 묶여 있고 한 번 발급되면 바뀌지 않으므로, 한 번 통과하면 다시 보지 않는다.
 * 실패는 기록하지 않는다 — 그 사이에 발급받았을 수 있으니 다음 로그인 때 다시 확인해야 한다.
 * 로그인 자체를 막지는 않는다. 신청은 못 해도 지난 이력은 봐야 하기 때문이다.
 */
async function verifyAccessOnce () {
  if (store.getSettings().registrantVerifiedAt) return { ok: true, cached: true }

  const result = await providers.current().verifyAccess()
  if (result.ok) store.setSettings({ registrantVerifiedAt: new Date().toISOString() })
  return result
}

handle('auth:login', async ({ loginId, password, remember }) => {
  // 다른 계정으로 바꿔 들어오면 앞 계정의 등록자 정보부터 지운다. 안 지우면 두 회사 정보가 섞여 보인다.
  store.prepareLogin(loginId)
  const result = await providers.current().login({ loginId, password })
  if (!result.ok) return result

  /*
   * 저장해 두면 다음에 앱을 켤 때 자동으로 로그인한다. (슬랙처럼)
   * 저장하지 않으면 지운다 — 예전에 저장해 둔 게 남아 있으면 원치 않게 자동 로그인된다.
   */
  if (remember) store.saveCredential(loginId, password)
  else store.clearCredential()
  store.setSettings({ lastLoginId: loginId })

  const access = await verifyAccessOnce()
  // 기관명·코드는 자격 확인이 포털에서 읽어 온다. 로그인 시점의 user 에는 확인 전 값이 들어 있으므로 여기서 맞춘다.
  const s = store.getSettings()
  const user = { ...(result.user || {}), orgName: s.orgName || result.user?.orgName || '', orgCode: s.orgCode || result.user?.orgCode || '' }

  /*
   * 신청 내역 불러오기는 기다리지 않는다. 뒤에서(불러오기 전용 숨은 창) 돌리고 화면은 바로 대시보드로 간다.
   * 화면은 본체가 메모리에 들고 있는 이력(처음엔 비어 있음)을 먼저 보여 주고, 진행(records:syncProgress)에 맞춰 다시 그린다.
   */
  startSync({ scope: 'full' })
  return { ...result, user, access, syncing: true }
})

/**
 * 진행 중인 불러오기. 한 번에 하나만 돈다 — 도는 중에 또 부르면(새로고침·신청 직후) 그 결과를 같이 기다린다.
 * 끝난 뒤에는 마지막 결과를 남겨 화면이 「실패 · 다시 시도」를 보여 줄 수 있게 한다.
 */
let syncRun = null
let lastSync = null

function sendProgress (payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('records:syncProgress', payload)
}

function startSync ({ scope = 'full' } = {}) {
  if (syncRun) return syncRun.promise
  const startedAt = new Date().toISOString()
  sendProgress({ phase: 'start', scope, startedAt })
  const promise = syncPortal({ scope })
    .catch((e) => ({ ok: false, error: e?.message || String(e), scope }))
    .then((res) => {
      syncRun = null
      lastSync = { ...res, scope, startedAt, endedAt: new Date().toISOString() }
      sendProgress({ phase: 'done', result: lastSync })
      return res
    })
  syncRun = { promise, scope, startedAt }
  return promise
}

function syncState () {
  return { ok: true, running: Boolean(syncRun), scope: syncRun?.scope || null, startedAt: syncRun?.startedAt || null, last: lastSync }
}

/**
 * 포털 현황 전체를 읽어 이력에 저장한다 — 로그인 직후(뒤에서) 와 이력의 「새로고침」.
 *
 * 예전에는 화면이 포털 현황을 쪽 단위로 그때그때 읽었다. 그러면 CSV·이전 신청 불러오기·이력에 상세(작가·장르 등)가
 * 비는 줄이 생기고 쪽마다 포털을 기다려야 했다 (2026-10-21 감리 리뷰). 이제 로그인 직후에 현황 전체와 각 건의 상세를
 * 한 번에 읽어 본체 메모리에 두고, 화면·CSV·불러오기는 그것만 쓴다. 이력은 파일에 쓰지 않는다 — 로그인마다 포털에서
 * 새로 읽으므로 남겨 둘 이유가 없다 (2026-10-22). 그래서 로그인은 매번 건수만큼 걸리고, 「새로고침」은 새 줄의 상세만 읽는다.
 * 읽는 동안 화면을 막지 않는다 — 로그인하면 바로 대시보드가 뜨고,
 * 쪽을 읽어 저장할 때마다 진행을 알려 화면이 그때그때 다시 그린다 (2026-10-22).
 *
 * 차례: ⓪ 상태 묶음별 건수를 먼저 센다 (대시보드 숫자가 목록을 다 읽기 전에 채워진다) →
 *       ① 현황을 상태 전체를 체크해 검색하고 끝 쪽까지 읽어 합친다 → ② 이번에 못 본 기록은 「포털에 없음」으로 표시한다 →
 *       ③ 상세를 안 읽은 줄의 상세를 읽는다 → ④ 발급된 건의 회차 범위를 조회/정정 엑셀에서 받는다 →
 *       ⑤ 읽어 둔 이력의 상태별 건수를 ⓪ 의 건수와 대조해 어긋난 묶음을 결과(mismatch)에 적는다.
 * 진행은 records:syncProgress 로 알린다: { phase: 'counts' | 'list' | 'detail' | 'episodes', done, total, title?, counts? }
 *
 * @param scope 'full'   전체 (기본)
 *              'recent' 이미 알던 줄만 나오는 쪽까지만 앞쪽부터 읽는다 (신청 직후). 사라진 줄 표시는 하지 않는다.
 */
async function syncPortal ({ scope = 'full' } = {}) {
  // 불러오기 전용 숨은 창이 있는 연동(실제 포털)은 그 창으로 읽는다. 신청·조회 창과 겹치지 않는다.
  const provider = providers.current()
  const reader = provider.background || provider
  const account = currentAccount()
  const t0 = Date.now()
  const progress = sendProgress
  const known = new Set(store.listRecords({ account }).map((r) => r.portalKey).filter(Boolean))
  const seen = []
  let added = 0
  let updated = 0
  let pages = 1
  let page = 1
  const groups = constants.PORTAL_STATUS_GROUPS

  // ⓪ 상태 묶음별 건수 — 현황 화면에서 그 상태들만 체크해 검색한 건수. 전체 읽기(full)에서만, 셀 수 있는 연동에서만.
  const counts = {}
  if (scope === 'full' && typeof reader.countApplications === 'function') {
    for (const [group, statuses] of Object.entries(groups)) {
      const res = await reader.countApplications({ statuses })
      if (!res.ok) return { ...res, phase: 'counts', group }
      counts[group] = res.total
      progress({ phase: 'counts', done: Object.keys(counts).length, total: Object.keys(groups).length, counts: { ...counts } })
    }
  }

  // ① 현황 — 상태 전체를 체크해 검색하고 10건씩 끝 쪽까지 (포털에 한 쪽 건수를 늘리는 옵션은 없다 — 2026-10-21 확인)
  const allStatuses = Object.values(groups).flat()
  do {
    const res = await reader.listApplications({ page, statuses: allStatuses })
    if (!res.ok) return { ...res, phase: 'list', page }
    pages = res.pages || 1
    const items = res.items.map((it) => ({
      ...it,
      status: constants.mapPortalStatus(it.portalStatus),
      expectedAt: it.appliedAt ? addBusinessDays(it.appliedAt, REVIEW_BUSINESS_DAYS) : ''
    }))
    const m = store.mergePortalRecords(items, account)
    added += m.added
    updated += m.updated
    for (const it of items) if (it.portalKey) seen.push(it.portalKey)
    progress({ phase: 'list', done: page, total: pages })
    if (scope === 'recent' && items.every((it) => known.has(it.portalKey))) break   // 새 줄은 앞쪽에 있다
    page++
  } while (page <= pages && page <= 1000)
  const readPages = Math.min(page, pages)

  // ② 포털에서 사라진 줄
  const gone = scope === 'full' ? store.markPortalSync(account, seen) : { gone: 0, back: 0 }

  // ③ 상세 — 작가·장르·연재처·가격·연령등급·반려 사유. 한 번 읽으면 남는다.
  const need = store.recordsNeedingDetail(account)
  let detailed = 0
  let failed = 0
  if (need.length) {
    const byKey = new Map(need.map((r) => [r.portalKey, r]))
    const res = await reader.getApplicationDetails({
      portalKeys: need.map((r) => r.portalKey),
      onProgress: (p) => progress({ phase: 'detail', ...p })
    })
    if (!res.ok) return { ...res, phase: 'detail' }
    for (const [key, r] of Object.entries(res.results || {})) {
      const rec = byKey.get(key)
      if (!rec) continue
      if (r.ok) { store.applyDetail(rec.id, r.detail); detailed++ } else failed++
    }
  }

  // ④ 회차 범위 — 발급된 건만 포털이 알려 준다 (조회/정정 엑셀). 한 번에 전부.
  const issued = store.listRecords({ account, onPortal: true, status: 'issued' }).filter((r) => r.portalKey)
  let episodes = 0
  if (issued.length) {
    progress({ phase: 'episodes', done: 0, total: issued.length })
    const res = await reader.getIssuedEpisodes({ portalKeys: issued.map((r) => r.portalKey) })
    if (res.ok) episodes = store.applyEpisodes(res.episodes || {}, account)
    progress({ phase: 'episodes', done: issued.length, total: issued.length })
  }

  // ⑤ 대조 — 읽어 둔 이력의 상태별 건수가 ⓪ 의 포털 건수와 같은지. 어긋나면 어느 묶음이 몇 대 몇인지 남긴다.
  const mismatch = []
  if (Object.keys(counts).length) {
    const have = store.stats(account, { onPortal: true })
    for (const group of Object.keys(counts)) {
      if (have[group] !== counts[group]) mismatch.push({ group, portal: counts[group], loaded: have[group] })
    }
    if (mismatch.length) console.warn(`[sync] 건수 불일치: ${mismatch.map((m) => `${m.group} 포털 ${m.portal} / 읽음 ${m.loaded}`).join(', ')}`)
  }

  const out = { ok: true, scope, pages: readPages, total: seen.length, added, updated, gone: gone.gone, detailed, failed, episodes, counts, mismatch, ms: Date.now() - t0 }
  console.log(`[sync] ${JSON.stringify(out)}`)
  return out
}

handle('records:sync', async (opts) => startSync(opts || {}))
handle('records:syncState', async () => syncState())

/**
 * 기록 한 건의 상세를 포털에서 읽어 이력에 넣는다.
 * 포털에서 가져온 줄은 작가·장르·연재처·가격이 비어 있는데, 상세 화면에는 전부 있다 (2026-10-21 확인).
 */
async function fetchDetail (id) {
  const record = store.getRecord(id)
  if (!record) return { ok: false, error: '기록을 찾을 수 없습니다.' }
  if (!record.portalKey) return { ok: false, error: '포털 신청 키가 없는 기록입니다. 현황을 다시 읽은 뒤 시도해 주세요.' }
  const res = await providers.current().getApplicationDetail({ portalKey: record.portalKey })
  if (!res.ok) return res
  return { ok: true, record: store.applyDetail(id, res.detail) }
}

/** 설정 화면의 '다시 확인' 버튼. 등록자번호를 새로 받은 뒤 앱을 껐다 켜지 않아도 되게 한다. */
handle('auth:verifyAccess', async () => {
  store.setSettings({ registrantVerifiedAt: '' })
  return verifyAccessOnce()
})

/*
 * 로그아웃하면 저장된 비밀번호를 지운다. 그래야 다음에 켰을 때 자동 로그인되지 않는다.
 * 그러지 않으면 로그아웃해도 다시 켜는 순간 들어가 버려서, 다른 계정으로 바꿀 방법이 없다.
 * 아이디는 lastLoginId 로 남아 로그인 칸을 채워 준다.
 */
handle('auth:logout', async () => {
  store.clearCredential()
  return providers.current().logout()
})

/* -- 처음 사용자 안내 · 연습 -- */

/**
 * 연습을 시작한다. 모의 연동으로 바꾸고 연습 계정으로 로그인한다.
 *
 * 연습 중에는 포털에 아무것도 보내지 않는다. 실제 계정으로 로그인돼 있었다면
 * 먼저 그 세션을 끊는다 — 두 세션이 겹쳐 있으면 어느 쪽으로 신청되는지 헷갈린다.
 */
handle('tutorial:start', async () => {
  await providers.portal.logout().catch(() => {})
  store.setSettings({ mode: 'mock' })
  const result = await providers.mock.login({ loginId: '연습', password: '연습' })
  if (!result.ok) return result
  return { ...result, user: { ...result.user, name: '연습 사용자', orgName: '연습 모드' } }
})

/**
 * 연습을 끝낸다. 연습 중 쌓인 기록을 지우고 실제 연동으로 되돌린다.
 *
 * 연습 기록이 실제 이력에 섞여 있으면 '이건 진짜 신청한 건가' 헷갈린다.
 * 기록에는 어느 모드에서 만들어졌는지(mode) 남아 있으므로 그걸로 걸러낸다.
 */
handle('tutorial:finish', async () => {
  const removed = store.removeRecords((r) => r.mode === 'mock')
  await providers.mock.logout().catch(() => {})
  store.setSettings({ mode: 'portal', onboardingDone: true })
  return { ok: true, removed }
})

handle('tutorial:skip', async () => {
  store.setSettings({ onboardingDone: true })
  return { ok: true }
})

handle('auth:session', async () => {
  return { ok: true, user: providers.current().getSession() }
})

handle('auth:savedCredential', async () => {
  return { ok: true, credential: store.getCredential() }
})

handle('auth:clearCredential', async () => {
  store.clearCredential()
  return { ok: true }
})

/* -- 신청 -- */

/** 신청 처리기한: 신청일로부터 업무일 3일 (국립중앙도서관 안내 기준) */
const REVIEW_BUSINESS_DAYS = 3

/**
 * 신청 결과를 이력으로 남긴다.
 *
 * 이 포털은 신청 즉시 UCI를 주지 않는다. 접수만 되고 심사는 나중에 끝나므로,
 * 성공한 건은 'pending'(심사중) 으로 들어가고 UCI 칸은 비어 있다.
 * 결과가 나오면 uci:refreshStatus 가 같은 행을 갱신한다.
 */
function recordApplication (meta, result, mode) {
  const appliedAt = result.appliedAt || new Date().toISOString()
  return store.addRecord({
    ...meta,
    account: currentAccount(),
    uci: '',
    status: result.ok ? 'pending' : 'failed',
    error: result.ok ? '' : result.error,
    appliedAt,
    expectedAt: result.ok ? addBusinessDays(appliedAt, REVIEW_BUSINESS_DAYS) : '',
    issuedAt: '',
    mode
  })
}

/**
 * 작품 정보에 설정에 저장된 담당자 정보를 합친다.
 *
 * 담당자명·이메일·휴대폰·안내방법·개인정보 동의는 포털의 필수 항목이지만
 * 작품마다 바뀌지 않는다. 매번 입력하게 하면 폼만 길어지므로 설정에서 가져온다.
 */
function withManagerInfo (meta) {
  const s = store.getSettings()
  return {
    ...meta,
    managerName: s.managerName,
    managerEmail: s.managerEmail,
    managerMobile: s.managerMobile,
    receiveMethod: s.receiveMethod || 'handphone',
    privacyAgreed: Boolean(s.privacyAgreed)
  }
}

/**
 * 지금 로그인한 계정. 기록은 이 값으로 계정별로 나뉜다.
 * 한 PC 에서 여러 계정을 쓰면 서로의 이력이 섞여 보이고 상태가 덮어씌워질 수 있어서다 (2026-10-16 파트너 상황).
 * 연습 중에는 연습 계정이 되고, 연습 기록은 끝날 때 지워진다.
 */
function currentAccount () {
  return providers.current().getSession()?.loginId || store.getSettings().lastLoginId || ''
}

/** 작가 줄 목록을 정리하고, 표·CSV 에 보일 한 줄 표기(역할·이름을 쉼표로)를 함께 넣는다. */
function withAuthors (meta) {
  const authors = constants.authorsOf(meta)
  return {
    ...meta,
    url: constants.normalizeUrl(meta.url),   // 앞부분(https://) 이 빠진 주소는 채워서 보낸다
    authors,
    writerRole: authors.map((a) => a.role).join(', '),
    writer: authors.map((a) => a.name).join(', ')
  }
}

handle('uci:apply', async (rawMeta) => {
  const mode = store.getSettings().mode
  const meta = withManagerInfo(withAuthors(rawMeta))
  // 숫자 칸에 글자 같은 형식 오류는 화면이 먼저 거르지만, 본체에서도 보내기 직전에 막는다. 연동 종류와 무관하다.
  const typed = constants.typeProblem(meta)
  if (typed) return { ok: false, error: typed.message, field: typed.field }
  const result = await providers.current().apply(meta)
  // 포털이 같은 작품명을 찾아 멈춘 것은 신청이 아니다. 화면이 사용자에게 갈래를 묻고, 고른 뒤에 다시 들어온다.
  if (result.duplicate) return result
  const record = recordApplication(meta, result, mode)
  return { ...result, record }
})

/**
 * 여러 작품을 엑셀로 묶어 한 번에 신청한다.
 *
 * 포털은 2건 이상을 화면에 하나씩 넣게 하지 않고 엑셀 파일 업로드를 요구한다.
 * 담당자 정보와 저작권 동의는 파일이 아니라 화면에서 한 번만 받으므로,
 * 여기서도 대표로 첫 건의 담당자 정보를 쓴다 (어차피 설정에서 오는 같은 값이다).
 *
 * 이력은 건별과 똑같이 작품 하나당 한 줄로 남긴다. 조회는 작품명으로 하기 때문에
 * 묶어서 한 줄로 남기면 나중에 결과를 못 찾는다.
 */
handle('uci:applyBulk', async (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: '신청할 작품이 없습니다.' }
  }
  const mode = store.getSettings().mode
  const items = rawItems.map((m) => withManagerInfo(withAuthors(m)))
  for (let i = 0; i < items.length; i++) {
    const typed = constants.typeProblem(items[i])
    if (typed) return { ok: false, error: `작품 ${i + 1}: ${typed.message}`, field: typed.field, index: i }
  }

  const result = await providers.current().applyBulk(items)
  if (result.duplicate) return result   // 건별과 같다 — 아직 신청한 게 아니다

  // 실패해도 이력에는 남긴다. 무엇을 시도했는지 사라지면 안 된다.
  const records = items.map((meta) => recordApplication(meta, result, mode))
  return { ...result, records, count: records.length, expectedAt: records[0]?.expectedAt || '' }
})

/**
 * 심사중인 신청 건들의 결과를 조회해 이력을 갱신한다.
 * 대시보드의 '결과 조회' 버튼이 부르는 동작이다.
 */
handle('uci:refreshStatus', async () => {
  const provider = providers.current()
  const targets = store.pendingRecords(currentAccount())
  if (!targets.length) return { ok: true, checked: 0, updated: 0, items: [] }

  const items = []
  let updated = 0

  for (let i = 0; i < targets.length; i++) {
    const record = targets[i]
    const result = await provider.checkStatus(record)

    if (result.ok && result.status && result.status !== record.status) {
      store.updateRecord(record.id, {
        status: result.status,
        uci: result.uci || record.uci || '',
        issuedAt: result.issuedAt || record.issuedAt || '',
        error: result.reason || '',
        portalStatus: result.portalStatus || '',
        portalNote: result.portalNote || '',
        checkedAt: result.checkedAt || new Date().toISOString()
      })
      updated++
      items.push({ title: record.title, status: result.status, uci: result.uci || '' })
      // 반려·보완요청은 사유가 현황 목록에 없고 상세 화면에 있다. 키가 있으면 읽어 비고에 남긴다.
      if ((result.status === 'rejected' || result.status === 'needsFix') && (result.portalKey || record.portalKey)) {
        if (result.portalKey && !record.portalKey) store.updateRecord(record.id, { portalKey: result.portalKey })
        await fetchDetail(record.id).catch(() => null)
      }
    } else if (result.ok) {
      // 상태가 그대로여도 언제 확인했는지는 남긴다.
      store.updateRecord(record.id, {
        portalStatus: result.portalStatus || '',
        portalNote: result.portalNote || '',
        checkedAt: result.checkedAt || new Date().toISOString()
      })
    } else if (!result.ok) {
      items.push({ title: record.title, status: 'error', error: result.error })
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uci:refreshProgress', {
        done: i + 1,
        total: targets.length,
        title: record.title
      })
    }
  }

  return { ok: true, checked: targets.length, updated, items }
})

handle('uci:lookup', async (uci) => {
  return providers.current().lookup(uci)
})

/* -- 이력 -- */

handle('records:list', async (filter) => {
  const account = currentAccount()
  return { ok: true, items: store.listRecords({ ...(filter || {}), account, onPortal: true }), stats: store.stats(account) }
})

handle('records:delete', async (id) => {
  return { ok: store.deleteRecord(id) }
})

handle('records:clear', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['취소', '전체 삭제'],
    defaultId: 0,
    cancelId: 0,
    message: '이 계정의 발급 이력을 모두 삭제할까요?',
    detail: '이 앱에 저장된 기록만 지워집니다. 포털에 실제로 발급된 UCI는 취소되지 않습니다.'
  })
  if (response !== 1) return { ok: false, cancelled: true }
  return { ok: true, deleted: store.clearRecords(currentAccount()) }
})

const EXPORT_COLUMNS = [
  { key: 'uci', label: 'UCI' },
  { key: 'statusText', label: '상태' },
  { key: 'contentTypeText', label: '유형' },
  { key: 'publishForm', label: '연재유형' },
  { key: 'title', label: '작품명' },
  { key: 'writerRole', label: '작가역할' },
  { key: 'writer', label: '작가명' },
  { key: 'genresText', label: '장르' },
  { key: 'ageGrade', label: '연령등급' },
  { key: 'syndicateName', label: '연재처' },
  { key: 'url', label: '작품URL' },
  { key: 'priceKind', label: '가격구분' },
  { key: 'price', label: '가격' },
  { key: 'currency', label: '가격단위' },
  { key: 'serialStatus', label: '연재상태' },
  { key: 'episodeStart', label: '회차시작' },
  { key: 'episodeEnd', label: '회차끝' },
  { key: 'appliedAt', label: '신청일시' },
  { key: 'expectedAt', label: '처리예정일' },
  { key: 'issuedAt', label: '발급일시' },
  { key: 'portalStatus', label: '포털상태' },
  { key: 'portalNote', label: '포털 처리내용' },
  { key: 'error', label: '비고' },
  { key: 'account', label: '계정' }
]

/**
 * CSV 내보내기. 메모리의 이력(포털에서 읽어 둔 것)을 검색·상태 필터 그대로 쓴다.
 *
 * 예전에는 이 PC 의 신청 기록만 내보내 다른 PC 에서 로그인하면 작가·장르가 빈 CSV 가 나왔다 (2026-10-21 감리 리뷰).
 * 이제 로그인 직후 불러오기가 포털 현황 전체와 상세를 저장해 두므로 여기서는 포털을 기다리지 않는다.
 */
handle('records:export', async (filter) => {
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'UCI 발급 이력 내보내기',
    defaultPath: `UCI_발급이력_${stamp}.csv`,
    filters: [{ name: 'CSV 파일', extensions: ['csv'] }]
  })
  if (canceled || !filePath) return { ok: false, cancelled: true }

  const rows = store.listRecords({
    query: String(filter?.query || '').trim(),
    status: filter?.status && filter.status !== 'all' ? filter.status : 'all',
    account: currentAccount(),
    onPortal: true
  })
  if (!rows.length) return { ok: false, error: '내보낼 이력이 없습니다.' }

  // 장르는 배열이라 CSV 한 칸에 넣으려면 문자열로 펴야 한다. 상태·유형은 화면과 같은 우리말로.
  const STATUS_TEXT = { pending: '심사중', needsFix: '보완요청', issued: '발급완료', rejected: '반려', failed: '신청실패' }
  const typeText = (v) => (constants.CONTENT_TYPES.find((c) => c.value === v) || {}).label || v || ''
  const items = rows.map((r) => ({
    ...r,
    statusText: STATUS_TEXT[r.status] || r.status || '',
    contentTypeText: typeText(r.contentType),
    genresText: Array.isArray(r.genres) ? r.genres.join(', ') : (r.genres || '')
  }))
  fs.writeFileSync(filePath, csv.stringify(items, EXPORT_COLUMNS), 'utf8')
  return { ok: true, filePath, count: items.length }
})

/* -- 대량 발급용 CSV 불러오기 -- */

/* -- 설정 · 기타 -- */

handle('settings:get', async () => {
  return {
    ok: true,
    settings: store.getSettings(),
    portalConfigured: providers.portal.isConfigured(),
    portalLoginConfigured: providers.portal.isLoginConfigured(),
    dataFile: store.filePath(),
    dataHealth: store.getHealth(),
    registrantVerified: Boolean(store.getSettings().registrantVerifiedAt),
    selectorsFile: selectorConfig.userPath(),
    selectorsError: selectorConfig.validationError()
  }
})

handle('settings:set', async (patch) => {
  return { ok: true, settings: store.setSettings(patch) }
})

/** 연동 설정 파일을 기본 편집기로 연다. 연결된 프로그램이 없으면 폴더를 대신 열어준다. */
handle('settings:openSelectors', async () => {
  const file = selectorConfig.userPath()
  selectorConfig.ensureSeeded()

  const problem = await shell.openPath(file)
  if (problem) {
    shell.showItemInFolder(file)
    return { ok: true, revealedInstead: true }
  }
  return { ok: true, filePath: file }
})

handle('settings:revealSelectors', async () => {
  selectorConfig.ensureSeeded()
  shell.showItemInFolder(selectorConfig.userPath())
  return { ok: true }
})

handle('settings:resetSelectors', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['취소', '기본값으로 되돌리기'],
    defaultId: 0,
    cancelId: 0,
    message: '포털 연동 설정을 기본값으로 되돌릴까요?',
    detail: '직접 채워 넣은 화면 선택자가 모두 지워지고 처음 상태로 돌아갑니다.'
  })
  if (response !== 1) return { ok: false, cancelled: true }

  return { ok: true, filePath: selectorConfig.resetToDefault() }
})

handle('app:info', async () => {
  return {
    ok: true,
    version: app.getVersion(),
    electron: process.versions.electron,
    dataFile: store.filePath(),
    demo: IS_DEMO
  }
})

handle('app:copy', async (text) => {
  clipboard.writeText(String(text ?? ''))
  return { ok: true }
})

handle('app:openExternal', async (url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: '올바른 주소가 아닙니다.' }
  await shell.openExternal(url)
  return { ok: true }
})

handle('app:revealData', async () => {
  shell.showItemInFolder(store.filePath())
  return { ok: true }
})
