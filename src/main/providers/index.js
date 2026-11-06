'use strict'

const store = require('../store')
const { IS_DEMO } = require('../../shared/app-mode')
const { assertProvider, OPERATIONS } = require('./interface')
const mock = assertProvider(require('./mock'), 'mock')
const portal = assertProvider(require('./portal'), 'portal')
const api = assertProvider(require('./api'), 'api')

/**
 * 설정의 mode 값에 따라 실제 사용할 연동 모듈을 골라준다.
 *
 *   'portal'  국립중앙도서관 포털 화면 자동입력 (기본)
 *   'mock'    연습·데모용 모의 연동
 *   'api'     국립중앙도서관 API 연동 자리 — 규격 미제공으로 아직 비어 있다
 *
 * 세 구현은 providers/interface.js 의 동작 목록을 똑같이 갖는다 (불러올 때 확인한다).
 * 덕분에 화면과 IPC 계층은 지금이 어느 연동인지 알 필요가 없고, API 가 개통되면 api.js 만 채우고
 * 설정을 'api' 로 바꾸면 된다.
 */
function current () {
  // 데모 빌드는 설정값과 무관하게 언제나 모의다. 포털에 접속할 경로 자체를 없앤다.
  if (IS_DEMO) return mock
  const mode = store.getSettings().mode
  if (mode === 'api') return api
  return mode === 'portal' ? portal : mock
}

module.exports = { current, mock, portal, api, OPERATIONS }
