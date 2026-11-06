'use strict'

const { BrowserWindow, ipcMain, session: electronSession } = require('electron')
const { AsyncLocalStorage } = require('node:async_hooks')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const store = require('../store')
const XLSX = require('xlsx')
const selectorConfig = require('../selector-config')
const constants = require('../../shared/uci-constants')
const { SHOW_ADVANCED_SETTINGS } = constants
const { writeBulkFile } = require('../bulk-excel')

/**
 * 실제 국립중앙도서관 UCI 포털 자동화 제공자.
 *
 * 포털에 공개 REST API가 없기 때문에, 사람이 브라우저에서 하는 동작(로그인 → 폼 입력 →
 * 발급 버튼)을 그대로 재현한다. Electron 자체가 Chromium이라 별도 브라우저 드라이버
 * (Playwright/Selenium)를 설치할 필요 없이 숨은 창 하나로 처리한다.
 *
 * 화면 구조에 의존하는 부분은 전부 selectors.json 으로 빼놨다.
 * 포털이 개편되면 코드가 아니라 그 파일만 고치면 된다.
 */

/**
 * 자동화가 어디까지 갔는지 남긴다.
 *
 * 포털 자동화는 눈에 안 보이는 곳에서 여러 단계를 거치기 때문에, 멈췄을 때
 * 어느 단계인지 모르면 원인을 좁힐 수가 없다. 각 단계를 시각과 함께 찍는다.
 */
function step (message) {
  console.log(`[portal ${new Date().toISOString().slice(11, 23)}] ${message}`)
}

/** 로그인 쿠키를 앱 재실행 후에도 유지하기 위한 전용 세션 파티션 */
const PARTITION = 'persist:uci-portal'

let session = null

/**
 * 숨은 창은 둘이다 — 하나는 신청·조회·로그인(main), 하나는 로그인 직후 신청 내역 불러오기(sync).
 *
 * 불러오기는 현황을 끝 쪽까지 읽고 건마다 상세를 받느라 길다. 창이 하나뿐이면 그동안 신청·조회가 줄을 서야 해서
 * 로그인 뒤 한참을 기다려야 했다 (2026-10-22). 둘은 같은 세션 파티션을 써서 로그인 쿠키를 나눠 갖는다.
 *
 * 창마다 자기 것을 따로 둔다:
 *   win            창 자체
 *   dialogQueue    창에서 올라온 대화상자 메시지. 메인 프로세스에 쌓으므로 페이지가 이동해도 남는다.
 *                  각 항목은 { kind: 'alert'|'confirm'|'prompt', message }.
 *   popupRequests  포털이 새 창을 열려고 한 요청들. 창은 열어 주지 않고(숨긴 자동화 창에서 팝업이 튀어나오면 안 된다)
 *                  무엇을 열려 했는지만 적어 둔다. 지금 쓰는 곳은 하나 — 같은 작품명이 있을 때 포털이 여는 중복 확인 창.
 *   turn           이 창을 쓰는 동작의 차례 (inTurn)
 *   statusSearch   이 창의 현황 화면에 걸려 있는 검색(상태·검색어). 같은 검색의 다음 쪽은 쪽만 넘긴다 (listApplications)
 *
 * 어느 창을 쓸지는 AsyncLocalStorage 로 정한다. inTurn 이 동작을 시작할 때 창을 정해 두면, 그 동작이 부르는
 * navigate·evaluate 같은 도우미는 전부 그 창을 쓴다. 따로 정하지 않은 호출(시험 등)은 main 창이다.
 */
function makeLane (name) {
  return { name, win: null, dialogQueue: [], popupRequests: [], turn: Promise.resolve(), statusSearch: null }
}
const mainLane = makeLane('main')
const syncLane = makeLane('sync')
const laneStorage = new AsyncLocalStorage()
const lane = () => laneStorage.getStore() || mainLane

let dialogListenerAttached = false

function attachDialogListener () {
  if (dialogListenerAttached) return
  ipcMain.on('portal:dialog', (event, payload) => {
    // 자동화 창에서 온 것만 받고, 그 창의 큐에 넣는다. 앱 창은 이 채널을 쓰지 않는다.
    const L = [mainLane, syncLane].find((l) => l.win && !l.win.isDestroyed() && event.sender === l.win.webContents)
    if (!L) return
    L.dialogQueue.push({
      kind: payload?.kind === 'confirm' || payload?.kind === 'prompt' ? payload.kind : 'alert',
      message: String(payload?.message || '').trim()
    })
  })
  dialogListenerAttached = true
}

/**
 * 화면 선택자 설정을 읽는다.
 *
 * 매번 파일에서 다시 읽는다. 설정을 고친 뒤 프로그램을 껐다 켜지 않아도 바로 반영되도록
 * 하기 위해서다. 실제 연동을 맞춰가는 동안에는 값을 여러 번 고치게 된다.
 * ("_readme", "//..." 같은 주석 키는 실제 동작에 쓰지 않는다.)
 */
function loadSelectors () {
  return selectorConfig.load()
}

/**
 * 실제 포털에 접속해도 되는 상태인지 확인한다.
 *
 * configured 를 직접 확인하는 이유: 선택자가 채워져 있다는 것만으로는 설정이 끝났다고 볼 수 없다.
 * 담당자가 다 확인하고 true 로 바꿨을 때만 진짜 접속을 시도한다.
 * 이 장치가 없으면 설정 전에 엉뚱한 주소로 접속하다 응답 대기로 멈춰버린다.
 *
 * 로그인과 발급을 나눠 보는 이유: 계정을 막 받았을 때는 발급 폼 선택자를 아직 모르는 상태라도
 * 로그인이 되는지부터 확인해 보는 게 순서이기 때문이다.
 */
function isLoginConfigured () {
  try {
    const s = loadSelectors()
    return s.configured === true &&
      Boolean(s.login?.idInput && s.login?.passwordInput && s.login?.submitButton)
  } catch {
    // 파일이 깨져 있으면 준비되지 않은 것으로 본다. 사유는 설정 화면이 따로 보여준다.
    return false
  }
}

function isConfigured () {
  try {
    const s = loadSelectors()
    return isLoginConfigured() && Boolean(s.apply?.submitButton && s.apply?.fields?.title)
  } catch {
    return false
  }
}

/* -------------------------------------------------------- 브라우저 제어 */

async function ensureWindow () {
  const L = lane()
  if (L.win && !L.win.isDestroyed()) return L.win

  /*
   * 자동화 창을 보여줄지는 고급 설정의 값을 따른다. 다만 고급 설정을 감춰 두면
   * 그 값을 켜고 끌 방법도 사라지므로, 그때는 저장된 값과 상관없이 항상 숨긴다.
   * (예전에 켜 둔 사람이 끌 수 없는 채로 창이 계속 뜨는 일을 막는다)
   * 불러오기 창은 설정과 상관없이 늘 숨긴다 — 사용자가 보는 동안 뒤에서 도는 창이다.
   */
  const showAutomationWindow = L === mainLane && SHOW_ADVANCED_SETTINGS && Boolean(store.getSettings().showAutomationWindow)
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: Boolean(showAutomationWindow),
    title: L === syncLane ? 'UCI 신청 내역 불러오는 중…' : 'UCI 포털 연동 중…',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'portal-preload.js'),
      nodeIntegration: false,
      // preload 가 페이지의 alert 을 덮어쓰려면 같은 전역을 공유해야 한다.
      // 이 창은 포털 화면 전용이고 Node 권한은 주지 않는다. (앱 창은 격리를 유지한다)
      contextIsolation: false,
      sandbox: false
    }
  })

  // "이 페이지를 벗어나시겠습니까?" 확인창이 이동을 막지 않도록 통과시킨다.
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault())

  /*
   * 포털이 window.open 이나 target 이 있는 폼 전송으로 새 창을 열려 하면 막고 기록만 한다.
   * 같은 작품명이 있을 때 포털은 접수 대신 중복 확인 창(popup / popup2)을 여는데(2026-10-15 확인),
   * 예전에는 이 창이 그대로 떠 버리고 프로그램은 결과를 못 받아 시간 초과로 끝났다.
   */
  win.webContents.setWindowOpenHandler((details) => {
    L.popupRequests.push({ url: String(details.url || ''), frameName: String(details.frameName || ''), at: Date.now() })
    return { action: 'deny' }
  })

  attachDialogListener()
  win.on('closed', () => { if (L.win === win) L.win = null })
  L.win = win
  return win
}

/**
 * 쌓인 대화상자 메시지를 꺼낸다. 꺼낸 것은 큐에서 지운다.
 *
 * 기본적으로 alert 만 본다. 확인창(confirm) 문구까지 섞으면
 * "UCI를 신청하시겠습니까?" 같은 정상 흐름의 문구가 실패 사유로 둔갑한다.
 *
 * @returns {string[]} 메시지 배열. 여러 개를 한 문장으로 이어 붙이지 않는다 —
 *   이어 붙이면 서로 다른 안내가 섞여 성공·실패 판정이 뒤집힐 수 있다.
 */
function drainDialogs (kinds = ['alert']) {
  const L = lane()
  const taken = L.dialogQueue.filter((d) => kinds.includes(d.kind))
  L.dialogQueue = L.dialogQueue.filter((d) => !kinds.includes(d.kind))
  return taken.map((d) => d.message).filter(Boolean)
}

/**
 * 큐를 비운다.
 *
 * 버튼을 누르기 직전에 호출한다. 화면에 들어올 때 뜬 안내 알림("업무일 3일이 소요됩니다")이
 * 남아 있으면, 제출 결과가 오기도 전에 그 문구를 결과로 착각하기 때문이다.
 */
function clearDialogs () {
  const L = lane()
  L.dialogQueue = []
  L.popupRequests = []
}

/** 쌓인 새 창 요청을 꺼낸다. 꺼낸 것은 지운다. */
function takePopups () {
  const L = lane()
  const taken = L.popupRequests
  L.popupRequests = []
  return taken
}

/**
 * 새 창 요청이 포털의 중복 확인 창인지.
 * 포털은 먼저 window.open('', '창이름') 을 부르고, 그다음 그 창 이름을 target 으로 폼을 보낸다.
 * 첫 요청은 주소가 비어 창 이름으로, 둘째 요청은 주소로 알아본다. 둘 중 하나만 와도 중복이다.
 */
