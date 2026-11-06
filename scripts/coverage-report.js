'use strict'

/*
 * 시험 커버리지 표를 낸다.  실행: npm run coverage
 *
 * 1) 세 시험을 NODE_V8_COVERAGE 를 켜고 차례로 돌린다 (본체는 Electron 이, 화면은 test/coverage.js 가 기록).
 * 2) 데모 흐름 시험은 소스를 임시 폴더에 복사해 돌리므로, 기록된 파일 경로를 저장소 경로로 되돌린다.
 * 3) c8 로 src/ 전체 표를 만든다. 품질 지표(단위 테스트 커버리지)는 이 표의 All files 줄을 쓴다.
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'coverage')
const TMP = path.join(OUT, 'tmp')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

for (const script of ['test/run.js', 'test/screen.js', 'test/demo-flow.js']) {
  console.log(`\n### ${script}`)
  try {
    execFileSync(npx, ['electron', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, NODE_V8_COVERAGE: TMP } })
      .toString().split('\n').filter((l) => /결과:/.test(l)).forEach((l) => console.log(l))
  } catch (e) {
    const out = (e.stdout || '').toString().split('\n').filter((l) => /FAIL|결과:/.test(l))
    console.log(out.join('\n') || `(시험 실패: ${e.message})`)
  }
}

// 임시 복사본 경로 → 저장소 경로. 커버리지 파일 안의 url/경로는 문자열이라 통째로 바꾼다.
const rootUrl = 'file://' + ROOT
for (const f of fs.readdirSync(TMP)) {
  const p = path.join(TMP, f)
  let s = fs.readFileSync(p, 'utf8')
  s = s.replace(/file:\/\/[^"]*?\/stage\/src\//g, rootUrl + '/src/')
  s = s.replace(/"url":"\/[^"]*?\/stage\/src\//g, '"url":"' + ROOT + '/src/')
  fs.writeFileSync(p, s)
}

console.log('\n### 커버리지 (src/)')
execFileSync(npx, ['c8', 'report', '--temp-directory', TMP, '--reporter', 'text', '--reporter', 'text-summary',
  '--include', 'src/**', '--exclude', 'src/main/templates/**', '--exclude', 'src/renderer/edu/img/**'], { cwd: ROOT, stdio: 'inherit' })
