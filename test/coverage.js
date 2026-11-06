'use strict'

/*
 * 시험 커버리지 수집 도우미.
 *
 * 본체(Node) 쪽은 Electron 이 NODE_V8_COVERAGE 환경변수를 보고 알아서 기록한다.
 * 화면(렌더러) 쪽은 그 변수가 닿지 않으므로, 창의 개발자도구 통로(CDP Profiler)로 같은 형식의
 * 커버리지를 받아 같은 폴더에 써 준다. 그러면 c8 이 둘을 합쳐 한 표로 낸다 (scripts/coverage-report.js).
 *
 * NODE_V8_COVERAGE 가 없으면 아무것도 하지 않는다 — 평소 시험은 그대로 돈다.
 */

const fs = require('node:fs')
const path = require('node:path')

const DIR = process.env.NODE_V8_COVERAGE || ''
const enabled = () => Boolean(DIR)

/** 창이 뜬 직후에 부른다. 이때부터 실행되는 화면 코드가 기록된다. */
async function start (win) {
  if (!enabled() || !win || win.isDestroyed()) return
  const dbg = win.webContents.debugger
  try {
    // 아무 페이지도 띄운 적 없는 창은 렌더러가 아직 없어 개발자도구 명령이 돌아오지 않는다. 빈 페이지를 먼저 띄운다.
    if (!win.webContents.getURL()) await win.loadURL('about:blank')
    if (!dbg.isAttached()) dbg.attach('1.3')
    await dbg.sendCommand('Profiler.enable')
    await dbg.sendCommand('Profiler.startPreciseCoverage', { callCount: true, detailed: true, allowTriggeredUpdates: false })
  } catch (e) {
    console.log(`  (커버리지 시작 실패: ${e.message})`)
  }
}

/** 창을 닫기 전에 부른다. 기록을 파일로 남긴다. */
async function dump (win, tag) {
  if (!enabled() || !win || win.isDestroyed()) return
  const dbg = win.webContents.debugger
  try {
    if (!dbg.isAttached()) return
    const { result } = await dbg.sendCommand('Profiler.takePreciseCoverage')
    await dbg.sendCommand('Profiler.stopPreciseCoverage').catch(() => {})
    const scripts = (result || []).filter((s) => String(s.url || '').startsWith('file://'))
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(path.join(DIR, `renderer-${tag}-${Date.now()}.json`), JSON.stringify({ result: scripts }))
  } catch (e) {
    console.log(`  (커버리지 저장 실패: ${e.message})`)
  }
}

module.exports = { enabled, start, dump }