function isDuplicatePopup (p, marker, frameName) {
  if (!p) return false
  if (frameName && p.frameName === frameName) return true
  return Boolean(marker) && String(p.url || '').includes(marker)
}

/** 숨은 창을 모두 닫는다 (로그아웃·종료). */
function destroyWindow () {
  for (const L of [mainLane, syncLane]) {
    if (L.win && !L.win.isDestroyed()) L.win.destroy()
    L.win = null
  }
}

async function navigate (url, timeout) {
  const w = await ensureWindow()

  await new Promise((resolve, reject) => {
    let timer = null
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      // 창이 이미 닫혔다면 webContents 에 손대는 것 자체가 예외를 던진다.
      if (w.isDestroyed()) return
      w.webContents.off('dom-ready', onReady)
      w.webContents.off('did-finish-load', onLoad)
      w.webContents.off('did-fail-load', onFail)
    }

    // 로딩 완료·실패·시간 초과가 겹쳐 들어와도 처음 한 번만 결론을 낸다.
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }

    /*
     * did-finish-load 를 기다리면 안 된다.
     *
     * 그 사건은 광고·트래커·외부 폰트까지 '전부' 받아야 뜬다. 이 포털은 그중 하나가
     * 자주 늘어지고, 그러면 화면은 멀쩡히 다 보이는데도 30초 뒤 '로딩 시간 초과'로
     * 실패한다. 우리가 실제로 필요한 건 DOM 이 준비된 시점 뿐이다 — 그 뒤 어차피
     * waitForSelector 로 원하는 요소가 나올 때까지 다시 기다린다.
     */
    const onReady = () => settle(resolve)
    const onLoad = () => settle(resolve)

    /*
     * 실패로 볼 것은 '주 프레임' 실패뿐이다. 페이지 안 iframe 이나 하위 리소스가
     * 하나 깨졌다고 해서 이동 자체를 실패로 처리하면, 멀쩡히 열린 화면을 두고 물러난다.
     */
    const onFail = (_event, code, desc, _validatedUrl, isMainFrame) => {
      if (!isMainFrame) return
      /*
       * ERR_ABORTED(-3) 는 우리가 연 주소가 다른 이동에 밀린 것이다 — 포털 페이지가 스스로 location 을 바꾸는 중에
       * 우리 loadURL 이 겹치면 난다 (2026-10-22 재로그인 때 실제로 겪음: 로그인 화면 열기가 -3 으로 끝나 불러오기가 실패했다).
       * 실패가 아니라 다음 화면이 뜨는 중이므로, 그 화면의 dom-ready 를 그대로 기다린다. 시간 초과는 따로 잡는다.
       */
      if (code === -3) return
      settle(reject, new Error(`페이지를 열지 못했습니다 (${code ?? '?'} ${desc ?? ''}): ${url}`))
    }

    timer = setTimeout(() => settle(reject, new Error(`페이지 로딩 시간 초과: ${url}`)), timeout)

    w.webContents.once('dom-ready', onReady)
    w.webContents.once('did-finish-load', onLoad)
    w.webContents.on('did-fail-load', onFail)
    // 리다이렉트·중단처럼 did-fail-load 로 오지 않는 실패도 있어 따로 받아둔다.
    w.loadURL(url).catch((e) => settle(reject, new Error(`페이지를 열지 못했습니다: ${e.message}`)))
  })

  return w
}

/**
 * 페이지 안에서 표현식을 평가한다.
 *
 * executeJavaScript 는 페이지가 멈춰 있으면 영원히 응답하지 않는다. 그러면 이 함수를 부른
 * 모든 동작이 같이 멈추고, 화면에서는 '로그인 중…' 스피너가 끝없이 도는 것으로 보인다.
 * 그래서 반드시 시간 제한을 둔다. 시간이 지나면 예외를 던져 위쪽에서 사유를 표시하게 한다.
 */
const EVALUATE_TIMEOUT = 10000

async function evaluate (expression, timeout = EVALUATE_TIMEOUT) {
  const w = await ensureWindow()
  let timer = null
  try {
    return await Promise.race([
      w.webContents.executeJavaScript(expression, true),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          step(`스크립트 실행 시간 초과 (${timeout}ms): ${expression.slice(0, 60).replace(/\s+/g, ' ')}`)
          reject(new Error('페이지가 응답하지 않습니다. (스크립트 실행 시간 초과)'))
        }, timeout)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** 선택자에 해당하는 요소가 나타날 때까지 폴링한다. */
async function waitForSelector (selector, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    // 한 번의 평가가 실패해도 폴링은 계속한다. 페이지 전환 중에는 일시적으로 실패할 수 있다.
    const found = await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
      .catch(() => false)
    if (found) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/**
 * 입력칸에 값을 채운다.
 * React/Vue 같은 프레임워크가 붙어 있어도 값이 반영되도록 input·change 이벤트를 직접 발생시킨다.
 */
async function fillField (selector, value) {
  if (!selector || value == null || value === '') return false
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const v = ${JSON.stringify(String(value))};
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
}

/** 같은 name 의 입력칸이 여러 개일 때 index 번째를 채운다 (작가 줄처럼 포털이 줄을 늘리는 칸). */
async function fillIndexed (selector, index, value) {
  if (!selector || value == null || value === '') return false
  return evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${Number(index)}];
    if (!el) return false;
    const v = ${JSON.stringify(String(value))};
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
}

/** 페이지를 바꾸는 스크립트(폼 전송 등)를 실행하고 새 페이지가 다 뜰 때까지 기다린다. */
async function evaluateAndWaitForLoad (expression, timeout = 30000) {
  const w = await ensureWindow()
  const loaded = new Promise((resolve) => {
    const onLoad = () => { clearTimeout(timer); resolve(true) }
    const timer = setTimeout(() => { if (!w.isDestroyed()) w.webContents.off('did-finish-load', onLoad); resolve(false) }, timeout)
    w.webContents.once('did-finish-load', onLoad)
  })
  const ran = await evaluate(expression).catch(() => false)
  if (!ran) return false
  return loaded
}

/**
 * 선택 상자에서 값 또는 보이는 글자가 맞는 항목을 고른다.
 *
 * fillField 는 value 를 그대로 넣는데, 선택지 value 가 화면 글자와 다른 칸(연령등급)은
 * 그 방식으로는 아무것도 선택되지 않는다. 후보를 여러 개 받아 value 든 글자든 먼저 맞는
 * 항목을 고르고, 고른 항목의 value 를 돌려준다. 없으면 false.
 */
async function fillSelect (selector, candidates) {
  const wants = [].concat(candidates).map((c) => String(c ?? '').trim()).filter(Boolean)
  if (!selector || !wants.length) return false
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || !(el instanceof HTMLSelectElement)) return false;
    const opts = [...el.options];
    let hit = null;
    for (const w of ${JSON.stringify(wants)}) {
      hit = opts.find((o) => o.value === w) || opts.find((o) => o.textContent.trim() === w);
      if (hit) break;
    }
    if (!hit) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (setter) setter.call(el, hit.value); else el.value = hit.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return hit.value;
  })()`)
}

/** 체크박스를 원하는 상태로 만든다. 이미 그 상태면 건드리지 않는다. */
async function setChecked (selector, checked) {
  if (!selector) return false
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    if (el.checked !== ${Boolean(checked)}) el.click();
    return true;
  })()`)
}

/**
 * 클릭한 뒤 페이지 이동이 끝날 때까지 기다린다.
 *
 * 포털의 '작품 건별 신청' 은 링크가 아니라 폼을 POST 로 제출해 화면을 바꾼다.
 * 클릭 직후 곧바로 선택자를 찾으면 아직 이전 화면을 보고 있어서 없다고 판단해 버린다.
 * 이동이 시작조차 안 한 시점에 폴링을 시작하는 셈이라, 포털이 조금만 느려도 실패했다.
 * 그래서 이동 완료 신호를 먼저 기다린 뒤에 요소를 찾는다.
 */
async function clickAndWaitForNavigation (selector, timeout) {
  const w = await ensureWindow()

  // 리스너를 먼저 걸어야 한다. 클릭 후에 걸면 그 사이의 이동을 놓친다.
  const navigated = new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer)
      if (!w.isDestroyed()) w.webContents.off('did-finish-load', onLoad)
      resolve(result)
    }
    const onLoad = () => finish(true)
    const timer = setTimeout(() => finish(false), timeout)
    w.webContents.once('did-finish-load', onLoad)
  })

  const clicked = await clickElement(selector).catch(() => false)
  if (!clicked) return { clicked: false, navigated: false }
  return { clicked: true, navigated: await navigated }
}

async function clickElement (selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`)
}

async function readText (selector) {
  if (!selector) return ''
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? (el.innerText || el.textContent || '').trim() : '';
  })()`)
}

/**
 * 로그인이 됐는지 판단한다.
 *
 * successMarker 를 지정했으면 그 요소의 존재로 보고, 비워 뒀으면 로그인 폼이 사라졌는지로 본다.
 * 이 포털은 로그인에 실패하면 로그인 화면에 그대로 머무르기 때문에, 아이디 입력칸이
 * 없어졌다는 것만으로도 화면이 넘어갔다는 뜻이 된다. 덕분에 로그인 후에만 볼 수 있는
 * 요소의 선택자를 미리 알아내지 않아도 판정이 된다.
 */
async function isLoggedIn (s) {
  if (s.login.successMarker) {
    return evaluate(`!!document.querySelector(${JSON.stringify(s.login.successMarker)})`)
  }
  return evaluate(`!document.querySelector(${JSON.stringify(s.login.idInput)})`)
}



/** 로그인이 필요한 화면인데 로그인 화면으로 튕겼는지 본다. */
async function bouncedToLogin (s) {
  return evaluate(`!!document.querySelector(${JSON.stringify(s.login.idInput)})`)
}

/**
 * 지금 어느 화면에 있는지 알아낸다.
 *
 * 원하던 화면이 안 나왔을 때 "선택자를 확인하세요"라고만 하면 엉뚱한 곳을 뒤지게 된다.
 * 실제로 어디에 도착했는지(주소·제목)를 같이 알려줘야 원인을 짚을 수 있다.
 */
async function whereAmI () {
  try {
    return await evaluate(`(() => {
      const h = document.querySelector('h2, h3, .title, #contents h2');
      return {
        url: location.href,
        title: document.title,
        heading: h ? (h.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : '',
        bodyHint: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200)
      };
    })()`)
  } catch {
    return null
  }
}

