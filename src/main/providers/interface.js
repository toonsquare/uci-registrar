'use strict'

/**
 * 연동 모듈(제공자) 인터페이스.
 *
 * 화면과 IPC 계층은 이 인터페이스만 보고 동작한다. 지금 구현은 셋이다.
 *   mock.js    연습·데모용 모의 연동. 포털에 접속하지 않는다.
 *   portal.js  국립중앙도서관 포털 화면 자동입력. 내장 브라우저로 포털 폼을 채워 포털의 신청 버튼을 누른다.
 *   api.js     국립중앙도서관 API 연동 자리. API 규격이 제공되지 않아 아직 비어 있다 (모든 동작이 '미개통' 응답).
 *
 * 어느 구현을 쓸지는 설정의 mode('portal' | 'mock' | 'api') 로 고른다 (providers/index.js).
 * API 가 개통되면 api.js 와 api.json 을 채우고 mode 를 'api' 로 바꾸면 된다. 화면·이력·시험은 손댈 것이 없다.
 *
 * 모든 동작은 예외를 던지지 않고 { ok, error? } 로 답한다.
 */

/** 구현이 반드시 가져야 하는 동작. 이름 · 입력 · 출력. */
const OPERATIONS = [
  { name: 'login', input: '{ loginId, password }', output: '{ ok, user: { loginId, name, orgName, orgCode }, error? }' },
  { name: 'logout', input: '()', output: '{ ok }' },
  { name: 'getSession', input: '()', output: 'user | null  (로그인돼 있으면 사용자, 아니면 null)' },
  { name: 'verifyAccess', input: '()', output: '{ ok, account?: { registrantNo, registrantName, productionCompanyCode }, error? }  (등록자번호 보유 확인)' },
  { name: 'apply', input: 'meta (작품 정보 + 담당자 정보 + rightsAgreed, forceNew?)', output: '{ ok, appliedAt?, status?, notice?, duplicate?, error? }' },
  { name: 'applyBulk', input: 'items (meta[])', output: '{ ok, appliedAt?, status?, count?, duplicate?, workName?, error? }' },
  { name: 'checkStatus', input: 'record (이력 한 건)', output: '{ ok, status?, uci?, issuedAt?, reason?, portalStatus?, checkedAt?, error? }' },
  { name: 'listApplications', input: '{ page?, statuses?, query? }  (쪽 번호 1부터 · 포털 상태 글자 목록 · 작품명 검색어)', output: '{ ok, items: { portalKey, contentType, publishForm, title, uci, appliedAt, lastAppliedAt, issuedAt, portalStatus }[], total, page, pageSize, pages, error? }' },
  { name: 'countApplications', input: '{ statuses }  (포털 상태 글자 목록)', output: '{ ok, total, error? }  (그 상태들만 체크해 검색한 건수)' },
  { name: 'getApplicationDetail', input: '{ portalKey }', output: '{ ok, detail: { title, publishForm, ageGrade, authors, genres, syndicateName, syndicateCode, url, priceKind, price, currency, currencyEtc, serialStatus, info }, error? }' },
  { name: 'getApplicationDetails', input: '{ portalKeys, onProgress? }  (포털 키 목록 · 진행 알림 ({ done, total, title }))', output: '{ ok, results: { [portalKey]: { ok, detail?, error? } }, error? }' },
  { name: 'getIssuedEpisodes', input: '{ portalKeys }  (발급된 건의 포털 키 목록)', output: '{ ok, episodes: { [uci]: { start, end } }, error? }' },
  { name: 'lookup', input: 'uci', output: '{ ok, record?, error? }' }
]

/** 구현이 인터페이스를 다 갖췄는지 확인한다. 빠진 동작이 있으면 어떤 것인지 알려 주며 멈춘다. */
function assertProvider (impl, name) {
  const missing = OPERATIONS.filter((op) => typeof impl?.[op.name] !== 'function').map((op) => op.name)
  if (missing.length) throw new Error(`연동 모듈 '${name}' 에 빠진 동작: ${missing.join(', ')}`)
  return impl
}

module.exports = { OPERATIONS, assertProvider }
