'use strict'

/*
 * 데모 빌드 여부.
 *
 * 평소에는 항상 false 다. scripts/build-demo.js 가 소스를 복사해 굽는 순간에만
 * package.json 의 demo 를 true 로 바꾼다. 그래서 이 저장소를 그냥 빌드하면
 * 언제나 실제 신청용 프로그램이 나온다 — 실수로 데모가 배포될 일이 없다.
 *
 * 데모에서는 국립중앙도서관 포털에 접속조차 하지 않는다. 판정을 한 곳에 모아 두고
 * 제공자 선택·설정 저장·화면 표시가 모두 이 값 하나만 보게 했다.
 */

let demo = false
try {
  demo = require('../../package.json').demo === true
} catch (err) {
  demo = false // package.json 을 못 읽으면 안전한 쪽(실제 모드)으로 둔다
}

module.exports = { IS_DEMO: demo }
