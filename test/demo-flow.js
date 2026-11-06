'use strict'

/*
 * 데모 빌드 흐름 점검.  실행: npm run test:demo
 *
 * 보여줄 순서를 처음부터 끝까지 실제로 눌러 본다.
 *   로그인 → 대시보드 → UCI 신청 → 폼 입력 → 신청하기 → 이력
 *   그리고 '작품 추가' 를 눌러 2건이 되면 단건 신청을 차례로 되풀이하는지까지.
 *
 * demo:true 를 켠 사본을 만들어 그 사본의 본체를 그대로 띄운다. 화면·통로·본체·저장까지
 * 전부 실제 경로를 탄다. 다른 점은 데모 스위치 하나뿐이다.
 */

const { app, BrowserWindow } = require('electron')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..')
const { SHOW_ADVANCED_SETTINGS, TOOLTIPS } = require(path.join(ROOT, 'src', 'shared', 'uci-constants'))
const cov = require('./coverage')   // NODE_V8_COVERAGE 가 켜져 있을 때만 화면 커버리지를 기록한다
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uci-demo-'))
const STAGE = path.join(TMP, 'stage')

app.setPath('userData', path.join(TMP, 'data'))

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* demo:true 사본 만들기 */
fs.mkdirSync(STAGE, { recursive: true })
fs.cpSync(path.join(ROOT, 'src'), path.join(STAGE, 'src'), { recursive: true })
fs.writeFileSync(path.join(STAGE, 'package.json'),
  JSON.stringify({ ...require(path.join(ROOT, 'package.json')), demo: true }), 'utf8')
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), 'dir') } catch { /* 있으면 무시 */ }

