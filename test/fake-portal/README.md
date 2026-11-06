# 가짜 포털

포털 화면 자동입력(`src/main/providers/portal.js`)을 실제 포털 없이 끝까지 돌려 보기 위한 흉내 페이지다.
입력칸의 id·name, 버튼의 onclick, 알림 문구, 중복 확인 창, 현황 표의 열 순서를 `selectors.json` 과
폼 매핑 명세서에 적힌 실제 포털 구조와 같게 맞췄다. 시험(test/run.js)이 `selectors.json` 의 주소만
이 폴더의 파일로 바꿔 자동입력 모듈을 실행한다.

| 파일 | 흉내내는 화면 |
|---|---|
| login.html | 로그인 (`tester` / `good` 만 통과) |
| main.html, menu-webtoon.html | 로그인 뒤 첫 화면, 웹툰 신청 메뉴 (건별/일괄 갈래) |
| apply-webtoon.html | 건별 신청 폼 — 작가 줄 추가(`fn_addAuthor`), 검증 알림, 같은 작품명 중복 확인 창 |
| done.html | 접수 뒤 화면 (신청 폼이 사라진 상태) |
| status.html | UCI 신청 현황 — 상태 체크박스 필터, 작품명 검색(`schFld=WOR`), 쪽 넘김(`fn_egov_link_page`), 줄마다 키(`fn_goEdit('키','상태')`), `총 N건` |
| view.html | 신청 상세 — 머리(신청일·완료일·처리상태·처리내용)와 신청 폼 값 (작가 줄 여러 개, 장르, 연재처 코드, 가격, 연재상태) |
| data.js | 두 화면이 같이 쓰는 현황 자료 (14건) |
| bulk-pop.html | 일괄 신청 팝업 — 파일 첨부, 담당자, 중복 확인 창(popup2), 재업로드(`fn_apply_proc`) |
