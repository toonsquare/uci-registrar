'use strict'

/*
 * 데모 설치 파일을 만든다.
 *   npm run build:demo      Windows 설치 파일 (.exe)
 *
 * 왜 복사본에서 굽는가
 * ────────────────────
 * electron-builder 의 extraMetadata 로도 demo:true 를 심을 수는 있다. 다만 그 방식은
 * '실제용 설정 파일에 데모용 값이 섞여 들어가는' 구조라, 한 줄 잘못 건드리면 실제용
 * 빌드가 데모로 나간다. 그 사고는 조용히 일어나고 설치해 보기 전까지 티가 안 난다.
 *
 * 그래서 원본은 읽기만 하고, 복사본을 따로 만들어 거기서 굽는다.
 * 이 스크립트가 어떻게 끝나든(중간에 죽더라도) 저장소는 그대로다.
 * 마지막에 원본이 안 바뀌었는지 실제로 확인하고 끝낸다.
 *
 * 실제용과 다른 점은 딱 셋이다.
 *  1. package.json 에 demo:true  → src/shared/app-mode.js 가 읽는 유일한 스위치
 *  2. 다른 appId · productName   → 실제용과 나란히 설치되고 저장 폴더가 분리된다
 *  3. 다른 설치 파일 이름        → 파일만 보고도 구분된다
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const stamp = require('./stamp')

const ROOT = path.join(__dirname, '..')
const STAGE = path.join(ROOT, '.demo-build')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

/* 1. 복사본 자리를 비운다 */
fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(STAGE, { recursive: true })

/* 2. 굽는 데 필요한 것만 복사한다 */
for (const dir of ['src', 'build']) {
  fs.cpSync(path.join(ROOT, dir), path.join(STAGE, dir), { recursive: true })
}

/* 3. 복사본의 package.json 만 데모용으로 고친다 (원본은 손대지 않는다) */
const NAME = `${pkg.productName} (데모)`
const S = stamp() // 파일명에 붙일 빌드 시각. 이전 설치 파일을 덮어쓰지 않게 한다.
const demoPkg = {
  ...pkg,
  productName: NAME,
  demo: true, // ← 앱이 보는 단 하나의 스위치
  scripts: undefined,
  devDependencies: undefined,
  build: {
    ...pkg.build,
    appId: `${pkg.build.appId}.demo`,
    productName: NAME,
    // node_modules 를 복사하지 않으므로 전자 버전을 직접 알려준다
    electronVersion: require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version,
    directories: { ...pkg.build.directories, output: path.join('..', 'dist') },
    win: { ...pkg.build.win, artifactName: `UCI-Registrar-DEMO-Setup-\${version}-${S}.\${ext}` },
    nsis: { ...pkg.build.nsis, shortcutName: NAME }
  }
}
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(demoPkg, null, 2) + '\n', 'utf8')

/* 4. 아이콘을 만들고 복사본을 굽는다 */
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
execFileSync('node', [path.join(ROOT, 'scripts', 'make-icon.js')], { cwd: ROOT, stdio: 'inherit' })
fs.cpSync(path.join(ROOT, 'build'), path.join(STAGE, 'build'), { recursive: true })
execFileSync(npx, ['electron-builder', '--win', '--x64', '--projectDir', STAGE], { cwd: ROOT, stdio: 'inherit' })

/* 5. 원본이 무사한지 확인하고 끝낸다. 여기서 걸리면 실제용 빌드가 오염된 것이다. */
const after = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (after.demo !== undefined || after.productName !== pkg.productName || !after.build || !after.scripts) {
  throw new Error('빌드 도중 저장소의 package.json 이 바뀌었다. 원본을 확인할 것.')
}
fs.rmSync(STAGE, { recursive: true, force: true })
console.log(`\n데모 설치 파일 완성 → dist/UCI-Registrar-DEMO-Setup-${pkg.version}-${S}.exe`)