/**
 * 등록자번호가 없어서 막힌 것으로 보이는지 판단한다.
 *
 * 등록자번호는 계정에 묶여 있고, 없으면 포털이 UCI 신청 화면 자체를 열어주지 않는다.
 * 그런데 그 상황은 '폼을 못 찾음'과 똑같아 보여서, 화면 문구로 구분해 준다.
 * 실제 안내 화면을 확인하면 selectors.json 의 apply.registrantRequiredMarker 로
 * 더 정확하게 잡을 수 있다.
 */
async function looksLikeRegistrantMissing (s, place) {
  const marker = s.apply?.registrantRequiredMarker
  if (marker) {
    const hit = await evaluate(`!!document.querySelector(${JSON.stringify(marker)})`).catch(() => false)
    if (hit) return true
  }
  const text = `${place?.heading || ''} ${place?.bodyHint || ''}`
  return /등록자번호/.test(text)
}

/**
 * 로그인이 필요한 화면으로 이동한다.
 *
 * 이 포털의 세션은 1시간이다. 여러 작품을 이어서 신청하거나 앱을 켜둔 채 한참 뒤에
 * 결과를 조회하면 그 사이에 세션이 끊긴다. 그러면 포털이 로그인 화면으로 돌려보내는데,
 * 그걸 알아채지 못하면 '폼을 찾지 못했습니다' 같은 엉뚱한 사유가 나가서
 * 선택자 설정을 의심하며 헛수고하게 된다.
 *
 * 로그인 정보를 저장해 둔 경우에는 조용히 한 번 다시 로그인하고 이어서 진행한다.
 */
async function navigateAuthed (url, s, t) {
  await navigate(url, t.pageLoad || 30000)
  if (!(await bouncedToLogin(s))) return { ok: true }

  const cred = store.getCredential()
  if (!cred?.loginId || !cred?.password) {
    session = null
    return { ok: false, error: '포털 세션이 만료되었습니다. 다시 로그인해 주세요.' }
  }

  const relogin = await login({ loginId: cred.loginId, password: cred.password })
  if (!relogin.ok) {
    session = null
    return { ok: false, error: `세션이 만료되어 재로그인을 시도했으나 실패했습니다: ${relogin.error}` }
  }

  // 재로그인 뒤 원래 가려던 화면으로 다시 이동한다. 여기서도 튕기면 더 시도하지 않는다.
  await navigate(url, t.pageLoad || 30000)
  if (await bouncedToLogin(s)) {
    session = null
    return { ok: false, error: '포털 세션을 유지하지 못했습니다. 다시 로그인해 주세요.' }
  }
  return { ok: true, reloggedIn: true }
}

/* ------------------------------------------------------------- 공개 API */

