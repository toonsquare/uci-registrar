'use strict'

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/**
 * 포털 연동 설정 파일(selectors.json) 관리.
 *
 * 설치된 프로그램의 내부 파일(app.asar)은 읽기 전용이라 손댈 수 없다.
 * 그래서 첫 실행 때 사용자 데이터 폴더로 한 벌 복사해 두고, 이후로는 그 사본만 읽는다.
 * 담당자가 메모장으로 열어 고치면 프로그램을 다시 설치하거나 빌드하지 않아도 바로 반영된다.
 *
 * Windows 기준 경로: %APPDATA%\UCI 등록 도우미\selectors.json
 */

/** 설치 파일 안에 들어 있는 기본값. 사용자 사본을 만들거나 되돌릴 때만 읽는다. */
const BUNDLED_PATH = path.join(__dirname, 'providers', 'selectors.json')

function userPath () {
  return path.join(app.getPath('userData'), 'selectors.json')
}

/**
 * 사용자 사본에 없는 항목만 기본값에서 채워 넣는다.
 *
 * 사용자가 이미 값을 넣어 둔 항목은 절대 건드리지 않는다. 프로그램이 새 버전으로 올라가면서
 * 설정 항목이 늘어났을 때, 그 항목만 조용히 추가하기 위한 것이다.
 *
 * 이게 없으면 사본은 첫 실행 때 모습 그대로 굳어버린다. 새 기능이 참조하는 설정이
 * 사본에 없어서 조용히 빈 값으로 동작하고, 화면에는 아무 이유도 안 나온다.
 *
 * @returns 추가된 항목의 경로 목록 (예: ['apply.accountFields'])
 */
function fillMissing (target, defaults, prefix = '') {
  const added = []
  for (const [key, value] of Object.entries(defaults)) {
    const at = prefix ? `${prefix}.${key}` : key

    if (!(key in target)) {
      target[key] = JSON.parse(JSON.stringify(value))
      added.push(at)
      continue
    }
    // 양쪽 다 평범한 객체일 때만 더 들어간다. 배열이나 값은 사용자 것을 그대로 둔다.
    const bothPlainObjects =
      value && typeof value === 'object' && !Array.isArray(value) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    if (bothPlainObjects) added.push(...fillMissing(target[key], value, at))
  }
  return added
}

/**
 * 사용자 사본을 준비한다.
 * 없으면 기본값에서 새로 만들고, 있으면 빠진 항목만 채워 넣는다.
 */
function ensureSeeded () {
  const target = userPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })

  if (!fs.existsSync(target)) {
    fs.copyFileSync(BUNDLED_PATH, target)
    return { created: true, added: [], path: target }
  }

  const user = tryRead(target)
  if (!user) {
    // 깨져 있으면 여기서 손대지 않는다. load() 가 보관·복구를 처리한다.
    return { created: false, added: [], path: target, unreadable: true }
  }

  const defaults = JSON.parse(fs.readFileSync(BUNDLED_PATH, 'utf8'))
  const added = fillMissing(user, defaults)
  if (added.length) {
    fs.writeFileSync(target, JSON.stringify(user, null, 2), 'utf8')
  }
  return { created: false, added, path: target }
}

/** 읽어서 파싱까지 되면 돌려주고, 안 되면 null. */
function tryRead (file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 설정을 읽는다.
 * 사용자가 직접 고치는 파일이라 JSON 문법이 깨질 수 있다. 그때는 어디가 문제인지 알 수 있는
 * 오류를 던져서, 조용히 무시되는 대신 화면에 사유가 뜨도록 한다.
 */
function load () {
  ensureSeeded()
  const target = userPath()
  let raw
  try {
    raw = fs.readFileSync(target, 'utf8')
  } catch (e) {
    throw new Error(`설정 파일을 읽지 못했습니다 (${target}): ${e.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`설정 파일의 형식이 올바르지 않습니다: ${e.message}`)
  }
}

/** 화면에 보여줄 용도. 문제가 있으면 사유를 돌려주고, 없으면 null. */
function validationError () {
  try {
    load()
    return null
  } catch (e) {
    return e.message
  }
}

/** 사용자 사본을 기본값으로 되돌린다. 잘못 고쳐서 꼬였을 때 쓰는 탈출구다. */
function resetToDefault () {
  const target = userPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(BUNDLED_PATH, target)
  return target
}

module.exports = { BUNDLED_PATH, userPath, ensureSeeded, load, validationError, resetToDefault }
