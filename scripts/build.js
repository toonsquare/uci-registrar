'use strict'

/*
 * 실제용 설치 파일을 만든다.
 *   npm run build:win   Windows (.exe). 빌드 대상은 Windows 64비트 하나뿐이다.
 *
 * 하는 일은 electron-builder 를 부르는 것뿐이고, 파일명에 빌드 시각만 덧붙인다.
 * 데모는 별도다 — scripts/build-demo.js 를 볼 것.
 */

const path = require('node:path')
const { execFileSync } = require('node:child_process')
const stamp = require('./stamp')

const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const name = `UCI-Registrar-Setup-${pkg.version}-${stamp()}.\${ext}`

execFileSync('node', [path.join(__dirname, 'make-icon.js')], { cwd: ROOT, stdio: 'inherit' })
execFileSync(npx, [
  'electron-builder',
  '--win', '--x64',
  `--config.win.artifactName=${name}`
], { cwd: ROOT, stdio: 'inherit' })

console.log(`\n설치 파일 완성 → dist/${name.replace('${ext}', 'exe')}`)