async function login ({ loginId, password }) {
  if (!isLoginConfigured()) {
    return {
      ok: false,
      error: '포털 연동 설정이 아직 준비되지 않았습니다. providers/selectors.json 의 configured 를 true 로 바꿔 주세요.'
    }
  }
  if (!loginId || !password) {
    return { ok: false, error: '아이디와 비밀번호를 모두 입력해 주세요.' }
  }

  const s = loadSelectors()
  const t = s.timeouts || {}
  const settings = store.getSettings()
  const url = s.login.url || `${settings.portalUrl.replace(/\/$/, '')}/login`

  try {
    step(`로그인 화면 여는 중: ${url}`)
    await navigate(url, t.pageLoad || 30000)
    step('로그인 화면 열림')

    if (!(await waitForSelector(s.login.idInput, t.element || 15000))) {
      return { ok: false, error: '로그인 화면의 아이디 입력칸을 찾지 못했습니다. 선택자를 확인해 주세요.' }
    }

    await fillField(s.login.idInput, loginId)
    await fillField(s.login.passwordInput, password)

    // 화면에 들어오면서 뜬 안내 알림을 로그인 결과로 오인하지 않도록 여기서 비운다.
    clearDialogs()
    await clickElement(s.login.submitButton)

    // 결과는 셋 중 하나로 온다 — 실패 알림창, 실패 문구, 그리고 로그인 완료.
    const deadline = Date.now() + (t.afterSubmit || 30000)
    while (Date.now() < deadline) {
      const dialogs = drainDialogs()
      if (dialogs.length) return { ok: false, error: `포털 로그인 실패: ${dialogs.join(' / ')}` }

      const err = await readText(s.login.errorText)
      if (err) return { ok: false, error: `포털 로그인 실패: ${err}` }

      if (await isLoggedIn(s)) {
        step('로그인 성공')
        session = {
          loginId,
          name: loginId,
          orgName: settings.orgName || '',
          orgCode: settings.orgCode || '',
          loginAt: new Date().toISOString()
        }
        return { ok: true, user: { ...session } }
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    return { ok: false, error: '로그인 결과를 확인하지 못했습니다. (응답 시간 초과)' }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

async function logout () {
  session = null
  destroyWindow()
  try {
    await electronSession.fromPartition(PARTITION).clearStorageData()
  } catch { /* 정리 실패는 무시한다 */ }
  return { ok: true }
}

function getSession () {
  return session ? { ...session } : null
}

/**
 * UCI 신청이 가능한 계정인지 확인한다.
 *
 * 등록자번호는 계정에 묶여 있고 신청 폼에 적는 칸도 없다. 그래서 사용자가 입력한 번호를
 * 검사하는 것은 아무 의미가 없다 — 진짜인지 알 방법이 없기 때문이다.
 * 대신 포털에 직접 물어본다: UCI 신청 화면이 열리면 자격이 있는 것이다.
 *
 * 등록자번호는 한 번 발급되면 바뀌지 않으므로 이 확인은 계정당 한 번이면 충분하다.
 * 호출 쪽에서 결과를 기억해 두고 두 번 부르지 않는다.
 *//** 자격 확인이 아무리 오래 걸려도 이 시간을 넘기지 않는다. 로그인이 멈춘 것처럼 보이지 않도록. */
const VERIFY_ACCESS_BUDGET = 60000

async function verifyAccess () {
  if (!isLoginConfigured()) {
    return { ok: false, error: '포털 연동 설정이 아직 준비되지 않았습니다.' }
  }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }

  // 먼저 끝난 쪽을 쓰되, 진 쪽의 타이머는 반드시 정리한다.
  // 안 그러면 이미 성공한 뒤에 '시간 초과' 로그가 뒤늦게 찍혀 사람을 헷갈리게 한다.
  let timer = null
  try {
    return await Promise.race([
      doVerifyAccess(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          step('자격 확인 전체 시간 초과 (60초)')
          resolve({
            ok: false,
            error: '신청 자격을 확인하는 데 시간이 너무 오래 걸립니다. 포털이 느리거나 점검 중일 수 있으니 잠시 후 다시 로그인해 주세요. ' +
              (constants.SHOW_ADVANCED_SETTINGS ? '설정에서 "포털 연동 중 브라우저 창 표시"를 켜고 다시 시도하면 어디서 멈추는지 볼 수 있습니다.' : '계속되면 문의처에 알려 주세요.')
          })
        }, VERIFY_ACCESS_BUDGET)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function doVerifyAccess () {
  const s = loadSelectors()
  const t = s.timeouts || {}

  try {
    step('신청 자격 확인 시작')
    const opened = await openApplyForm(s, t, 'webtoon')
    step(`신청 폼 열기 결과: ${opened.ok ? '성공' : '실패 — ' + opened.error}`)
    if (!opened.ok) return opened

    /*
     * 신청 화면이 열렸다고 끝이 아니다. 등록자번호가 없는 계정에도 화면은 열리고
     * 그 칸만 비어 있을 수 있다. 그래서 화면 문구로 짐작하지 않고 그 값을 직접 읽는다.
     * 읽어 온 값은 계정에서 내려온 진짜 값이므로 그대로 설정에 저장해 화면에 보여준다.
     */
    const account = await readAccountFields(s)
    step(`계정 정보 읽음: ${JSON.stringify(account)}`)

    if (!account.registrantNo) {
      return {
        ok: false,
        error: '이 계정에는 등록자번호가 없습니다. UCI 신청을 하려면 먼저 등록자번호를 발급받아야 합니다. ' +
          '(시·구청 출판사신고 → 신고확인증 → 등록자번호 신청) ' +
          '안내: https://www.nl.go.kr/seoji/contents/S90101000000.do',
        account
      }
    }

    step('자격 확인 완료 — 설정에 저장')
    store.setSettings({
      registrantNo: account.registrantNo,
      orgName: account.registrantName || store.getSettings().orgName,
      orgCode: account.productionCompanyCode || store.getSettings().orgCode
    })
    return { ok: true, account }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/**
 * 계정에서 내려온 값들을 신청 폼에서 읽어온다.
 *
 * 이 칸들은 readonly 라 사용자가 입력하는 값이 아니라 포털이 로그인 계정을 보고 채워 넣는 값이다.
 * 등록자번호가 여기 있으므로, 사용자가 설정에 적어 둔 문자열을 믿는 대신 이 값을 쓴다.
 */
async function readAccountFields (s) {
  const map = s.apply?.accountFields || {}
  const out = {}
  for (const [key, selector] of Object.entries(map)) {
    if (!selector) continue
    out[key] = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el ? (el.value || '').trim() : '';
    })()`).catch(() => '')
  }
  return out
}

/**
 * 작품 건별 신청 폼을 연다.
 *
 * 포털의 신청 주소는 곧바로 폼이 아니라 '건별 / 일괄 / 회차추가' 를 고르는 화면이다.
 * 거기서 '작품 건별 신청' 링크를 눌러야 폼이 나온다. 웹툰과 웹소설은 주소가 다르지만
 * 폼 안의 입력칸 이름은 완전히 같다.
 */
async function openApplyForm (s, t, contentType) {
  const cfg = s.apply?.[contentType === 'webnovel' ? 'webnovel' : 'webtoon']
  if (!cfg?.menuUrl) {
    return { ok: false, error: `${contentType} 신청 화면 주소가 설정되지 않았습니다.` }
  }

  /*
   * 두 번까지 시도한다. 포털 응답이 느릴 때 첫 시도가 빈손으로 끝나는 경우가 있는데,
   * 그때마다 '신청할 수 없는 계정' 으로 오해하게 만드는 것보다 한 번 더 해보는 편이 낫다.
   */
  const pageLoad = t.pageLoad || 30000
  const element = Math.max(t.element || 15000, 20000)

  /*
   * 폼에 들어가는 길이 두 가지 있는데 둘 다 가끔 실패한다.
   *   ① 폼 주소로 바로 이동
   *   ② 메뉴에서 '작품 건별 신청' 링크 클릭
   * 어느 쪽이 더 낫다고 할 만한 근거는 없었다. 실제로 번갈아 실패했다.
   *
   * 대신 확실한 것: 성공할 때는 1~2초면 뜬다. 그래서 첫 시도는 짧게 끊고(PROBE),
   * 안 되면 곧바로 다른 길로 넘어간다. 20초를 다 기다렸다가 넘어가면 그 시간이 통째로 낭비다.
   * 두 길 다 실패했을 때만 넉넉한 시간을 주고 한 번 더 돌린다.
   */
  const PROBE = 6000

  const tryFormUrl = async (wait) => {
    if (!cfg.formUrl) return false
    step(`폼 주소로 이동 (최대 ${wait / 1000}초 대기)`)
    const nav = await navigateAuthed(cfg.formUrl, s, t)
    if (!nav.ok) { step(`이동 실패: ${nav.error}`); return false }
    return waitForSelector(s.apply.formMarker, wait)
  }

  const tryMenuClick = async (wait) => {
    step(`신청 메뉴에서 클릭 (최대 ${wait / 1000}초 대기)`)
    const nav = await navigateAuthed(cfg.menuUrl, s, t)
    if (!nav.ok) { step(`메뉴 열기 실패: ${nav.error}`); return false }
    const r = await clickAndWaitForNavigation(s.apply.singleApplyLink, pageLoad)
    if (!r.clicked) { step("'작품 건별 신청' 링크를 못 찾음"); return false }
    return waitForSelector(s.apply.formMarker, wait)
  }

  /*
   * 메뉴에서 클릭하는 쪽을 먼저 쓴다.
   *
   * 지금까지 7번 돌린 기록으로는 클릭 경로가 4승 2패, 주소 직접 이동은 0승 1패였다.
   * 포털이 '메뉴를 거쳐 왔는지'를 서버에서 기억하는 것으로 보이며, 그렇다면 사람이 하는
   * 순서를 그대로 따르는 편이 맞다. 다만 표본이 적으니 다른 길도 반드시 남겨 둔다.
   */
  // 1라운드: 두 경로를 짧게 훑는다. 보통 여기서 끝난다.
  if (await tryMenuClick(PROBE)) { step('폼 확인 (클릭 경로)'); return { ok: true } }
  if (await tryFormUrl(PROBE)) { step('폼 확인 (주소 이동)'); return { ok: true } }

  // 2라운드: 포털이 느린 날일 수 있으니 넉넉히 기다려 본다.
  step('두 경로 모두 빠르게는 실패 — 시간을 늘려 다시 시도합니다')
  if (await tryMenuClick(element)) { step('폼 확인 (클릭 경로, 재시도)'); return { ok: true } }
  if (await tryFormUrl(element)) { step('폼 확인 (주소 이동, 재시도)'); return { ok: true } }

  // 못 찾았으면 그 순간 화면에 실제로 뭐가 있는지 남긴다. 이게 없으면 원인을 좁힐 수 없다.
  await dumpPageState()

  const place = await whereAmI()
  if (await looksLikeRegistrantMissing(s, place)) {
    return {
      ok: false,
      error: '등록자번호가 없어 UCI 신청 화면을 열 수 없습니다. ' +
        '등록자번호는 계정에 묶여 있으며 시·구청 출판사신고 → 신고확인증 → 등록자번호 신청 순서로 먼저 받아야 합니다. ' +
        '(안내: https://www.nl.go.kr/seoji/contents/S90101000000.do)'
    }
  }
  return {
    ok: false,
    error: `신청 폼을 열지 못했습니다. 지금 열린 화면: ${place?.heading || place?.title || '알 수 없음'} (${place?.url || ''})`
  }
}

/**
 * 폼을 못 찾았을 때 화면 상태를 통째로 찍는다.
 *
 * '선택자가 틀렸다' 와 '로그인이 풀려 다른 화면이다' 와 '아직 안 그려졌다' 는
 * 증상이 똑같아서, 실제 DOM 을 봐야 구분된다.
 */
async function dumpPageState () {
  const info = await evaluate(`(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0;
    const inputs = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')];
    return {
      주소: location.href,
      제목: document.title,
      화면폭: window.innerWidth,
      로그인화면인가: !!document.querySelector('#publishID'),
      전체입력칸: document.querySelectorAll('input,select,textarea').length,
      보이는입력칸: inputs.filter(vis).length,
      입력칸목록: inputs.slice(0, 20).map((e) => (e.id ? '#' + e.id : '') + (e.name ? '[' + e.name + ']' : '') + ':' + e.type),
      iframe: [...document.querySelectorAll('iframe')].map((f) => (f.id || '?') + ' src=' + (f.src || '(없음)').slice(0, 60) + ' 보임=' + vis(f)),
      큰제목: [...document.querySelectorAll('h2,h3')].map((h) => (h.innerText || '').trim()).filter(Boolean).slice(0, 6),
      본문앞: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 250)
    };
  })()`).catch((e) => ({ 덤프실패: e.message }))
  step('화면 상태 덤프: ' + JSON.stringify(info, null, 1))
}

async function exists (selector) {
  if (!selector) return false
  return evaluate(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false)
}

/** `input[name="genre"][value="{value}"]` 같은 틀에 값을 끼워 넣는다. */
function fillTemplate (template, value) {
  return String(template || '').replace('{value}', String(value).replace(/"/g, '\\"'))
}

/**
 * 작품 건별 신청.
 *
 * 포털은 신청 즉시 UCI를 주지 않는다. 접수만 되고 업무일 3일 심사를 거친다.
 * 접수번호라는 개념도 없어서, 나중에 결과를 조회할 때는 작품명으로 찾는다.
 *
 * 채우는 항목은 포털의 fn_save() 가 실제로 검사하는 것만이다. (폼 매핑 명세서)
 */
async function apply (meta) {
  if (!isConfigured()) {
    return { ok: false, error: 'UCI 신청 화면 설정이 비어 있습니다. selectors.json 의 apply 항목을 확인해 주세요.' }
  }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }

  const s = loadSelectors()
  const t = s.timeouts || {}
  const f = s.apply.fields || {}

  try {
    const opened = await openApplyForm(s, t, meta.contentType)
    if (!opened.ok) return opened

    // --- 작품 정보 ---
    await fillField(f.publishForm, meta.publishForm)
    await fillField(f.title, meta.title)

    /*
     * 작가는 역할과 이름을 짝으로 넣어야 한다. 한쪽만 채우면 포털이 거부한다.
     * 글 작가와 그림 작가가 다르면 포털의 「+」(fn_addAuthor)로 줄을 늘려 한 줄에 한 사람씩 넣는다.
     * 포털 서버는 줄 목록(authorList)을 받으므로, 쉼표로 이어 한 줄에 넣으면 두 사람이 한 역할로 묶인다. (2026-10-16 확인)
     */
    const authors = constants.authorsOf(meta)
    const rows = s.apply.authorRows || {}
    await fillField(f.writerRole, authors[0]?.role)
    await fillField(f.writer, authors[0]?.name)
    for (let i = 1; i < authors.length; i++) {
      const addFn = rows.addFunction || 'fn_addAuthor'
      const added = await evaluate(`(() => { if (typeof ${addFn} !== 'function') return false; ${addFn}(); return true })()`)
      if (!added) return { ok: false, error: '포털의 작가 추가 버튼을 찾지 못했습니다. selectors.json 의 apply.authorRows 를 확인해 주세요.' }
      await fillIndexed(rows.role || 'select[name="writerroleName"]', i, authors[i].role)
      await fillIndexed(rows.name || 'input[name="writer"]', i, authors[i].name)
    }

    // 연령등급. 포털이 2026-10-08 부터 필수로 검사한다 (2026-10-15 파트너 실증에서 거부돼 확인).
    // 선택지 value(AL·12+·15+·18+)는 저장값과 같다. 포털이 value 를 바꿔도 화면 글자로 한 번 더 찾는다.
    if (meta.ageGrade) {
      const grade = constants.AGE_GRADES.find((g) => g.value === meta.ageGrade)
      const picked = await fillSelect(f.ageGrade, grade ? [grade.value, grade.portal, grade.label] : [meta.ageGrade])
      if (!picked) {
        return { ok: false, error: `연령등급 '${grade ? grade.label : meta.ageGrade}' 을(를) 포털 선택지에서 찾지 못했습니다. selectors.json 의 ageGrade 와 포털 화면을 확인해 주세요.` }
      }
    }

    // 연재처는 입력칸이 readonly 라 사람이 타이핑할 수 없고 팝업에서 고르게 되어 있다.
    // 프로그램은 표시용 이름과 실제 코드를 함께 넣어 팝업 없이 처리한다.
    await fillField(f.syndicateName, meta.syndicateName)
    await fillField(f.syndicateCode, meta.syndicateCode)
    await fillField(f.syndicateUrl, meta.url)

    await fillField(f.priceKind, meta.priceKind)
    await fillField(f.price, meta.price)
    await fillField(f.currency, meta.currency)
    // '직접입력' 을 고르면 포털이 숨겨 둔 칸을 내어 준다. 거기에 실제 단위를 적는다.
    if (meta.currency === '직접입력') await fillField(f.currencyEtc, meta.currencyEtc)

    await fillField(f.episodeStart, meta.episodeStart)
    await fillField(f.episodeEnd, meta.episodeEnd)

    // --- 담당자 정보 (설정에 저장해 둔 값) ---
    await fillField(f.managerName, meta.managerName)
    await fillField(f.managerEmail, meta.managerEmail)
    await fillField(f.managerMobile, meta.managerMobile)

    // --- 선택·체크 항목 ---
    await clickElement(fillTemplate(s.apply.serialStatusRadio, meta.serialStatus))
    await clickElement(fillTemplate(s.apply.receiveMethodRadio, meta.receiveMethod || 'handphone'))

    for (const genre of (meta.genres || [])) {
      await setChecked(fillTemplate(s.apply.genreCheckbox, genre), true)
    }

    await setChecked(s.apply.rightsAgreeCheckbox, true)
    await setChecked(s.apply.privacyAgreeCheckbox, true)

    // 제출 직전에 큐를 비운다. 화면에 들어오며 뜬 안내 알림을 결과로 오인하지 않기 위해서다.
    clearDialogs()
    if (!(await clickElement(s.apply.submitButton))) {
      return { ok: false, error: '신청 버튼을 찾지 못했습니다. selectors.json 의 submitButton 을 확인해 주세요.' }
    }

    /*
     * 포털은 "신청하시겠습니까?" 확인창을 띄운 뒤 결과를 alert 로 알린다.
     * 확인창은 preload 가 자동 승인하고, 우리는 alert 문구만 본다.
     */
    const deadline = Date.now() + (t.afterSubmit || 30000)
    let forcedNew = false
    while (Date.now() < deadline) {
      for (const message of drainDialogs()) {
        if (/오류|실패|입력하세요|선택하세요|체크|중복|바른 날짜|확인해/.test(message)) {
          return { ok: false, error: `신청 실패: ${message}` }
        }
        if (/완료|접수|신청되었|저장되었/.test(message)) {
          return { ok: true, appliedAt: new Date().toISOString(), status: 'pending', notice: message }
        }
      }

      /*
       * 같은 작품명이 이미 있으면 포털은 접수하지 않고 중복 확인 창을 연다 (2026-10-15 포털 코드에서 확인).
       * 그 창에는 「선택회차추가」(기존 작품에 회차 추가)와 「신규작품등록」(같은 이름의 새 작품으로 접수) 두 갈래가 있다.
       * 사용자가 화면에서 '새 작품으로 등록' 을 고른 경우(forceNew)에만 포털의 신규작품등록 버튼과 같은 동작을 한다 —
       * 새 작품 표식(newType=new)을 세우고 같은 폼을 접수 주소로 보낸다. 고르지 않았으면 멈추고 화면에 선택을 넘긴다.
       */
      const dup = takePopups().find((p) => isDuplicatePopup(p, s.apply.duplicatePopupMarker, 'popup'))
      if (dup) {
        if (meta.forceNew && !forcedNew) {
          forcedNew = true
          const submitUrl = s.apply[meta.contentType === 'webnovel' ? 'webnovel' : 'webtoon']?.newWorkSubmitUrl || ''
          const sent = await evaluate(`(() => {
            const frm = document.workCodeApplyForm || document.querySelector('#workCodeApplyForm');
            if (!frm) return false;
            const nt = frm.querySelector('input[name="newType"]');
            if (nt) nt.value = 'new';
            const url = ${JSON.stringify(submitUrl)};
            if (url) frm.action = url;
            frm.submit();
            return true;
          })()`)
          if (!sent) return { ok: false, error: '새 작품으로 등록하려 했으나 포털의 신청 폼을 찾지 못했습니다.' }
          step('포털 중복 확인 → 새 작품으로 등록 진행')
          continue
        }
        return {
          ok: false,
          duplicate: true,
          error: `포털에 같은 작품명 「${meta.title}」이(가) 이미 등록되어 있어 접수하지 않았습니다.`
        }
      }

      const err = await readText(s.apply.errorText)
      if (err) return { ok: false, error: `신청 실패: ${err}` }

      // 신청이 끝나면 폼을 벗어난다. 알림 문구가 없어도 이걸로 접수를 확인한다.
      if (!(await exists(s.apply.formMarker))) {
        return { ok: true, appliedAt: new Date().toISOString(), status: 'pending' }
      }
      await new Promise((r) => setTimeout(r, 300))
    }

    const leftover = drainDialogs()
    return {
      ok: false,
      error: leftover.length
        ? `신청 결과를 확인하지 못했습니다. 포털 안내: ${leftover.join(' / ')}`
        : '신청 결과를 확인하지 못했습니다. (응답 시간 초과) 포털에서 실제 접수 여부를 확인해 주세요.'
    }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/**
 * 파일 첨부칸에 파일을 넣는다.
 *
 * `<input type="file">` 은 보안상 스크립트로 값을 넣을 수 없다. 브라우저가 막는다.
 * 그래서 크롬 개발자도구가 쓰는 통로(CDP)로 브라우저에게 직접 시킨다.
 * 사람이 파일 선택창에서 고른 것과 똑같은 상태가 된다.
 */
async function attachFile (selector, filePath) {
  const w = await ensureWindow()
  const dbg = w.webContents.debugger

  let attachedHere = false
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true }

    const { root } = await dbg.sendCommand('DOM.getDocument')
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) return false

    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [filePath] })

    // 포털 스크립트가 change 를 보고 동작하는 경우가 있어 사람이 고른 것과 같게 맞춘다.
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    return true
  } catch (e) {
    step(`파일 첨부 실패: ${e.message}`)
    return false
  } finally {
    if (attachedHere) { try { dbg.detach() } catch { /* 이미 끊겼으면 무시 */ } }
  }
}

/**
 * 여러 작품 일괄 신청.
 *
 * 포털은 2건 이상을 화면에 하나씩 넣게 하지 않고 엑셀 파일 업로드를 요구한다.
 * 흐름은 이렇다.
 *
 *   공식 양식으로 .xls 생성 → 일괄신청 팝업 열기 → 파일 첨부
 *   → 담당자 정보 입력 (파일 밖에서 한 번만) → 동의 체크 → 신청
 *
 * 작품 정보는 전부 파일 안에 있으므로 여기서는 화면 입력이 몇 개 없다.
 */
async function applyBulk (items) {
  if (!isConfigured()) {
    return { ok: false, error: 'UCI 신청 화면 설정이 비어 있습니다. selectors.json 을 확인해 주세요.' }
  }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: '신청할 작품이 없습니다.' }
  }

  const s = loadSelectors()
  const cfg = s.bulk || {}
  if (!cfg.formMarker || !cfg.submitButton) {
    return { ok: false, error: '일괄 신청 화면 설정이 비어 있습니다. selectors.json 의 bulk 항목을 확인해 주세요.' }
  }

  const contentType = items[0].contentType === 'webnovel' ? 'webnovel' : 'webtoon'
  if (new Set(items.map((i) => i.contentType || 'webtoon')).size > 1) {
    return { ok: false, error: '웹툰과 웹소설은 양식이 달라 한 번에 신청할 수 없습니다.' }
  }

  const popupUrl = cfg[contentType]?.popupUrl
  if (!popupUrl) return { ok: false, error: `일괄 신청 주소가 없습니다. (${contentType})` }

  const t = s.timeouts || {}
  const head = items[0]
  let filePath = null

  try {
    // 1) 공식 양식에 데이터를 채워 파일을 만든다.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uci-bulk-'))
    filePath = path.join(dir, `UCI일괄신청_${contentType === 'webnovel' ? '웹소설' : '웹툰'}.xls`)
    writeBulkFile(items, filePath)
    step(`엑셀 생성: ${items.length}건 → ${filePath}`)

    // 2) 일괄신청 팝업을 연다. 세션이 끊겼으면 다시 로그인하고 돌아온다.
    step(`일괄신청 화면 여는 중: ${popupUrl}`)
    const moved = await navigateAuthed(popupUrl, s, t)
    if (!moved.ok) return moved

    if (!(await waitForSelector(cfg.formMarker, t.element || 15000))) {
      return { ok: false, error: '일괄 신청 화면을 열지 못했습니다. 포털 구조가 바뀌었을 수 있습니다.' }
    }

    // 3) 파일 첨부
    if (!(await attachFile(cfg.fileInput || cfg.formMarker, filePath))) {
      return { ok: false, error: '엑셀 파일을 첨부하지 못했습니다.' }
    }
    step('엑셀 첨부 완료')

    // 4) 담당자 정보 — 파일이 아니라 이 화면에서 한 번만 받는다.
    const f = cfg.fields || {}
    await fillField(f.managerName, head.managerName)
    await fillField(f.managerEmail, head.managerEmail)
    await fillField(f.managerMobile, head.managerMobile)

    if (cfg.receiveMethodRadio) {
      await clickElement(fillTemplate(cfg.receiveMethodRadio, head.receiveMethod || 'handphone'))
    }
    if (cfg.rightsAgreeCheckbox) await setChecked(cfg.rightsAgreeCheckbox, true)

    // 5) 신청. 제출 직전에 큐를 비워 화면 안내를 결과로 오인하지 않게 한다.
    clearDialogs()
    if (!(await clickElement(cfg.submitButton))) {
      return { ok: false, error: '신청 버튼을 찾지 못했습니다. selectors.json 의 bulk.submitButton 을 확인해 주세요.' }
    }

    /*
     * 결과는 alert 로 온다. 확인창("신청 하시겠습니까?")은 preload 가 자동 승인한다.
     * 업로드와 서버 처리가 걸리므로 건별보다 넉넉히 기다린다.
     */
    const deadline = Date.now() + (t.bulkSubmit || 90000)
    const seen = []   // 제출 뒤에 뜬 안내 전부. 실패 사유를 하나도 흘리지 않기 위해 모아 둔다.
    let forcedNew = false

    /*
     * 파일 안에 포털에 이미 있는 작품명이 있으면 포털은 접수하지 않고 중복 확인 창(popup2)을 연다.
     * 그 창의 「신규작품등록」은 업로드 함수를 한 번 더 부르는 것이라(포털이 재시도 표식을 세워 둔다),
     * 사용자가 '새 작품으로 등록' 을 골랐을 때만 같은 동작을 한다. 아니면 어느 작품명인지 알려 주고 멈춘다.
     * @returns 계속 기다려야 하면 null, 끝내야 하면 결과 객체
     */
    const onDuplicate = async () => {
      const name = await evaluate(`(() => { const f = document.popForm; return f && f.workName ? String(f.workName.value || '') : '' })()`).catch(() => '')
      if (head.forceNew && !forcedNew) {
        forcedNew = true
        const again = await evaluate(`(() => { if (typeof fn_apply_proc !== 'function') return false; fn_apply_proc(); return true })()`)
        if (!again) return { ok: false, error: '새 작품으로 등록하려 했으나 포털의 업로드 함수를 찾지 못했습니다.' }
        step('포털 중복 확인 → 새 작품으로 등록 진행')
        return null
      }
      return {
        ok: false,
        duplicate: true,
        workName: name,
        error: `포털에 같은 작품명${name ? ` 「${name}」` : ''}이(가) 이미 등록되어 있어 접수하지 않았습니다.`
      }
    }
    const dupNow = () => takePopups().find((p) => isDuplicatePopup(p, cfg.duplicatePopupMarker, 'popup2'))

    while (Date.now() < deadline) {
      for (const message of drainDialogs()) {
        seen.push(message)
        if (/오류|실패|입력하세요|선택하세요|체크|중복|양식|확인해|첨부/.test(message)) {
          /*
           * 포털은 반려할 때 alert 를 두 번 띄운다 — 먼저 서버의 resultMsg, 그다음 "일괄등록 양식을
           * 다시 한번 확인하여 주시기 바랍니다" 같은 일반 문구. 구체적 사유는 앞쪽에 있을 때가 많으므로
           * 잠깐 더 기다려 뒤따르는 안내까지 받은 뒤 전부 비고에 남긴다. (2026-10-15 파트너 실증 뒤 보강)
           */
          await new Promise((r) => setTimeout(r, 1200))
          seen.push(...drainDialogs())
          // 중복 응답은 resultMsg 알림 뒤에 창을 열므로, 실패로 적기 전에 중복 창 요청이 있었는지 본다.
          if (dupNow()) {
            const r = await onDuplicate()
            if (r) return r
            break
          }
          const unique = [...new Set(seen.map((m) => String(m).trim()).filter(Boolean))]
          return { ok: false, error: `일괄 신청 실패: ${unique.join(' / ')}` }
        }
        if (/완료|접수|신청되었|저장되었|등록되었/.test(message)) {
          return {
            ok: true,
            appliedAt: new Date().toISOString(),
            status: 'pending',
            count: items.length,
            notice: message
          }
        }
      }
      if (dupNow()) {
        const r = await onDuplicate()
        if (r) return r
      }
      await new Promise((r) => setTimeout(r, 400))
    }

    const leftover = drainDialogs()
    return {
      ok: false,
      error: leftover.length
        ? `신청 결과를 확인하지 못했습니다. 포털 안내: ${leftover.join(' / ')}`
        : '신청 결과를 확인하지 못했습니다. (응답 시간 초과) 포털에서 실제 접수 여부를 확인해 주세요.'
    }
  } catch (e) {
    return { ok: false, error: `일괄 신청 오류: ${e.message}` }
  } finally {
    // 임시 파일은 남기지 않는다. 담당자 정보가 들어 있진 않지만 작품 목록이 그대로 있다.
    if (filePath) {
      try { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }) } catch { /* 무시 */ }
    }
  }
}

/**
 * 신청 현황 조회.
 *
 * 이 포털에는 접수번호가 없다. 조회 화면의 검색 분류에 '작품명' 이 있으므로 그걸로 찾는다.
 * 같은 작품명이 여러 건이면 가장 최근 것을 본다.
 */
async function checkStatus (record) {
  const s = loadSelectors()
  const cfg = s.status || {}
  if (!cfg.url || !cfg.resultRows) {
    return { ok: false, error: '신청 현황 조회 화면 설정이 비어 있습니다.' }
  }
  if (!record.title) {
    return { ok: false, error: '작품명이 없어 현황을 조회할 수 없습니다.' }
  }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }

  const t = s.timeouts || {}
  const col = cfg.columns || {}

  try {
    const nav = await navigateAuthed(cfg.url, s, t)
    if (!nav.ok) return nav

    clearDialogs()
    const searched = await searchStatus(cfg, t, { statuses: null, query: record.title })
    if (!searched.ok) return searched

    const { items } = await readStatusRows(cfg)
    if (!items.length) {
      return { ok: false, error: `'${record.title}' 의 신청 내역이 조회되지 않습니다.` }
    }
    // 포털 키가 있으면 그 줄이 정확한 짝이다. 없으면 작품명·신청일로 고른다 (같은 이름이 여럿일 때).
    const it = (record.portalKey && items.find((i) => i.portalKey === record.portalKey)) || pickStatusItem(items, record)
    const row = { [col.status]: it.portalStatus, [col.uci]: it.uci, [col.issuedAt]: it.issuedAt }

    const statusText = row[col.status] || ''
    const uci = (row[col.uci] || '').trim()
    const mapped = constants.mapPortalStatus(statusText)
    const { status: portalStatus, note: portalNote } = constants.splitPortalStatus(statusText)

    if (mapped === 'issued') {
      return {
        ok: true,
        status: 'issued',
        uci,
        issuedAt: row[col.issuedAt] || new Date().toISOString(),
        portalKey: it.portalKey || record.portalKey || '',
        portalStatus, portalNote,
        checkedAt: new Date().toISOString()
      }
    }
    const portalKey = it.portalKey || record.portalKey || ''
    if (mapped === 'rejected') {
      // 사유는 적지 않는다 — 상태 글자(처리불가·삭제)가 그대로 보이고, 처리내용은 상세 화면에서 읽어 툴팁으로 보인다.
      return { ok: true, status: 'rejected', portalStatus, portalNote, portalKey, checkedAt: new Date().toISOString() }
    }
    if (mapped === 'needsFix') {
      return { ok: true, status: 'needsFix', reason: '포털에서 보완요청 상태입니다. 포털에 접속해 요청 내용을 확인해 주세요.', portalStatus, portalNote, portalKey, checkedAt: new Date().toISOString() }
    }
    return { ok: true, status: 'pending', portalStatus, portalNote, portalKey, checkedAt: new Date().toISOString() }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/** 현황 표 한 줄을 이력에 넣을 모양으로 바꾼다. 열 번호는 selectors.json status.columns. */
function parseStatusRow (cells, col) {
  if (!Array.isArray(cells) || cells.length <= 1) return null
  const at = (k) => (col[k] != null ? String(cells[col[k]] || '').trim() : '')
  const title = at('title')
  if (!title) return null
  const type = at('type')
  return {
    contentType: /웹소설/.test(type) ? 'webnovel' : 'webtoon',
    publishForm: at('publishForm'),
    title,
    uci: at('uci'),
    appliedAt: parsePortalDate(at('appliedAt')),
    lastAppliedAt: parsePortalDate(at('lastAppliedAt')),
    issuedAt: parsePortalDate(at('issuedAt')),
    // 신청상태 칸의 「처리불가 (사유)」 는 상태와 사유로 나눈다. 사유는 여기에만 있다 (상세 화면의 처리내용은 비어 있음).
    ...(({ status, note }) => ({ portalStatus: status, portalNote: note }))(constants.splitPortalStatus(at('status')))
  }
}

/* ------------------------------------------------------ 현황 조회 (쪽 단위) */

/** 현황 화면이 떠 있는 상태에서 보이는 쪽의 줄들과 「총 N건」을 읽는다. 줄마다 포털 키(recKey)를 같이 뽑는다. */
async function readStatusRows (cfg) {
  const col = cfg.columns || {}
  const read = await evaluate(`(() => {
    const rows = [...document.querySelectorAll(${JSON.stringify(cfg.resultRows)})].map((tr) => {
      const link = tr.querySelector(${JSON.stringify(cfg.rowLink || 'a[onclick]')});
      return { cells: [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').replace(/\\s+/g, ' ').trim()),
               onclick: link ? (link.getAttribute('onclick') || '') : '' };
    });
    // 템플릿 문자열 안이라 백슬래시를 두 번 써야 페이지에서 \\s·\\d 로 살아남는다.
    const m = document.body.innerText.match(/총\\s*([\\d,]+)\\s*건/);
    return { rows, total: m ? Number(m[1].replace(/,/g, '')) : null };
  })()`)
  const keyRe = cfg.rowKeyPattern ? new RegExp(cfg.rowKeyPattern) : null
  const items = []
  for (const row of read.rows || []) {
    const it = parseStatusRow(row.cells, col)
    if (!it) continue
    const km = keyRe && row.onclick ? row.onclick.match(keyRe) : null
    it.portalKey = km ? km[1] : ''
    items.push(it)
  }
  return { items, total: read.total }
}

/**
 * 현황 화면 오른쪽 아래의 건수(boardFilter > countArea > pointC-R)를 읽는다. 그 요소가 없으면 「총 N건」 문구로 읽는다.
 * 결과가 없으면 포털은 숫자 없이 「총 건」으로 보여 주므로 0 으로 본다.
 */
async function readStatusCount (cfg) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(cfg.countText || '.boardFilter .countArea .pointC-R')});
    const fromEl = el ? String(el.innerText || '').replace(/[^\\d]/g, '') : '';
    if (fromEl) return Number(fromEl);
    const m = document.body.innerText.match(/총\\s*([\\d,]+)\\s*건/);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
  })()`)
}

/** 현황 화면에서 상태 필터·검색어를 적용해 검색한다. 체크박스는 검색 폼 안에 있어 체크한 상태만 조회된다. */
async function searchStatus (cfg, t, { statuses, query }) {
  if (Array.isArray(statuses) && statuses.length && cfg.statusCheckboxes) {
    await evaluate(`(() => {
      const want = ${JSON.stringify(statuses)};
      document.querySelectorAll(${JSON.stringify(cfg.statusCheckboxes)}).forEach((el) => { el.checked = want.includes(el.value); });
      return true;
    })()`)
  }
  // 검색 분류의 option 은 value(WOR)와 화면 글자(작품명)가 다르다. 둘 다 시도한다.
  await fillSelect(cfg.searchFieldSelect, [cfg.searchFieldValue || 'WOR', '작품명'])
  await fillField(cfg.searchInput, query || '')
  const r = await clickAndWaitForNavigation(cfg.searchButton, t.pageLoad || 30000)
  if (!r.clicked) return { ok: false, error: '현황 조회의 검색 버튼을 찾지 못했습니다.' }
  await waitForSelector(cfg.resultRows, t.element || 15000)
  return { ok: true }
}

/**
 * 이 계정의 UCI 신청 현황을 한 쪽 읽는다.
 *
 * 예전에는 로그인할 때 전체를 끝까지 읽었다. 신청이 500건 넘는 계정은 쪽 50개를 넘겨야 해서 로그인이 1~2분 걸렸다
 * (2026-10-21 감리 리뷰). 이제 화면이 필요한 쪽만 그때그때 읽는다. 현황 화면은 처음 열면 전체 목록의 첫 쪽을
 * 보여 주고, 쪽 넘김 fn_egov_link_page(n) 은 검색 폼을 다시 보내므로 상태 필터·검색어가 유지된다.
 *
 * @param page      쪽 번호 (1부터)
 * @param statuses  포털 상태 글자 목록 (예: ['접수','재접수']). 없으면 전부.
 * @param query     작품명 검색어
 */
async function listApplications ({ page = 1, statuses = null, query = '' } = {}) {
  const s = loadSelectors()
  const cfg = s.status || {}
  if (!cfg.url || !cfg.resultRows) return { ok: false, error: '신청 현황 조회 화면 설정이 비어 있습니다.' }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  const t = s.timeouts || {}
  const pageSize = Number(cfg.pageSize) || 10
  const pageFn = cfg.pageFunction || 'fn_egov_link_page'

  try {
    /*
     * 같은 검색(상태·검색어)의 다음 쪽이면 화면을 다시 열고 검색을 다시 하지 않고 쪽만 넘긴다.
     * 불러오기는 1쪽부터 끝 쪽까지 차례로 부르는데, 쪽마다 화면 열기 + 검색 + 쪽 넘김을 다 하면 포털 왕복이 세 번이다.
     * 쪽 넘김 함수는 검색 폼을 다시 보내므로 상태 필터·검색어가 유지된다. 세션이 끊겨 로그인 화면으로 튕기면 처음부터 다시 한다.
     */
    const L = lane()
    const key = JSON.stringify({ statuses: Array.isArray(statuses) ? statuses : null, query: query || '' })
    const sameSearch = L.statusSearch === key && Number(page) > 1
    const open = async () => {
      L.statusSearch = null
      const nav = await navigateAuthed(cfg.url, s, t)
      if (!nav.ok) return nav
      await waitForSelector(cfg.resultRows, t.element || 15000)
      if ((Array.isArray(statuses) && statuses.length) || query) {
        const r = await searchStatus(cfg, t, { statuses, query })
        if (!r.ok) return r
      }
      L.statusSearch = key
      return { ok: true }
    }
    const jump = async () => {
      const moved = await evaluateAndWaitForLoad(`(() => { if (typeof ${pageFn} !== 'function') return false; ${pageFn}(${Number(page)}); return true })()`, t.pageLoad || 30000)
      if (!moved) return { ok: false, error: `현황 ${page}쪽으로 넘어가지 못했습니다.` }
      if (await bouncedToLogin(s)) return { ok: false, bounced: true }
      await waitForSelector(cfg.resultRows, t.element || 15000)
      return { ok: true }
    }
    if (!sameSearch) {
      const o = await open()
      if (!o.ok) return o
    }
    if (Number(page) > 1) {
      let j = await jump()
      if (!j.ok && j.bounced) {   // 세션이 끊겼다. 화면을 다시 열고(재로그인 포함) 한 번 더.
        const o = await open()
        if (!o.ok) return o
        j = await jump()
      }
      if (!j.ok) { L.statusSearch = null; return { ok: false, error: j.error || '포털 세션이 만료되었습니다. 다시 로그인해 주세요.' } }
    }
    const { items, total } = await readStatusRows(cfg)
    const n = total ?? items.length
    step(`현황 ${page}쪽: ${items.length}건 (총 ${n}건${statuses ? ', 상태 ' + statuses.join('·') : ''}${query ? ', 검색 ' + query : ''})`)
    return { ok: true, items, total: n, page: Number(page), pageSize, pages: Math.max(1, Math.ceil(n / pageSize)) }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/**
 * 상태 묶음별 건수. 현황 화면에서 그 상태들만 체크해 검색한 뒤 오른쪽 아래 건수를 읽는다.
 * 로그인 직후 대시보드 숫자를 목록 전체를 읽기 전에 먼저 채우는 데 쓰고, 다 읽은 뒤 맞는지 대조하는 데도 쓴다.
 *
 * @param statuses 포털 상태 글자 목록 (예: ['접수','재접수','회차추가'])
 */
async function countApplications ({ statuses } = {}) {
  const s = loadSelectors()
  const cfg = s.status || {}
  if (!cfg.url || !cfg.resultRows) return { ok: false, error: '신청 현황 조회 화면 설정이 비어 있습니다.' }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  if (!Array.isArray(statuses) || !statuses.length) return { ok: false, error: '건수를 셀 상태가 없습니다.' }
  const t = s.timeouts || {}
  try {
    lane().statusSearch = null
    const nav = await navigateAuthed(cfg.url, s, t)
    if (!nav.ok) return nav
    await waitForSelector(cfg.resultRows, t.element || 15000)
    const r = await searchStatus(cfg, t, { statuses, query: '' })
    if (!r.ok) return r
    const total = await readStatusCount(cfg)
    step(`건수 ${statuses.join('·')}: ${total}건`)
    return { ok: true, total: Number(total) || 0 }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/**
 * 신청 한 건의 상세를 읽는다.
 *
 * 현황 목록에는 작품명·상태·UCI·날짜뿐이지만, 줄의 키로 여는 상세 화면에는 신청 폼의 모든 값이 채워져 있다
 * (2026-10-21 확인). 다른 PC 에서 로그인했을 때 비어 있던 작가·장르·연재처·가격을 여기서 채운다.
 * 포털 스크립트는 접수·보완요청·처리불가 상태에서만 상세로 보내지만, 폼을 직접 보내면 완료·삭제 건도 열린다.
 */
/**
 * 상세 화면 문서에서 값을 읽는 코드 (브라우저 쪽). 눈앞의 document 든 DOMParser 로 만든 문서든 같은 코드로 읽는다.
 * 선택자는 selectors.json status.detail.
 */
function detailReaderJs (d) {
  return `((doc) => {
      const F = ${JSON.stringify(d.fields || {})};
      const val = (sel) => { const el = doc.querySelector(sel); return el ? String(el.value || '').trim() : ''; };
      const out = {};
      for (const [k, sel] of Object.entries(F)) out[k] = val(sel);
      const roles = [...doc.querySelectorAll(${JSON.stringify(d.authorRole || 'select[name="writerroleName"]')})].map((e) => String(e.value || '').trim());
      const names = [...doc.querySelectorAll(${JSON.stringify(d.authorName || 'input[name="writer"]')})].map((e) => String(e.value || '').trim());
      out.authors = names.map((name, i) => ({ role: roles[i] || '', name })).filter((a) => a.name);
      out.genres = [...doc.querySelectorAll(${JSON.stringify(d.genreChecked || 'input[name="genre"]:checked')})].map((e) => e.value);
      const ss = doc.querySelector(${JSON.stringify(d.serialStatusChecked || 'input[name="serialStatus"]:checked')});
      out.serialStatus = ss ? ss.value : '';
      /*
       * 머리 정보(신청일·완료일·처리상태·작품코드·처리내용). 같은 .tit/.txt 짜임이 폼 항목과 검색창에도 쓰여서
       * 입력칸이 든 줄은 라벨과 선택지 글자만 잡힌다 (2026-10-21 실제 화면 확인) — 그런 줄은 뺀다.
       * 단 처리내용·사유처럼 보이는 줄은 textarea 에 들어 있어도 그 값을 읽는다.
       */
      const text = (el) => String(el.textContent || '').replace(/\\s+/g, ' ').trim();
      const info = {};
      doc.querySelectorAll(${JSON.stringify(d.infoRows || '.board-write li')}).forEach((li) => {
        const k = li.querySelector(${JSON.stringify(d.infoLabel || '.tit')}); const v = li.querySelector(${JSON.stringify(d.infoValue || '.txt')});
        if (!k || !v) return;
        const key = text(k);
        if (!v.querySelector('input, select, textarea, button')) { info[key] = text(v); return; }
        if (/처리내용|사유|반려|보완|의견/.test(key)) {
          const box = v.querySelector('textarea, input[type="text"]');
          info[key] = String((box && box.value) || '').replace(/\\s+/g, ' ').trim();
        }
      });
      out.info = info;
      return out;
    })`
}

async function getApplicationDetail ({ portalKey } = {}) {
  const s = loadSelectors()
  const cfg = s.status || {}
  const d = cfg.detail || {}
  if (!cfg.url || !d.url || !d.formMarker) return { ok: false, error: '신청 상세 화면 설정이 비어 있습니다.' }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  if (!portalKey) return { ok: false, error: '포털 신청 키가 없어 상세를 읽을 수 없습니다.' }
  const t = s.timeouts || {}

  try {
    // 현황 화면을 먼저 연다 — 세션 확인과 같은 출처(origin)에서 폼을 보내기 위해서다.
    const nav = await navigateAuthed(cfg.url, s, t)
    if (!nav.ok) return nav
    const moved = await evaluateAndWaitForLoad(`(() => {
      const f = document.createElement('form'); f.method = ${JSON.stringify(d.method || 'post')}; f.action = ${JSON.stringify(d.url)};
      const i = document.createElement('input'); i.type = 'hidden'; i.name = ${JSON.stringify(d.keyField || 'recKey')}; i.value = ${JSON.stringify(String(portalKey))};
      f.appendChild(i); document.body.appendChild(f); f.submit(); return true;
    })()`, t.pageLoad || 30000)
    if (!moved) return { ok: false, error: '신청 상세 화면을 열지 못했습니다.' }
    if (!(await waitForSelector(d.formMarker, t.element || 15000))) {
      return { ok: false, error: '신청 상세 화면의 입력칸을 찾지 못했습니다. 포털 구조가 바뀌었을 수 있습니다.' }
    }
    const detail = await evaluate(`(${detailReaderJs(d)})(document)`)
    step(`상세 읽음: ${detail.title || '?'} (${portalKey})`)
    return { ok: true, detail }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/**
 * 여러 건의 상세를 읽는다 — 로그인 직후 불러오기가 쓴다.
 *
 * 한 건마다 화면을 옮기면 상세 하나에 포털 왕복이 두 번이다. 여기서는 현황 화면을 한 번 연 뒤 그 안에서 fetch 로
 * 상세 HTML 을 받아 DOMParser 로 읽는다 — 왕복 한 번이고, 몇 건(concurrency, 기본 3)을 동시에 보낸다.
 * 가짜 포털(file://)은 fetch 를 못 쓰므로 한 건씩 화면을 옮기는 길로 간다 (시험용).
 * 결과는 키마다 { ok, detail } 또는 { ok: false, error } — 한 건이 실패해도 나머지는 돌려준다.
 */
async function getApplicationDetails ({ portalKeys, onProgress } = {}) {
  const s = loadSelectors()
  const cfg = s.status || {}
  const d = cfg.detail || {}
  if (!cfg.url || !d.url || !d.formMarker) return { ok: false, error: '신청 상세 화면 설정이 비어 있습니다.' }
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  const keys = [...new Set((Array.isArray(portalKeys) ? portalKeys : []).map((k) => String(k || '')).filter(Boolean))]
  const results = {}
  if (!keys.length) return { ok: true, results }
  const t = s.timeouts || {}
  const notify = (done, title) => { if (typeof onProgress === 'function') onProgress({ done, total: keys.length, title: title || '' }) }

  try {
    const nav = await navigateAuthed(cfg.url, s, t)
    if (!nav.ok) return nav
    const canFetch = !/^file:/i.test(d.url) && String(d.method || 'post').toLowerCase() === 'post'
    if (!canFetch) {
      for (let i = 0; i < keys.length; i++) {
        results[keys[i]] = await getApplicationDetail({ portalKey: keys[i] })
        notify(i + 1, results[keys[i]].detail?.title)
      }
      return { ok: true, results }
    }
    const at = Number(d.concurrency) > 0 ? Number(d.concurrency) : 3
    for (let i = 0; i < keys.length; i += at) {
      const part = keys.slice(i, i + at)
      const got = await evaluate(`(async () => {
        const read = ${detailReaderJs(d)};
        const out = {};
        await Promise.all(${JSON.stringify(part)}.map(async (key) => {
          try {
            const body = new URLSearchParams(); body.set(${JSON.stringify(d.keyField || 'recKey')}, key);
            const r = await fetch(${JSON.stringify(d.url)}, { method: 'POST', body, credentials: 'same-origin' });
            const html = await r.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            if (!doc.querySelector(${JSON.stringify(d.formMarker)})) {
              out[key] = { ok: false, error: !r.ok ? ('포털 응답 ' + r.status) : '상세 화면의 입력칸을 찾지 못했습니다 (세션이 끊겼거나 화면이 바뀜).' };
              return;
            }
            out[key] = { ok: true, detail: read(doc) };
          } catch (e) { out[key] = { ok: false, error: String((e && e.message) || e) }; }
        }));
        return out;
      })()`, Math.max(60000, Number(t.pageLoad) || 0))
      Object.assign(results, got || {})
      const last = got && got[part[part.length - 1]]
      const done = Math.min(i + at, keys.length)
      notify(done, last && last.detail && last.detail.title)
      step(`상세 ${done}/${keys.length}`)
    }
    return { ok: true, results }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/**
 * 발급된 건의 회차 시작·끝 번호. 신청 상세 화면에는 이 칸이 없고 조회/정정 화면의 「콘텐츠목록 다운로드」 엑셀에만 있다
 * (2026-10-21 확인). 키 목록을 POST 하면 .xls 가 오며 머리글(UCI·회차시작번호·회차끝번호)로 열을 찾는다.
 * 가짜 포털(file://)에서는 받을 수 없어 빈 결과를 돌려준다.
 */
async function getIssuedEpisodes ({ portalKeys } = {}) {
  const s = loadSelectors()
  const cfg = s.status || {}
  const x = cfg.episodesExcel || {}
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  const keys = [...new Set((Array.isArray(portalKeys) ? portalKeys : []).map((k) => String(k || '')).filter(Boolean))]
  const episodes = {}
  if (!keys.length || !x.url || /^file:/i.test(cfg.url || '')) return { ok: true, episodes, skipped: true }
  const t = s.timeouts || {}

  try {
    const nav = await navigateAuthed(cfg.url, s, t)
    if (!nav.ok) return nav
    const chunk = Number(x.chunk) > 0 ? Number(x.chunk) : 100
    for (let i = 0; i < keys.length; i += chunk) {
      const part = keys.slice(i, i + chunk)
      const got = await evaluate(`(async () => {
        const body = new URLSearchParams(); body.set(${JSON.stringify(x.keysField || 'uciInfoKeyArr')}, ${JSON.stringify(part.join(','))});
        const r = await fetch(${JSON.stringify(x.url)}, { method: 'POST', body, credentials: 'same-origin' });
        if (!r.ok) return { error: '포털 응답 ' + r.status };
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return { b64: btoa(bin) };
      })()`, Math.max(60000, Number(t.pageLoad) || 0))
      if (!got || got.error || !got.b64) return { ok: false, error: `회차 엑셀을 받지 못했습니다${got && got.error ? `: ${got.error}` : ''}` }
      Object.assign(episodes, parseEpisodesWorkbook(Buffer.from(got.b64, 'base64'), x.headers))
    }
    step(`회차 범위 ${Object.keys(episodes).length}건 (조회/정정 엑셀)`)
    return { ok: true, episodes }
  } catch (e) {
    return { ok: false, error: `포털 연결 오류: ${e.message}` }
  }
}

/** 콘텐츠목록 엑셀에서 UCI → { start, end }. 머리글 글자로 열을 찾는다 (열 위치가 바뀌어도 된다). */
function parseEpisodesWorkbook (buffer, headers = {}) {
  const H = { uci: 'UCI', start: '회차시작번호', end: '회차끝번호', ...(headers || {}) }
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const out = {}
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
    const hi = rows.findIndex((r) => r.some((c) => String(c).trim() === H.uci) && r.some((c) => String(c).trim() === H.start))
    if (hi < 0) continue
    const head = rows[hi].map((c) => String(c).trim())
    const iu = head.indexOf(H.uci)
    const is = head.indexOf(H.start)
    const ie = head.indexOf(H.end)
    for (const r of rows.slice(hi + 1)) {
      const uci = String(r[iu] ?? '').trim()
      if (!uci) continue
      out[uci] = { start: String(r[is] ?? '').trim(), end: ie >= 0 ? String(r[ie] ?? '').trim() : '' }
    }
  }
  return out
}

/**
 * 현황 표에서 이 이력에 해당하는 줄을 고른다.
 *
 * 검색이 부분일치라 작품명이 정확히 같은 줄만 본다. 같은 이름이 여러 줄이면(같은 계정에 이름만 같은
 * 다른 작품을 '새 작품으로 등록' 한 경우) 포털의 최초신청일이 이력의 신청일과 같은 날인 줄을 고른다.
 * 날짜까지 같으면 구분할 방법이 없어 첫 줄을 쓴다. 정확히 같은 이름이 없으면 첫 줄로 돌아간다(기존 동작).
 */
/** 해석된 현황 항목들 가운데 이 이력의 짝을 고른다 (pickStatusRow 와 같은 규칙, 항목 모양만 다름). */
function pickStatusItem (items, record) {
  const title = String(record.title || '').trim()
  const mine = items.filter((i) => String(i.title || '').trim() === title)
  if (mine.length <= 1) return mine[0] || items[0]
  const want = localDay(record.appliedAt)
  return (want && mine.find((i) => localDay(i.appliedAt) === want)) || mine[0]
}

function pickStatusRow (rows, col, record) {
  const title = String(record.title || '').trim()
  const mine = rows.filter((r) => String(r[col.title] || '').trim() === title)
  if (mine.length <= 1) return mine[0] || rows[0]
  const want = localDay(record.appliedAt)
  if (want && col.appliedAt != null) {
    const byDay = mine.find((r) => localDay(parsePortalDate(r[col.appliedAt])) === want)
    if (byDay) return byDay
  }
  return mine[0]
}

/** ISO 시각을 이 컴퓨터 기준 날짜(YYYY-MM-DD)로. 비교 전용. */
function localDay (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 포털 표의 날짜를 ISO 로 바꾼다. 2026.08.03 · 2026-08-03 · 2026/10/15 15:37 모두 받는다.
 * 시각이 없으면 정오로 둔다 — 자정으로 두면 시간대 계산에서 날짜가 하루 밀려 보일 수 있다.
 */
function parsePortalDate (text) {
  const m = String(text || '').match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return ''
  const d = m[4] != null
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

async function lookup (uci) {
  const hit = store.listRecords({ query: uci }).find((r) => r.uci === uci)
  return hit ? { ok: true, record: hit } : { ok: false, error: '해당 UCI를 찾을 수 없습니다.' }
}

/*
 * 창 하나를 쓰는 동작은 들어온 차례대로 하나씩 돌린다. 두 요청이 겹치면 한쪽이 창을 다른 주소로 옮겨
 * 다른 쪽이 기다리던 화면이 사라지기 때문이다. 앞 동작이 실패해도 다음 동작은 돌아간다.
 * 창(lane)마다 차례가 따로다 — 불러오기(sync 창)가 도는 동안에도 신청·조회(main 창)는 바로 돈다.
 */
function inTurn (fn, L = mainLane) {
  return (...args) => {
    const run = L.turn.then(() => laneStorage.run(L, () => fn(...args)))
    L.turn = run.catch(() => {})
    return run
  }
}

module.exports = {
  login: inTurn(login),
  logout: inTurn(logout),
  getSession,
  verifyAccess: inTurn(verifyAccess),
  apply: inTurn(apply),
  applyBulk: inTurn(applyBulk),
  checkStatus: inTurn(checkStatus),
  listApplications: inTurn(listApplications),
  countApplications: inTurn(countApplications),
  getApplicationDetail: inTurn(getApplicationDetail),
  getApplicationDetails: inTurn(getApplicationDetails),
  getIssuedEpisodes: inTurn(getIssuedEpisodes),
  /**
   * 불러오기 전용 숨은 창으로 도는 같은 동작들. 로그인 직후 신청 내역 불러오기가 쓴다.
   * main 창의 신청·조회와 동시에 돌아도 서로 화면을 빼앗지 않는다. 세션 만료 시 재로그인도 이 창에서 한다.
   */
  background: {
    listApplications: inTurn(listApplications, syncLane),
    countApplications: inTurn(countApplications, syncLane),
    getApplicationDetails: inTurn(getApplicationDetails, syncLane),
    getIssuedEpisodes: inTurn(getIssuedEpisodes, syncLane)
  },
  lookup,
  isLoginConfigured, isConfigured, destroyWindow,
  /** 시험용. 포털 없이 창 요청 가로채기만 확인한다. */
  _test: { ensureWindow, takePopups, clearDialogs, isDuplicatePopup, pickStatusRow, parsePortalDate, parseStatusRow, parseEpisodesWorkbook }
}
