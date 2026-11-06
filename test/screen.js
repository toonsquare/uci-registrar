'use strict'

/*
 * 화면 점검.  실행: npm run test:screen
 *
 * 실제 index.html 을 띄워 화면 전환이 눈에 보이는지 확인한다.
 * 코드상으로는 전환이 끝났는데 화면은 그대로였던 적이 있어서(아래 주석 참고) 시험으로 박아 둔다.
 */

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..')
const cov = require('./coverage')

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`) }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1180, height: 800, webPreferences: { offscreen: true } })
  await cov.start(win)
  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'))
  await new Promise((r) => setTimeout(r, 800))
  const run = (js) => win.webContents.executeJavaScript(js, true)

  console.log('\n[화면 전환이 실제로 보이는가]')
  const initial = await run(`({
    로그인: getComputedStyle(document.querySelector('#login-screen')).display,
    앱: getComputedStyle(document.querySelector('#app-screen')).display
  })`)
  check('처음엔 로그인 화면만 보인다', initial.로그인 !== 'none' && initial.앱 === 'none', initial)

  const after = await run(`(() => {
    document.querySelector('#login-screen').hidden = true;
    document.querySelector('#app-screen').hidden = false;
    return { 로그인: getComputedStyle(document.querySelector('#login-screen')).display,
             앱: getComputedStyle(document.querySelector('#app-screen')).display };
  })()`)
  /*
   * 이 시험의 존재 이유:
   * .login-screen { display: flex } 가 브라우저 기본 [hidden]{display:none} 을 이겨서,
   * hidden 을 켜도 로그인 화면이 대시보드 위를 덮고 있었다. 코드상으로는 전환이 끝났는데
   * 화면은 그대로여서 '눌러도 반응이 없다' 로 보였다.
   */
  check('hidden 을 켜면 로그인 화면이 사라진다', after.로그인 === 'none', after)
  check('앱 화면이 보인다', after.앱 === 'flex', after)

  const back = await run(`(() => {
    document.querySelector('#app-screen').hidden = true;
    document.querySelector('#login-screen').hidden = false;
    return { 로그인: getComputedStyle(document.querySelector('#login-screen')).display,
             앱: getComputedStyle(document.querySelector('#app-screen')).display };
  })()`)
  check('로그아웃하면 되돌아간다', back.로그인 === 'flex' && back.앱 === 'none', back)

  const risky = await run(`(() => {
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      const had = el.hidden;
      el.hidden = true;
      if (getComputedStyle(el).display !== 'none') out.push(el.id || el.className || el.tagName);
      el.hidden = had;
    });
    return out;
  })()`)
  check('hidden 이 안 먹는 요소가 하나도 없다', risky.length === 0, risky)

  console.log('\n[메뉴 구성]')
  const nav = await run(`[...document.querySelectorAll('.nav-item')].map(b => b.dataset.view)`)
  check('메뉴 5개', nav.length === 5, nav)
  check('일괄 신청 메뉴가 없다', !nav.includes('batch'), nav)
  check('대시보드·신청·이력·설정·도움말', ['dashboard', 'issue', 'history', 'settings', 'help'].every((v) => nav.includes(v)), nav)

  console.log('\n[대화형 교육 페이지]')
  {
    const edu = new BrowserWindow({ show: false, width: 1080, height: 780, webPreferences: { offscreen: true } })
    await cov.start(edu)
    await edu.loadFile(path.join(ROOT, 'src', 'renderer', 'edu', 'index.html'))
    await new Promise((r) => setTimeout(r, 600))
    const e = (js) => edu.webContents.executeJavaScript(js, true)

    // 바깥에 메시지를 보내는지. 최상위에서는 parent 가 자기 자신이라 같은 창에서 받을 수 있다.
    await e(`window.__msgs = []; window.addEventListener('message', (ev) => window.__msgs.push(ev.data))`)
    await e(`post('ready')`)
    await new Promise((r) => setTimeout(r, 100))
    check('페이지가 떴다고 알린다', await e(`window.__msgs.some((m) => m && m.source === 'uci-edu' && m.event === 'ready')`))

    check('점수 게이지가 없다', !(await e(`!!document.querySelector('.gauge')`)))
    check('닫기 버튼이 있다', await e(`!!document.querySelector('#btnClose')`))
    check('인물 두 명이 정의돼 있다', await e(`Object.keys(CHARS).length === 2 && CHARS.seoyun && CHARS.jian ? true : false`))
    check('그림 파일 자리가 있다 (비어 있으면 코드 그림)', await e(`typeof CHAR_IMAGES === 'object' && typeof charMarkup === 'function'`))
    // 경로만 적혀 있고 파일이 없으면 인물 자리가 빈 채로 뜬다. 적힌 경로는 전부 실제로 있어야 한다.
    const paths = await e(`Object.values(CHAR_IMAGES).flatMap((m) => Object.values(m))`)
    const missing = paths.filter((rel) => !fs.existsSync(path.join(ROOT, 'src', 'renderer', 'edu', rel)))
    check(`인물 그림 ${paths.length}장이 전부 있다`, paths.length === 8 && missing.length === 0, missing)
    const bgs = ['bg-office', 'bg-library', 'bg-night'].filter((n) => !fs.existsSync(path.join(ROOT, 'src', 'renderer', 'edu', 'img', n + '.png')))
    check('배경 그림 3장이 전부 있다', bgs.length === 0, bgs)
    await e(`S.i = SCRIPT.findIndex((s) => s.c === 'seoyun'); render()`)
    await new Promise((r) => setTimeout(r, 400))
    check('인물이 그림 파일로 그려진다', await e(`!!document.querySelector('.char img') && document.querySelector('.char img').naturalWidth > 0`))

    const types = await e(`SCRIPT.map((s) => s.type || 'say')`)
    check('퀴즈가 그대로 있다 (객관식·짝짓기·순서·O/X)',
      ['choice', 'match', 'order', 'judge'].every((t) => types.includes(t)), types.filter((t) => t !== 'say'))
    check('가짜 폼·알림·등급 엔딩은 없다', !['form', 'notify', 'ending'].some((t) => types.includes(t)))
    check('마지막은 실제 화면 연습으로 넘긴다', types[types.length - 1] === 'practice')

    const all = await e(`JSON.stringify(SCRIPT)`)
    check('검증 안 된 수치가 없다', !/2026년 12월 3일|600곳|80만/.test(all))
    check('다건 등록 오해 문장이 없다', !all.includes('다건 등록으로'))
    check('회차 추가는 포털에서 직접이라고 알린다', all.includes('포털에서 직접'))

    // 끝까지 넘겨 실습 단계가 실제로 그려지는지
    await e(`S.i = SCRIPT.findIndex((s) => s.type === 'practice'); render()`)
    await new Promise((r) => setTimeout(r, 200))
    check('실습 단계에 연습 시작 버튼이 있다', await e(`!!document.querySelector('#pr')`))
    await e(`document.querySelector('#pr').click()`)
    await new Promise((r) => setTimeout(r, 100))
    check('연습 시작을 누르면 practice 를 보낸다', await e(`window.__msgs.some((m) => m && m.event === 'practice')`))
    await cov.dump(edu, 'screen-edu')
    edu.destroy()
  }

  await cov.dump(win, 'screen')
  console.log(`\n결과: ${pass}건 통과, ${fail}건 실패`)
  app.exit(fail ? 1 : 0)
})
