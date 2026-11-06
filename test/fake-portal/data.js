/* eslint-disable no-unused-vars -- 가짜 포털 화면(status.html·view.html)이 <script> 로 읽어 쓰는 전역 자료 */
/* 가짜 포털의 신청 현황 자료. status.html(목록)과 view.html(상세)이 같이 쓴다.
   줄: [키, 신청대상, 연재유형, 작품명, UCI, 최초신청일, 최근신청일, 최근발급일, 신청상태, 상세] */
const DETAIL_BASE = {
  publishForm: '연재형', ageGrade: 'AL', authors: [{ role: '글/그림', name: '홍길동' }], genres: ['드라마'],
  syndicateName: '네이버 웹툰', syndicateCode: 'NC', url: 'https://comic.naver.com/webtoon/list?titleId=1',
  priceKind: '연재가 회당', price: '300', currency: '원', currencyEtc: '원', serialStatus: '연재중'
}
const DATA = [
  ['k1', '웹툰', '연재형', '달빛 편의점', 'I410-ECN-0102-2026-620-000123456', '2026.10.02', '2026.10.02', '2026.10.06', '완료',
    { ...DETAIL_BASE, ageGrade: '15+', authors: [{ role: '글', name: '김글' }, { role: '그림', name: '이그림' }], genres: ['드라마', '일상'], priceKind: '연재가 회당', price: '500', currency: '직접입력', currencyEtc: '포인트', serialStatus: '완결' }],
  ['k2', '웹툰', '연재형', '옆집 강아지', '', '2026.10.14', '2026.10.14', '', '접수', { ...DETAIL_BASE, syndicateName: '카카오웹툰', syndicateCode: 'KB' }],
  ['k3', '웹툰', '연재형', '우리 동네 이야기', '', '2026.10.12', '2026.10.12', '', '보완요청', { ...DETAIL_BASE, info: { 처리내용: '작품 URL 을 확인할 수 없습니다. 접속 가능한 주소로 고쳐 주세요.' } }],
  // 실제 포털은 처리불가의 사유를 신청상태 칸에 괄호로 붙여 준다 (상세 화면의 처리내용은 비어 있음, 2026-10-22 확인)
  ['k4', '웹소설', '단행본', '반려된 작품', '', '2026.10.01', '2026.10.01', '', '처리불가 (등록자번호가 유효하지 않습니다.)', { ...DETAIL_BASE, publishForm: '단행본' }],
  ['k5', '웹툰', '연재형', '이미 있는 작품', 'I410-ECN-0102-2026-620-000999999', '2026.09.20', '2026.09.20', '2026.09.24', '완료', { ...DETAIL_BASE }]
]
for (let i = 6; i <= 12; i++) DATA.push(['k' + i, '웹툰', '연재형', '작품 ' + i, '', '2026.10.0' + (i % 9 + 1), '2026.10.0' + (i % 9 + 1), '', '접수', { ...DETAIL_BASE, authors: [{ role: '글/그림', name: '작가' + i }] }])
/* 같은 작품명·같은 최초신청일의 줄 둘 (한 작품을 두 번 신청). 서로 다른 줄로 읽혀야 한다. */
DATA.push(['k13', '웹툰', '연재형', '두 번 낸 작품', '', '2026.10.05', '2026.10.05', '', '접수', { ...DETAIL_BASE }])
DATA.push(['k14', '웹툰', '연재형', '두 번 낸 작품', '', '2026.10.05', '2026.10.11', '', '회차추가', { ...DETAIL_BASE }])
const STATUSES = ['접수', '재접수', '회차추가', '보완요청', '완료', '처리불가', '삭제']