app.whenReady().then(async () => {
  require(path.join(STAGE, 'src', 'main', 'index.js')) // 사본의 본체를 그대로 띄운다
  await sleep(2500)

  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { console.log('  FAIL 창이 열리지 않았다'); return app.exit(1) }
  await cov.start(win)   // 커버리지 기록 (NODE_V8_COVERAGE 가 켜진 경우만)
  const run = (js) => win.webContents.executeJavaScript(js, true)

  /** 조건이 참이 될 때까지 기다린다. 화면 갱신은 비동기라 고정 대기로는 흔들린다. */
  const until = async (expr, timeout = 8000) => {
    const limit = Date.now() + timeout
    while (Date.now() < limit) {
      if (await run(expr)) return true
      await sleep(120)
    }
    return false
  }

  /** i번째 작품 카드를 채운다. */
  const fillCard = (i, title) => run(`(() => {
    const card = document.querySelectorAll('.work-card')[${i}];
    if (!card) return null;
    const set = (n, v) => {
      const el = card.querySelector('[name="' + n + '"]');
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('title', ${JSON.stringify(title)});
    set('authorName', '홍길동');
    set('ageGrade', 'AL');
    set('url', 'https://comic.naver.com/webtoon/demo');
    set('episodeStart', '1');
    set('episodeEnd', '12');
    set('price', '0');
    const syn = card.querySelector('[name="syndicate"]');
    syn.value = [...syn.options].find((o) => o.value)?.value;
    syn.dispatchEvent(new Event('change', { bubbles: true }));
    const g = card.querySelector('input[name="genres"]');
    g.checked = true;
    g.dispatchEvent(new Event('change', { bubbles: true }));
    return card.querySelector('[name="title"]').value;
  })()`)

  const submit = () => run(`document.querySelector('#issue-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))`)
  const errorText = () => run(`document.querySelector('#issue-error')?.textContent`)

  console.log('\n[0. 처음 켜면 교육이 뜬다]')
  check('교육 창이 로그인 화면 위에 뜬다', await until(`!document.querySelector('#edu').hidden`))
  // 보안 설정(CSP) 아래서 iframe 이 실제로 뜨고 스크립트가 돌았다는 증거다.
  check('교육 페이지가 떴다고 알려온다', await until(`state.eduReady === true`, 6000))
  await run(`window.postMessage({ source: 'uci-edu', event: 'close' }, '*')`)
  check('닫으면 사라진다', await until(`document.querySelector('#edu').hidden`))
  check('본 것으로 기록된다', await until(`state.settings && state.settings.onboardingDone === true`, 4000))

  console.log('\n[1. 로그인]')
  check('로그인 화면이 떠 있다', await until(`getComputedStyle(document.querySelector('#login-screen')).display !== 'none'`))
  check('데모 표식이 보인다', await run(`!document.querySelector('#demo-badge').hidden`))
  check('배지에 데모라고 쓰여 있다', (await run(`document.querySelector('#login-mode-badge').textContent`)) === '데모')

  await run(`(() => {
    document.querySelector('#login-id').value = 'demo';
    document.querySelector('#login-pw').value = 'demo';
    document.querySelector('#login-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  })()`)

  console.log('\n[2. 첫 화면]')
  check('대시보드로 넘어간다',
    await until(`getComputedStyle(document.querySelector('#app-screen')).display !== 'none'`), await errorText())
  check('로그인 화면은 사라진다', (await run(`getComputedStyle(document.querySelector('#login-screen')).display`)) === 'none')
  check('사이드바에 데모라고 쓰여 있다', (await run(`document.querySelector('#sidebar-mode').textContent`)) === '데모')
  // 로그인 → 바로 대시보드. 포털 현황 전체·상세 읽기는 뒤에서 돌고 상단 바에 진행이 보인다. 모의 포털이라 금방 끝난다.
  check('로그인 응답 → 대시보드 표시 시간을 잰다', await until(`typeof state.timing.lastDashboardMs === 'number'`, 3000))
  check('뒤에서 불러오기가 끝나면 이력이 받아져 있고 상단 표시는 완료로 바뀐다', await until(`!state.sync.running && state.sync.last && state.sync.last.ok && Array.isArray(state.records) && typeof state.timing.loadingMs === 'number' && /불러옴/.test(document.querySelector('#sync-chip').textContent)`, 8000),
    await run(`({ sync: state.sync, chip: document.querySelector('#sync-chip').textContent })`))
  check('상태별 건수가 저장된 이력으로 채워진다', await until(`[...document.querySelectorAll('[data-count]')].length === 4 && [...document.querySelectorAll('[data-count]')].every((el) => /^\\d+$/.test(el.textContent.trim()))`, 6000),
    await run(`[...document.querySelectorAll('[data-count]')].map((el) => el.textContent)`))
  {
    const t = await run(`({ dash: state.timing.lastDashboardMs, loading: state.timing.loadingMs, sync: state.timing.lastSyncMs })`)
    console.log(`  [속도] 로그인 응답 → 대시보드 표시 ${t.dash}ms · 로그인 응답 → 뒤에서 불러오기 완료 ${t.loading}ms (모의 포털 지연 포함)`)
    check('로그인하면 대시보드가 바로 뜬다 (불러오기를 기다리지 않음, 200ms 안)', t.dash < 200, t)
  }

  console.log('\n[3. UCI 신청 화면 — 처음엔 건별]')
  await run(`document.querySelector('.nav-item[data-view="issue"]').click()`)
  check('신청 폼이 뜬다', await until(`!!document.querySelector('#issue-form')`))
  check('작품 카드는 한 장으로 시작', (await run(`document.querySelectorAll('.work-card').length`)) === 1)
  check('한 카드 안에 네 구획이 모여 있다',
    (await run(`document.querySelectorAll('.work-card .work-section').length`)) === 4)
  check('버튼은 건별 문구', (await run(`document.querySelector('#issue-submit').textContent.trim()`)) === 'UCI 신청하기')
  check('작품 추가 버튼이 있다', await run(`!!document.querySelector('[data-action="add-work"]')`))
  check('한 건일 땐 삭제 버튼이 없다', (await run(`document.querySelectorAll('[data-action="remove-work"]').length`)) === 0)
  check('헤더에 엑셀 업로드 칸이 없다 (엑셀 일괄신청은 쓰지 않는다)', !(await run(`!!document.querySelector('#bulk-drop')`)))

  check('담당자 정보 경고가 없다', !(await run(`document.body.textContent.includes('담당자 정보를 먼저 등록')`)))

  console.log('\n[3-2. 항목 안내 (툴팁)]')
  {
    const tips = await run(`[...document.querySelectorAll('.work-card .tip-mark')].map((el) => el.dataset.tip || '')`)
    check('모든 항목에 안내 물음표가 있다', tips.length === Object.keys(TOOLTIPS).length - 1, tips.length)
    check('빈 안내가 없다', tips.every((t) => t.length > 5))

    // 말풍선은 물음표에만 걸려야 한다. 제목 줄 전체에 걸면 빈 공간을 지나가도 뜬다.
    check('제목 줄에는 말풍선이 걸려 있지 않다',
      (await run(`document.querySelectorAll('.work-card .field-label[data-tip]').length`)) === 0)
    check('평소에는 감춰져 있다',
      (await run(`getComputedStyle(document.querySelector('.work-card .tip-mark'), '::after').visibility`)) === 'hidden')

    // 툴팁과 같은 말을 하는 회색 도움말이 남아 있으면 같은 문장이 두 번 보인다.
    const helps = await run(`[...document.querySelectorAll('.work-card .field-help')].map((e) => e.textContent.trim())`)
    const all = Object.values(TOOLTIPS).join(' ')
    check('툴팁과 겹치는 도움말이 없다', !helps.some((h) => h && all.includes(h.slice(0, 10))), helps)
  }
  console.log('\n[4. 건별 신청]')
  check('1번 카드 입력', (await fillCard(0, '우리 동네 이야기')) === '우리 동네 이야기')
  await run(`document.querySelector('#rights-agreed').checked = true`)

  // 숫자 칸에 글자 — 입력 시점 검증 (SFR-002). 타이핑하면 그 자리에서 지워진다.
  await run(`(() => { const el = document.querySelector('.work-card [name="price"]'); el.value = '5백원'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  check('가격 칸의 글자는 입력 즉시 지워진다', (await run(`document.querySelector('.work-card [name="price"]').value`)) === '5',
    await run(`document.querySelector('.work-card [name="price"]').value`))
  // 걸러내기를 거치지 않고 들어온 값(자동 채움·붙여넣기 등)은 제출 때 막힌다. input 이벤트 없이 값만 바꿔 흉내낸다.
  await run(`document.querySelector('.work-card [name="episodeEnd"]').value = '10화'`)
  await submit()
  check('숫자 칸에 글자가 남아 있으면 접수하지 않고 사유를 보여 준다', await until(`/숫자만/.test(document.querySelector('#issue-error')?.textContent || '')`, 4000), await errorText())
  check('그 상태로는 접수되지 않는다', !(await run(`document.body.textContent.includes('신청 접수됨')`)))
  await run(`(() => { const set = (n, v) => { const el = document.querySelector('.work-card [name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }; set('price', '0'); set('episodeEnd', '12') })()`)
  // 작품 URL 의 앞부분을 빼먹으면 칸을 벗어날 때 https:// 를 붙여 준다
  await run(`(() => { const el = document.querySelector('.work-card [name="url"]'); el.value = 'comic.naver.com/webtoon/list?titleId=1'; el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check('작품 URL 에 앞부분이 없으면 https:// 를 붙여 준다', (await run(`document.querySelector('.work-card [name="url"]').value`)) === 'https://comic.naver.com/webtoon/list?titleId=1',
    await run(`document.querySelector('.work-card [name="url"]').value`))

  await submit()
  check('접수 안내가 나온다', await until(`document.body.textContent.includes('신청 접수됨')`, 12000), await errorText())
  check('접수 화면에 작품명이 보인다', await run(`document.body.textContent.includes('우리 동네 이야기')`))
  check('이 시점에 UCI 코드는 없다', !(await run(`/I410-ECN/.test(document.body.textContent)`)))
  check('신청 후 카드는 다시 한 장', (await run(`document.querySelectorAll('.work-card').length`)) === 1)

  console.log('\n[4-작가. 작가 줄 추가·삭제]')
  check('처음엔 작가 줄이 하나', (await run(`document.querySelectorAll('.work-card .author-row').length`)) === 1)
  check('한 줄일 땐 삭제 버튼이 없다', !(await run(`!!document.querySelector('[data-action="remove-author"]')`)))
  await run(`document.querySelector('[data-action="add-author"]').click()`)
  check('작가 추가를 누르면 두 줄', await until(`document.querySelectorAll('.work-card .author-row').length === 2`, 3000))
  check('둘째 줄의 기본 역할은 글', (await run(`document.querySelectorAll('.work-card [name="authorRole"]')[1].value`)) === '글')
  await run(`document.querySelectorAll('.work-card [name="authorRole"]')[1].value = '그림'; document.querySelectorAll('.work-card [name="authorName"]')[1].value = '김그림'; document.querySelectorAll('.work-card [name="authorName"]')[0].value = '홍길동'`)
  {
    const got = await run(`JSON.stringify(collectWorks()[0].authors)`)
    check('작가 두 줄이 역할·이름으로 읽힌다', got === JSON.stringify([{ role: '글/그림', name: '홍길동' }, { role: '그림', name: '김그림' }]), got)
  }
  await run(`document.querySelectorAll('[data-action="remove-author"]')[1].click()`)
  check('삭제하면 한 줄로 돌아온다', await until(`document.querySelectorAll('.work-card .author-row').length === 1`, 3000))
  check('남은 줄의 이름은 그대로', (await run(`document.querySelector('.work-card [name="authorName"]').value`)) === '홍길동')

  console.log('\n[4a. 이전 신청 불러오기]')
  check('카드에 불러오기 버튼이 있다', await run(`!!document.querySelector('[data-action="load-previous"]')`))
  // 신청 직후 뒤에서 포털(모의)을 다시 읽어 저장한다. 그 사이에 창을 열어도 끝나면 목록이 채워진다.
  check('신청한 작품이 저장된 이력에 들어온다', await until(`state.records.some((r) => r.title === '우리 동네 이야기')`, 8000),
    await run(`state.records.map((r) => r.title)`))
  check('처음엔 불러오기 창이 숨어 있다', await run(`document.querySelector('#picker').hidden`))
  await run(`document.querySelector('[data-action="load-previous"]').click()`)
  check('누르면 창이 뜬다', await until(`!document.querySelector('#picker').hidden`, 3000))
  check('열면 저장된 신청이 바로 보인다 (포털을 기다리지 않는다)', await until(`[...document.querySelectorAll('.picker-item')].some(b => b.textContent.includes('우리 동네 이야기'))`, 6000),
    await run(`document.querySelector('#picker-list').textContent.slice(0, 200)`))
  check('작가도 같이 보인다', await run(`[...document.querySelectorAll('.picker-item')].some(b => b.textContent.includes('우리 동네 이야기') && b.textContent.includes('홍길동'))`))
  await run(`document.querySelector('#picker-search').value = '없는작품'; document.querySelector('#picker-search').dispatchEvent(new Event('input'))`)
  check('없는 작품명은 없다고 알린다', await until(`document.querySelectorAll('.picker-item').length === 0 && document.querySelector('#picker-list').textContent.includes('그런 작품명')`, 4000),
    await run(`document.querySelector('#picker-list').textContent.slice(0, 200)`))
  await run(`document.querySelector('#picker-search').value = '우리 동네'; document.querySelector('#picker-search').dispatchEvent(new Event('input'))`)
  check('검색으로 다시 찾는다', await until(`document.querySelectorAll('.picker-item').length >= 1`, 4000))
  await run(`document.querySelector('.picker-item').click()`)
  check('고르면 창이 닫힌다', await until(`document.querySelector('#picker').hidden`, 3000))
  {
    const got = await run(`(() => { const c = document.querySelector('.work-card'); const v = (n) => c.querySelector('[name="' + n + '"]').value; return { title: v('title'), writer: v('authorName'), ageGrade: v('ageGrade'), url: v('url'), start: v('episodeStart'), end: v('episodeEnd') } })()`)
    check('작품명·작가·연령등급·URL 이 채워진다', got.title === '우리 동네 이야기' && got.writer === '홍길동' && got.ageGrade === 'AL' && got.url.includes('comic.naver.com'), got)
    check('회차 범위는 비워 둔다 (매번 달라지는 값)', got.start === '' && got.end === '', got)
  }
  await run(`document.querySelector('[data-action="reset-work"]').click()`)

  console.log('\n[4b. 같은 작품명이 이미 있을 때]')
  const histBefore = (await run(`JSON.stringify(state.stats || {})`))
  check('중복 작품 입력', (await fillCard(0, '중복 확인 작품')) === '중복 확인 작품')
  await run(`document.querySelector('#rights-agreed').checked = true`)
  await submit()
  check('접수 대신 갈래를 묻는 안내가 뜬다', await until(`!!document.querySelector('[data-action="dup-force-new"]')`, 12000), await errorText())
  check('회차 추가 안내 버튼이 있다', await run(`!!document.querySelector('[data-action="dup-add-episodes"]')`))
  check('이 시점엔 접수되지 않았다', !(await run(`document.body.textContent.includes('신청 접수됨')`)))
  await run(`document.querySelector('[data-action="dup-cancel"]').click()`)
  check('취소하면 안내가 닫힌다', await until(`document.querySelector('#issue-error').hidden`, 2000))
  check('입력한 내용은 그대로다', (await run(`document.querySelector('.work-card [name="title"]').value`)) === '중복 확인 작품')
  await submit()
  check('다시 신청하면 다시 묻는다', await until(`!!document.querySelector('[data-action="dup-force-new"]')`, 12000))
  await run(`document.querySelector('[data-action="dup-force-new"]').click()`)
  check('새 작품으로 등록을 고르면 접수된다', await until(`document.body.textContent.includes('신청 접수됨')`, 12000), await errorText())
  check('접수 화면에 그 작품명이 보인다', await run(`document.body.textContent.includes('중복 확인 작품')`))
  void histBefore

  console.log('\n[5. 작품 추가 — 여러 건을 차례로 보낸다]')
  await fillCard(0, '첫째 작품')
  await run(`document.querySelector('[data-action="add-work"]').click()`)
  check('카드가 두 장이 된다', await until(`document.querySelectorAll('.work-card').length === 2`))
  check('먼저 쓴 내용이 남아 있다',
    (await run(`document.querySelectorAll('.work-card')[0].querySelector('[name="title"]').value`)) === '첫째 작품')
  check('버튼이 여러 건 문구로 바뀐다',
    (await run(`document.querySelector('#issue-submit').textContent.trim()`)) === 'UCI 2건 신청하기')
  check('한 건씩 차례로 보낸다고 알려준다', await run(`document.body.textContent.includes('한 건씩 차례로')`))
  check('두 장이 되면 삭제 버튼이 생긴다', (await run(`document.querySelectorAll('[data-action="remove-work"]').length`)) === 2)

  // 카드가 늘어도 같은 id 가 생기면 안 된다. 두 번째 것은 영영 동작하지 않는다.
  const dupIssue = await run(`(() => {
    const seen = {}, out = [];
    document.querySelectorAll('[id]').forEach((el) => { seen[el.id] = (seen[el.id] || 0) + 1; if (seen[el.id] === 2) out.push(el.id) });
    return out;
  })()`)
  check('카드가 두 장이어도 중복 id 가 없다', dupIssue.length === 0, dupIssue)

  // 가격단위 '직접입력' 칸은 고른 카드에서만 열려야 한다.
  const etc = await run(`(() => {
    const cards = document.querySelectorAll('.work-card');
    const sel = cards[1].querySelector('select[name="currency"]');
    sel.value = '직접입력'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const r = [cards[0], cards[1]].map((c) => c.querySelector('input[name="currencyEtc"]').hidden);
    sel.value = '원'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return r;
  })()`)
  check('직접입력 칸은 고른 카드에서만 열린다', etc[0] === true && etc[1] === false, etc)
  check('카드에 번호가 붙는다', await run(`document.querySelectorAll('.work-card h3')[1].textContent.includes('작품 2')`))
  check('화면 위 설명도 여러 건으로 바뀐다',
    await run(`document.querySelector('#view-subtitle').textContent.includes('2건을 한 건씩')`),
    await run(`document.querySelector('#view-subtitle').textContent`))

  // 카드가 두 장 늘어선 모습을 남겨 둔다. 이 화면이 이번 개편의 핵심이다.
  await run(`document.querySelector('#view').scrollTop = 0`)
  await sleep(400)
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'dist', 'demo-works.png'), (await win.webContents.capturePage()).toPNG())

  console.log('\n[6. 빠진 항목은 몇 번째인지 짚어 준다]')
  await run(`document.querySelector('#rights-agreed').checked = true`)
  await submit()
  check('두 번째 작품이 비었다고 알려준다',
    await until(`/작품 2/.test(document.querySelector('#issue-error')?.textContent || '')`, 4000), await errorText())

  console.log('\n[7. 여러 건 신청 — 단건 신청을 차례로]')
  await fillCard(1, '둘째 작품')
  await run(`document.querySelector('#rights-agreed').checked = true`)
  await submit()
  check('2건 접수 안내가 나온다', await until(`document.body.textContent.includes('2건 신청 접수됨')`, 15000), await errorText())
  check('두 작품명이 모두 보인다',
    await run(`document.body.textContent.includes('첫째 작품') && document.body.textContent.includes('둘째 작품')`))
  check('신청 뒤 카드는 한 장으로 돌아간다', (await run(`document.querySelectorAll('.work-card').length`)) === 1)

  console.log('\n[7b. 한 건이 막혀도 나머지는 보낸다]')
  // 첫 카드는 포털에 같은 이름이 있는 작품(모의 연동은 작품명에 '중복' 이 들면 그렇게 침 → 갈래를 묻고 취소), 둘째 카드는 새 작품.
  // 둘째만 접수되고 첫 카드가 사유와 함께 남아야 한다.
  await run(`document.querySelector('[data-action="dismiss-result"]')?.click()`)
  await fillCard(0, '중복 작품 둘')
  await run(`document.querySelector('[data-action="add-work"]').click()`)
  await until(`document.querySelectorAll('.work-card').length === 2`)
  await fillCard(1, '셋째 작품')
  await run(`document.querySelector('#rights-agreed').checked = true`)
  await submit()
  check('첫 작품에서 멈춰 같은 작품명 갈래를 묻는다 (몇 번째 작품인지 함께)', await until(`!!document.querySelector('[data-action="dup-cancel"]') && /작품 1/.test(document.querySelector('#issue-error').textContent)`, 12000), await errorText())
  check('묻는 동안 둘째 작품은 아직 보내지 않았다', !(await run(`document.body.textContent.includes('신청 접수됨')`)))
  await run(`document.querySelector('[data-action="dup-cancel"]').click()`)
  check('취소하면 둘째 작품을 이어서 보내 접수된다', await until(`document.body.textContent.includes('신청 접수됨') && document.body.textContent.includes('셋째 작품')`, 15000), await errorText())
  check('막힌 첫 작품 카드만 남고 사유가 적힌다', (await run(`document.querySelectorAll('.work-card').length`)) === 1 &&
    (await run(`document.querySelector('.work-card [name="title"]').value`)) === '중복 작품 둘' &&
    await run(`/같은 작품명이 포털에 있어/.test(document.querySelector('#issue-error').textContent)`), await errorText())
  check('남은 카드의 동의 체크는 유지된다', await run(`document.querySelector('#rights-agreed').checked`))
  await run(`document.querySelector('[data-action="reset-work"]').click()`)

  console.log('\n[8. 이력]')
  await run(`document.querySelector('.nav-item[data-view="history"]').click()`)
  check('새로고침·CSV 버튼이 있다', await until(`!!document.querySelector('[data-action="history-refresh"]') && !!document.querySelector('[data-action="export-csv"]')`, 3000))
  // 뒤에서 읽는 중에는 둘 다 잠기고, 끝나면 풀린다. 모의 포털은 금방 끝나므로 끝난 상태만 확인한다.
  check('읽기가 끝난 뒤에는 새로고침·CSV 가 열려 있다', await until(`!state.sync.running && !document.querySelector('[data-action="history-refresh"]').disabled && !document.querySelector('[data-action="export-csv"]').disabled`, 5000))
  await run(`(() => { state.sync.running = true; navigate('history') })()`)
  check('읽는 중에는 새로고침·CSV 가 잠긴다', await until(`document.querySelector('[data-action="history-refresh"]').disabled && document.querySelector('[data-action="export-csv"]').disabled`, 3000))
  check('잠긴 버튼에는 왜 잠겼는지 툴팁이 있다', await run(`(() => { const w = document.querySelector('[data-action="export-csv"]').closest('.tip-wrap'); return /읽는 중/.test((w && (w.title || w.getAttribute('data-tip-text'))) || '') })()`))
  // 툴팁은 브라우저 title 이 아니라 직접 그린다 — 마우스를 올리면 100ms 안에 뜬다
  await run(`(() => { const b = document.querySelector('[data-action="export-csv"]').closest('.tip-wrap'); b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })()`)
  await sleep(100)
  check('툴팁이 100ms 안에 뜬다', await run(`(() => { const t = document.querySelector('#tipbox'); return !!(t && !t.hidden && /읽는 중/.test(t.textContent)) })()`))
  await run(`document.dispatchEvent(new MouseEvent('mousedown'))`)
  await run(`(() => { state.sync.running = false; navigate('history') })()`)
  check('풀리면 다시 쓸 수 있다', await until(`!document.querySelector('[data-action="history-refresh"]').disabled`, 3000))
  const want = 3
  const total = want + 2   // 4b 의 「중복 확인 작품」, 7b 의 「셋째 작품」까지
  check('포털 기준 총 건수와 쪽수를 보여 준다', await until(`document.body.textContent.includes('총 ${total}건 · 1/1쪽')`, 5000),
    await run(`document.querySelector('.card-head .faint')?.textContent`))
  check('한 쪽뿐이면 쪽 넘김 단추가 없다', !(await run(`!!document.querySelector('.pager')`)))
  // 한 쪽 건수 — 포털 조회 화면의 작품개수(10·20·50·100)와 같은 선택지. 고른 값은 설정에 남는다 (SFR-006-03).
  check('한 쪽 건수 선택이 있고 선택지가 포털과 같다', (await run(`[...document.querySelectorAll('#history-page-size option')].map((o) => o.value).join(',')`)) === '10,20,50,100')
  check('기본은 10건', (await run(`document.querySelector('#history-page-size').value`)) === '10')
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'dist', 'demo-history-page-size.png'), (await win.webContents.capturePage()).toPNG())   // 한 쪽 건수 선택 갈무리
  await run(`(() => { const s = document.querySelector('#history-page-size'); s.value = '50'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  check('바꾸면 설정에 남는다', await until(`state.settings && state.settings.historyPageSize === 50`, 4000))
  check('다시 그려도 고른 값이 유지된다', await until(`document.querySelector('#history-page-size')?.value === '50'`, 3000))
  await run(`(() => { const s = document.querySelector('#history-page-size'); s.value = '10'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await until(`state.settings && state.settings.historyPageSize === 10`, 4000)
  check('여러 건 신청도 작품별로 한 줄씩 남는다',
    await until(`[...document.querySelectorAll('tr')].filter(r => /첫째 작품|둘째 작품|우리 동네 이야기/.test(r.textContent)).length === ${want}`),
    await run(`[...document.querySelectorAll('tr')].map(r => r.textContent.replace(/\\s+/g,' ').trim()).slice(0,6)`))
  // 상태 글자는 포털의 신청상태 그대로. 「포털 상태: …」 같은 덧말은 없다 (2026-10-22).
  check('상태는 포털 글자 그대로 「접수」',
    await run(`[...document.querySelectorAll('tr')].some(r => r.textContent.includes('둘째 작품') && [...r.querySelectorAll('.badge')].some((b) => b.textContent.trim() === '접수'))`))
  check('「포털 상태:」 덧말이 없다', !(await run(`document.body.textContent.includes('포털 상태:')`)))
  // 상태 뱃지는 마우스를 올리면 무조건 툴팁 — 처리불가 사유는 현황 칸의 괄호에서 온다
  await run(`(() => { state.records = state.records.concat([{ id: 'tip-rej', title: '툴팁 확인용', status: 'rejected', portalStatus: '처리불가', portalNote: '중복신청', source: 'portal', portalKey: 'tip', appliedAt: '2026-10-01T03:00:00.000Z', contentType: 'webtoon', detailAt: 'x' }]); const keep = loadRecords; loadRecords = async () => ({ ok: true }); return renderHistory(document.querySelector('#view')).then(() => { loadRecords = keep }) })()`)
  await sleep(300)
  await run(`(() => { const b = [...document.querySelectorAll('.badge')].find((x) => x.textContent.trim() === '처리불가'); b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })()`)
  await sleep(100)
  check('처리불가 뱃지에 마우스를 올리면 사유 툴팁이 100ms 안에 뜬다', await run(`(() => { const t = document.querySelector('#tipbox'); return !!(t && !t.hidden && /중복신청/.test(t.textContent)) })()`),
    await run(`document.querySelector('#tipbox')?.textContent`))
  await run(`document.dispatchEvent(new MouseEvent('mousedown'))`)
  await run(`(() => { state.records = state.records.filter((r) => r.id !== 'tip-rej'); return render() })()`)
  check('이 프로그램으로 낸 신청은 작가가 채워져 있다 (상세 미확인이 아니다)',
    await run(`[...document.querySelectorAll('tr')].some(r => r.textContent.includes('우리 동네 이야기') && r.textContent.includes('홍길동'))`))
  // executeJavaScript 는 전역에서 돌므로 const 를 밖에 두면 두 번째 호출에서 「이미 선언됨」으로 죽는다.
  await run(`(() => { const s = document.querySelector('#history-status'); s.value = 'issued'; s.dispatchEvent(new Event('change')) })()`)
  check('상태 필터는 읽어 둔 이력에서 바로 거른다 (완료 0건)', await until(`document.body.textContent.includes('총 0건 · 1/1쪽') && document.body.textContent.includes('조건에 맞는 신청이 없습니다')`, 5000),
    await run(`document.querySelector('.card-head .faint')?.textContent`))
  await run(`(() => { const s = document.querySelector('#history-status'); s.value = 'all'; s.dispatchEvent(new Event('change')) })()`)
  check('전체로 돌아오면 바로 그린다', await until(`document.body.textContent.includes('총 ${total}건 · 1/1쪽')`, 3000))
  {
    const t = await run(`state.timing.lastDrawMs`)
    console.log(`  [속도] 이력 그리기 (저장된 이력) ${t}ms`)
    check('이력은 200ms 안에 그린다', typeof t === 'number' && t < 200, t)
  }

  console.log('\n[9. 설정 화면]')
  await run(`document.querySelector('.nav-item[data-view="settings"]').click()`)
  check('설정 화면이 뜬다', await until(`!!document.querySelector('#settings-save')`))
  check(SHOW_ADVANCED_SETTINGS ? '고급 설정이 보인다' : '고급 설정이 감춰져 있다',
    (await run(`!!document.querySelector('details.advanced')`)) === SHOW_ADVANCED_SETTINGS)

  /*
   * 감춘 항목을 읽는 코드가 하나라도 남아 있으면 저장 버튼 연결이 통째로 끊긴다.
   * 화면에는 아무 일도 안 일어나서 알아채기 어렵다. 그래서 실제로 저장해 본다.
   */
  await run(`(() => {
    const el = document.querySelector('#set-manager-name');
    el.value = '저장확인용';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#settings-save').click();
  })()`)
  check('감춘 뒤에도 설정이 저장된다',
    await until(`document.body.textContent.includes('설정이 저장되었습니다')`, 6000),
    await run(`document.querySelector('#issue-error')?.textContent || '(안내 없음)'`))

  /*
   * 같은 id 가 둘이면 두 번째 것은 영영 동작하지 않는다. querySelector 는 첫 번째만 찾는다.
   * 실제로 고급 설정 안에 저장 버튼이 하나 더 있어서 눌러도 아무 일이 없었다.
   */
  const dup = await run(`(() => {
    const seen = {}, out = [];
    document.querySelectorAll('[id]').forEach((el) => {
      seen[el.id] = (seen[el.id] || 0) + 1;
      if (seen[el.id] === 2) out.push(el.id);
    });
    return out;
  })()`)
  check('화면에 중복된 id 가 없다', dup.length === 0, dup)
  check('버전 표시가 보인다', await until(`!!document.querySelector('#app-version')?.textContent.trim()`, 4000),
    await run(`document.querySelector('#app-version')?.textContent`))

  await run(`document.querySelector('.nav-item[data-view="dashboard"]').click()`)
  await run(`document.querySelector('.nav-item[data-view="settings"]').click()`)
  check('저장한 값이 실제로 남는다',
    await until(`document.querySelector('#set-manager-name')?.value === '저장확인용'`),
    await run(`document.querySelector('#set-manager-name')?.value`))

  console.log('\n[10. 자동 로그인 (슬랙처럼)]')
  {
    const loginVisible = () => run(`getComputedStyle(document.querySelector('#login-screen')).display !== 'none'`)
    const appVisible = () => run(`getComputedStyle(document.querySelector('#app-screen')).display !== 'none'`)
    const restart = async () => { win.webContents.reload(); await sleep(1500) }

    // 로그인 정보를 저장하고 로그인한다.
    await run(`document.querySelector('#logout-btn').click()`)
    await until(`getComputedStyle(document.querySelector('#login-screen')).display !== 'none'`)
    await run(`(() => {
      document.querySelector('#login-id').value = 'auto';
      document.querySelector('#login-pw').value = 'pw';
      document.querySelector('#login-remember').checked = true;
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`)
    await until(`getComputedStyle(document.querySelector('#app-screen')).display !== 'none'`)

    // 앱을 다시 켠 것처럼 화면을 새로 띄운다. 아무것도 누르지 않아도 들어가야 한다.
    await restart()
    check('저장해 두면 켜자마자 들어간다',
      await until(`getComputedStyle(document.querySelector('#app-screen')).display !== 'none'`, 10000),
      await run(`document.querySelector('#login-error')?.textContent`))

    // 로그아웃하면 저장된 비밀번호가 지워지고, 아이디만 남는다.
    await run(`document.querySelector('#logout-btn').click()`)
    await until(`getComputedStyle(document.querySelector('#login-screen')).display !== 'none'`)
    const after = await run(`({
      id: document.querySelector('#login-id').value,
      pw: document.querySelector('#login-pw').value,
      remember: document.querySelector('#login-remember').checked
    })`)
    check('로그아웃하면 비밀번호가 비워진다', after.pw === '' && after.remember === false, after)
    check('아이디는 남아 있다', after.id === 'auto', after)

    // 다시 켜도 이번엔 들어가면 안 된다. 그래야 다른 계정으로 바꿀 수 있다.
    await restart()
    await sleep(1500)
    check('로그아웃 뒤에는 자동 로그인되지 않는다', (await loginVisible()) && !(await appVisible()))
    check('다시 켜도 아이디는 채워져 있다',
      await until(`document.querySelector('#login-id').value === 'auto'`, 4000),
      await run(`document.querySelector('#login-id').value`))
  }

  console.log('\n[11. 교육 → 연습 (실제 화면)]')
  {
    const appOn = `getComputedStyle(document.querySelector('#app-screen')).display !== 'none'`
    const loginOn = `getComputedStyle(document.querySelector('#login-screen')).display !== 'none'`

    // 담당자 정보를 비워 연습 1단계부터 타게 한다. 자격 확인 기록도 비워 '처음 설치한 PC' 와 같게 만든다 —
    // 그 상태에서 1단계 설정 저장 뒤 신청 버튼이 잠기던 문제를 잡는다 (2026-10-21).
    await run(`api.settings.set({ managerName: '', managerEmail: '', managerMobile: '', privacyAgreed: false, registrantVerifiedAt: '' })`)
    await sleep(300)

    await run(`showOnboarding()`)
    check('도움말에서 교육을 다시 열 수 있다', await until(`!document.querySelector('#edu').hidden && state.eduReady === true`, 6000))
    await run(`window.postMessage({ source: 'uci-edu', event: 'practice' }, '*')`)
    check('연습 시작 → 앱 화면으로 들어간다', await until(appOn, 8000))
    check('연습 중 띠가 보인다', await run(`!document.querySelector('#practice-bar').hidden`))
    check('코치 패널이 보인다', await run(`!document.querySelector('#coach').hidden`))
    check('1단계는 담당자 정보', await run(`document.querySelector('#coach-step').textContent.trim() === '1 / 4'`),
      await run(`document.querySelector('#coach-step').textContent`))
    check('설정 메뉴가 강조된다', await run(`document.querySelector('.nav-item[data-view="settings"]').classList.contains('coach-target')`))

    // 1단계: 담당자 정보 저장
    await run(`document.querySelector('.nav-item[data-view="settings"]').click()`)
    await until(`!!document.querySelector('#set-manager-name')`)
    await run(`(() => {
      const set = (id, v) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) };
      set('#set-manager-name', '김담당'); set('#set-manager-email', 'demo@tooning.io'); set('#set-manager-mobile', '01012345678');
      document.querySelector('#set-privacy-agreed').checked = true;
      document.querySelector('#settings-save').click();
    })()`)
    check('저장하면 2단계(작품 신청)로 넘어간다', await until(`document.querySelector('#coach-step').textContent.trim() === '2 / 4'`, 6000),
      await run(`document.querySelector('#coach-step').textContent`))

    // 2단계: 샘플로 채워 신청
    await run(`[...document.querySelectorAll('#coach-actions button')].find((b) => b.textContent.includes('샘플')).click()`)
    check('샘플 작품이 채워진다', await until(`document.querySelector('.work-card [name="title"]')?.value === '연습용 작품'`, 4000))
    check('저작권 동의도 체크된다', await run(`document.querySelector('#rights-agreed').checked`))
    // 처음 설치한 PC 에서는 자격 확인 기록이 없다. 그래도 연습 중에는 신청 버튼이 잠기면 안 된다 (2026-10-21 감리 리뷰에서 발견).
    check('연습 중에는 신청 버튼이 잠기지 않는다', await run(`!document.querySelector('#issue-submit').disabled`),
      await run(`document.querySelector('.alert-warning')?.textContent.trim().slice(0, 60)`))

    // 코치 띠가 '누르세요' 라고 안내한 신청 버튼을 가리면 안 된다. 좌표로 잰다.
    await run(`document.querySelector('#view').scrollTop = 1e6`)
    await sleep(400)
    const cover = await run(`(() => {
      const b = document.querySelector('#issue-submit').getBoundingClientRect();
      const v = document.querySelector('#view').getBoundingClientRect();
      const hit = (el) => { const c = el.getBoundingClientRect(); return b.bottom > c.top && b.top < c.bottom && b.right > c.left && b.left < c.right };
      // 코치 띠는 물론, 알림(토스트)도 그 버튼을 덮으면 안 된다.
      return { 띠가가림: hit(document.querySelector('#coach')),
               알림이가림: [...document.querySelectorAll('.toast')].some(hit),
               알림수: document.querySelectorAll('.toast').length,
               보임: b.top >= v.top && b.bottom <= v.bottom };
    })()`)
    check('코치 띠가 신청 버튼을 가리지 않는다', cover.띠가가림 === false && cover.보임 === true, cover)
    check('알림도 신청 버튼을 가리지 않는다', cover.알림수 > 0 && cover.알림이가림 === false, cover)
    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })   // 갓 받은 소스에는 dist 가 없다
    fs.writeFileSync(path.join(ROOT, 'dist', 'demo-coach.png'), (await win.webContents.capturePage()).toPNG())
    await run(`document.querySelector('#issue-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))`)
    check('신청하면 3단계(결과 조회)로 넘어간다', await until(`document.querySelector('#coach-step').textContent.trim() === '3 / 4'`, 10000),
      await run(`document.querySelector('#issue-error')?.textContent`))
    check('남은 초를 세어 준다', await run(`/초/.test(document.querySelector('#coach-text').textContent)`),
      await run(`document.querySelector('#coach-text').textContent`))

    // 3단계: 연습 심사는 10초. 지나고 나서 조회한다.
    await sleep(11000)
    await run(`document.querySelector('.nav-item[data-view="dashboard"]').click()`)
    // 대시보드는 틀부터 그리고 포털 첫 쪽을 읽어 채운다. 조회 단추는 「조회할 게 없다」고 확인된 때만 잠기므로 풀릴 때까지 기다린다.
    check('조회 단추가 열린다', await until(`!!document.querySelector('[data-action="refresh-status"]') && !document.querySelector('[data-action="refresh-status"]').disabled`, 8000))
    await run(`document.querySelector('[data-action="refresh-status"]').click()`)
    check('발급되면 4단계(UCI 확인)로 넘어간다', await until(`document.querySelector('#coach-step').textContent.trim() === '4 / 4'`, 15000),
      await run(`document.querySelector('#coach-text').textContent`))

    // 4단계: 이력에서 확인하고 마친다
    await run(`document.querySelector('.nav-item[data-view="history"]').click()`)
    check('이력에 연습 작품과 UCI 가 보인다',
      await until(`[...document.querySelectorAll('tr')].some((r) => r.textContent.includes('연습용 작품') && /I410-ECN/.test(r.textContent))`, 5000))
    check('마치기 버튼이 나온다', await until(`[...document.querySelectorAll('#coach-actions button')].some((b) => b.textContent.includes('마치고'))`, 4000))
    await run(`[...document.querySelectorAll('#coach-actions button')].find((b) => b.textContent.includes('마치고')).click()`)
    check('마치면 로그인 화면으로 돌아온다', await until(loginOn, 8000))
    check('연습 띠·코치가 사라진다', await run(`document.querySelector('#practice-bar').hidden && document.querySelector('#coach').hidden`))
    check('안내 문구가 뜬다', await run(`!document.querySelector('#login-notice').hidden && /연습을 마쳤습니다/.test(document.querySelector('#login-notice').textContent)`))

    // 연습 기록은 실제 이력에 남으면 안 된다.
    const left = await run(`api.records.list({}).then((r) => (r.records || r.items || []).filter((x) => x.mode === 'mock').length)`)
    check('연습 기록이 지워졌다', left === 0, left)
  }

  const shot = await win.webContents.capturePage()
  const out = path.join(ROOT, 'dist', 'demo-flow.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, shot.toPNG())
  console.log(`\n화면 갈무리 → ${out}`)

  console.log(`\n결과: ${pass}건 통과, ${fail}건 실패`)
  // Windows 는 Chromium 캐시 파일이 아직 잠겨 있어 EPERM 이 난다. 임시 폴더가 남는 것은 결과와 무관하므로 종료를 막지 않는다.
  for (const w of BrowserWindow.getAllWindows()) await cov.dump(w, 'demo')
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { console.log(`  (임시 폴더 정리 생략: ${e.code || e.message})`) }
  app.exit(fail ? 1 : 0)
}).catch((e) => { console.error('오류:', e); app.exit(1) })
