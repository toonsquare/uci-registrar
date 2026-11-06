/* =========================================================================
   포털에서 확인한 선택 목록들.

   메인 프로세스와 화면 양쪽에서 같은 값을 써야 하므로 한 파일에 모아두고,
   require 로도 <script> 태그로도 읽을 수 있게 했다.
   근거는 폼 매핑 명세서 에 있다. (2026-08-03 실제 화면 확인)
   ========================================================================= */

(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.UCI = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  /** 웹콘텐츠 유형. 포털에서는 신청 화면 주소가 아예 다르다. */
  const CONTENT_TYPES = [
    { value: 'webtoon', label: '웹툰', menu: 'S90202000000' },
    { value: 'webnovel', label: '웹소설', menu: 'S90203000000' }
  ]

  /** 발행형태구분 (publishFormCode) — 포털 select 의 값과 글자까지 같아야 한다. */
  const PUBLISH_FORMS = ['연재형', '단행본']

  /** 연재상태 (serialStatus) — 라디오 값 */
  const SERIAL_STATUS = ['연재중', '휴재', '완결', '연재전']

  /** 작가역할 (writerroleName) */
  /*
   * 포털 신청 화면(#writerroleName)의 선택지와 글자까지 같아야 한다.
   * '글그림' 처럼 슬래시를 빼면 그 칸이 빈 채로 제출되어 포털이 거부한다.
   * 일괄 신청 엑셀 양식도 같은 표기를 쓴다.
   */
  const WRITER_ROLES = ['글/그림', '글', '그림']

  /**
   * 연령등급 (ageGrade).
   *
   * 2026-10-15 파트너 실증에서 포털이 "연령등급을 선택하세요" 로 건별 신청을 거부했다.
   * 2026-08-03 조사 때는 포털 검증 코드의 필수 항목이 아니어서 화면에 넣지 않았던 칸이다.
   *
   *   value  이 프로그램이 저장·내보내는 값. 건별 폼 #ageGrade 선택지의 value 이자 일괄 양식 11열의 표기다.
   *          (2026-10-15 포털에서 확인: value AL·12+·15+·18+, 화면 글자 전체·12+·15+·18세 이상)
   *   portal 건별 폼에서 보이는 글자. value 로 못 찾을 때 fillSelect 가 이 글자로도 찾는다.
   */
  const AGE_GRADES = [
    { value: 'AL', label: '전체 이용가', portal: '전체' },
    { value: '12+', label: '12세 이상', portal: '12+' },
    { value: '15+', label: '15세 이상', portal: '15+' },
    { value: '18+', label: '18세 이상', portal: '18세 이상' }
  ]

  /** 장르 (genre) — 체크박스 25종, 복수 선택. value 와 표시 문구가 같다. */
  const GENRES = [
    'BL', 'GL', 'SF', '감성', '개그', '드라마', '로맨스/순정', '로판', '무협',
    '성인', '소년', '스릴러/공포', '스토리', '스포츠', '썰', '액션', '에피소드',
    '역사', '옴니버스', '일본/해외', '일상', '판타지', '학원', '히어로', '기타'
  ]

  /**
   * 연재처 (syndicateName + syndicateCode).
   *
   * 포털에서는 팝업으로 고르게 되어 있고 입력칸이 readonly 다.
   * 자동화에서는 이름과 코드를 함께 직접 넣는다.
   */
  const SYNDICATES = [
    { code: 'NC', name: '네이버 웹툰' },
    { code: 'NB', name: '네이버 웹소설' },
    { code: 'NA', name: '네이버 시리즈' },
    { code: 'KB', name: '카카오웹툰' },
    { code: 'KC', name: '카카오페이지' },
    { code: 'RA', name: '리디' },
    { code: 'NE', name: '노벨피아' },
    { code: 'LB', name: '레진코믹스' },
    { code: 'JA', name: '조아라' },
    { code: 'TA', name: '탑툰' },
    { code: 'BA', name: '봄툰' },
    { code: 'MD', name: '문피아' }
  ]

  /** 가격 구분 (priceCharacter) */
  const PRICE_KINDS = ['연재가 회당', '연재가 권당', '비매품 무료', '합산가']

  /** 가격 단위 (currencyCode) */
  /* 포털 #currencyCode 의 선택지. '직접입력' 을 고르면 #currencyCodeEtc 칸이 나타난다. */
  const CURRENCIES = ['원', '코인', '쿠키', '직접입력']

  /** 결과 안내방법 (ReceiveMethod) */
  const RECEIVE_METHODS = [
    { value: 'handphone', label: '문자(휴대폰)' },
    { value: 'email', label: '이메일' }
  ]

  /** 프로그램 상태 ↔ 포털 신청상태 글자. 현황 조회의 상태 필터와 대시보드 건수가 쓴다. */
  const PORTAL_STATUS_GROUPS = {
    pending: ['접수', '재접수', '회차추가'],
    needsFix: ['보완요청'],
    issued: ['완료'],
    rejected: ['처리불가', '삭제']
  }

  /**
   * 포털의 신청상태 → 이 프로그램의 상태.
   * 포털 값: 접수 / 재접수 / 회차추가 / 보완요청 / 완료 / 처리불가 / 삭제
   */
  /**
   * 포털 현황의 신청상태 칸은 「처리불가 (사유 …)」 처럼 상태 글자 뒤에 괄호로 처리내용을 붙여 준다 (2026-10-22 확인.
   * 처리불가 건의 상세 화면에는 처리내용이 비어 있고, 사유는 이 칸에만 있다). 상태 글자와 사유를 나눈다.
   * @returns { status, note }  예: '처리불가 (중복신청)' → { status: '처리불가', note: '중복신청' }
   */
  function splitPortalStatus (text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim()
    const m = s.match(/^([^(（]+?)\s*[(（]([\s\S]*)[)）]\s*$/)
    if (!m) return { status: s, note: '' }
    return { status: m[1].trim(), note: m[2].trim() }
  }

  function mapPortalStatus (text) {
    const s = String(text || '')
    if (/완료/.test(s)) return 'issued'
    if (/처리불가|삭제/.test(s)) return 'rejected'
    if (/보완요청/.test(s)) return 'needsFix'
    if (/접수|재접수|회차추가/.test(s)) return 'pending'
    return 'pending'
  }

  /**
   * 담당자 휴대폰번호를 포털이 받는 형식으로 맞춘다.
   *
   * 포털 검증: /^\d{3}-\d{3,4}-\d{4}$/ 이면서 '01' 로 시작해야 한다.
   * 하이픈 없이 넣으면 "형식이 올바르지 않습니다" 로 거부되므로 저장할 때 미리 붙여준다.
   */
  function formatMobile (raw) {
    const digits = String(raw || '').replace(/\D/g, '')
    if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    return String(raw || '').trim()
  }

  /** 포털이 실제로 통과시키는지 같은 규칙으로 확인한다. */
  function isValidMobile (value) {
    return /^\d{3}-\d{3,4}-\d{4}$/.test(String(value || '')) && String(value).startsWith('01')
  }


  /**
   * 설정 화면의 '고급 설정' 을 보여줄지.
   *
   * 연동 방식·설정 파일·저장 위치처럼 잘못 건드리면 신청이 조용히 안 되는 항목들이다.
   * 일반 담당자가 볼 일이 없어 감춰 둔다. (예: 발급 모드를 모의로 바꾸면 신청한 줄 알았는데
   * 포털에는 아무것도 안 간다)
   *
   * 감춰도 기능은 살아 있다. 포털 개편 등으로 연동을 손봐야 하면 이 값을 true 로 바꾸거나,
   * %APPDATA%\UCI 등록 도우미\selectors.json 을 메모장으로 직접 고치면 된다.
   */
  const SHOW_ADVANCED_SETTINGS = false


  /**
   * 신청 폼 항목별 안내 문구. 항목 제목에 마우스를 올리면 뜬다.
   *
   * 문구는 'UCI_신청양식_툴팁_안내문구' 문서에서 가져왔다. 다만 선택지 이름은
   * 문서와 실제 화면이 다른 곳이 있어 화면 쪽에 맞췄다.
   *   - 연재유형: 문서 '단행본형' → 화면 '단행본'
   *   - 가격구분: 문서 '단행본 권당' → 화면 '연재가 권당'
   *   - 연재처:   문서는 '기타' 선택을 안내하지만 목록에 그런 항목이 없다
   */
  const TOOLTIPS = {
    contentType: '웹툰과 웹소설 중 작품 형태를 선택하세요.',
    publishForm: "회차별로 올리면 '연재형', 한 번에 완결로 올리면 '단행본'을 선택하세요.",
    title: '연재처에 등록된 정식 제목을 그대로 입력하세요. 부제·시즌 표기는 제외합니다.',
    writer: "한 줄에 한 사람씩, 역할과 연재처에 표시되는 필명을 넣으세요. 글과 그림을 한 사람이 맡으면 '글/그림', 글 작가와 그림 작가가 다르면 「작가 추가」로 줄을 늘려 각각 넣으세요.",
    ageGrade: "작품의 열람 연령등급입니다. 연재처에 표시된 등급을 그대로 고르세요. 15세 이상 작품은 반드시 맞게 넣어야 합니다.",
    syndicate: '작품이 실제로 서비스되는 플랫폼을 선택하세요.',
    serialStatus: "회차가 올라오고 있으면 '연재중', 마무리됐으면 '완결', 쉬는 중이면 '휴재', 아직 시작 전이면 '연재전'을 선택하세요.",
    url: '작품 목록 페이지 주소를 붙여 넣으세요. UCI를 조회하면 이 주소로 연결됩니다.',
    episodes: 'UCI를 발급할 첫 회차와 마지막 회차를 입력하세요. 한 번에 최대 300화까지 신청할 수 있습니다.',
    genres: '작품에 해당하는 장르를 모두 선택하세요. 연재처에 표기된 장르를 기준으로 하면 됩니다.',
    priceKind: "회차 단위로 판매하면 '연재가 회당', 권 단위면 '연재가 권당', 무료 작품이면 '비매품 무료', 여러 회차를 합친 가격이면 '합산가'를 선택하세요.",
    price: "한 회차(또는 한 권)의 판매 가격을 숫자만 입력하세요. 무료면 0을 넣고 구분을 '비매품 무료'로 두세요.",
    currencyEtc: "목록에 없는 단위를 직접 적으세요. (예: 포인트, 캐시)"
  }

  /**
   * 작가 목록 — 한 줄에 한 사람(역할 + 이름).
   * 포털 신청 폼은 작가 줄을 여러 개 받고 서버에는 목록으로 넘어간다 (2026-10-16 확인). 글 작가와 그림 작가가
   * 다르면 두 줄이어야 한다. 예전 기록은 writerRole/writer 한 쌍만 있으므로 그것을 한 줄로 본다.
   * 이름이 빈 줄은 뺀다.
   */
  function authorsOf (meta) {
    const list = Array.isArray(meta?.authors) ? meta.authors : []
    const rows = list
      .map((a) => ({ role: String(a?.role || '').trim(), name: String(a?.name || '').trim() }))
      .filter((a) => a.name)
    if (rows.length) return rows
    const name = String(meta?.writer || '').trim()
    return name ? [{ role: String(meta?.writerRole || '').trim(), name }] : []
  }

  function isValidEmail (value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''))
  }

  /**
   * 작품 URL 에 http(s):// 가 없으면 https:// 를 붙인다. 주소창에서 복사하다 앞부분을 빼먹는 일이 많아,
   * 거부하는 대신 채워 준다. 빈 값과 이미 규격(scheme://)이 있는 값은 그대로 둔다.
   */
  function normalizeUrl (value) {
    const v = String(value ?? '').trim()
    if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v
    return 'https://' + v.replace(/^\/+/, '')
  }

  /** 숫자만 받는 칸의 값인지. 앞뒤 공백을 뺀 뒤 0 이상의 정수여야 한다. 'e'·'.'·'-'·한글 단위가 섞이면 거짓. */
  function isDigits (value) {
    return /^\d+$/.test(String(value ?? '').trim())
  }

  /**
   * 형식(자료형) 오류를 찾는다 — 숫자 칸에 글자가 들어온 것처럼, 포털에 보내면 거부되거나 엉뚱하게 저장될 값.
   * 빈 칸은 보지 않는다. 필수 여부는 따로 본다. 화면은 입력 시점에, 본체는 보내기 직전에 같은 함수로 거른다 (SFR-002).
   * @returns {{ field: string, message: string } | null} 처음 발견한 오류. 없으면 null
   */
  function typeProblem (meta) {
    const m = meta || {}
    const raw = (k) => String(m[k] ?? '').trim()
    const shown = (k) => `(입력값: "${raw(k).slice(0, 20)}")`
    if (raw('price') && !isDigits(m.price)) return { field: 'price', message: `가격은 숫자만 입력하세요. 무료면 0 을 넣으세요. ${shown('price')}` }
    for (const [k, label] of [['episodeStart', '회차 시작번호'], ['episodeEnd', '회차 끝번호']]) {
      if (raw(k) && !isDigits(m[k])) return { field: k, message: `${label}는 숫자만 입력하세요. (예: 12) ${shown(k)}` }
    }
    if (raw('url') && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(normalizeUrl(m.url))) return { field: 'url', message: `작품 URL 형식이 올바르지 않습니다. 예) https://comic.naver.com/webtoon/list?titleId=1234 ${shown('url')}` }
    if (raw('managerMobile') && !isValidMobile(m.managerMobile)) return { field: 'managerMobile', message: '담당자 휴대폰번호 형식이 올바르지 않습니다. (예: 010-1234-5678)' }
    if (raw('managerEmail') && !isValidEmail(m.managerEmail)) return { field: 'managerEmail', message: '담당자 이메일 형식이 올바르지 않습니다.' }
    return null
  }

  /** 이력 한 쪽에 보여 줄 건수 선택지. 포털 「UCI 조회/정정」 화면의 작품개수(10·20·50·100)와 같다 (2026-10-21 확인). */
  const HISTORY_PAGE_SIZES = [10, 20, 50, 100]

  return {
    SHOW_ADVANCED_SETTINGS,
    TOOLTIPS,
    AGE_GRADES,
    HISTORY_PAGE_SIZES,
    authorsOf,
    formatMobile,
    isValidMobile,
    isValidEmail,
    isDigits,
    normalizeUrl,
    typeProblem,
    CONTENT_TYPES,
    PUBLISH_FORMS,
    SERIAL_STATUS,
    WRITER_ROLES,
    GENRES,
    SYNDICATES,
    PRICE_KINDS,
    CURRENCIES,
    RECEIVE_METHODS,
    mapPortalStatus,
    splitPortalStatus,
    PORTAL_STATUS_GROUPS
  }
})
