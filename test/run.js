'use strict'

/*
 * 메인 프로세스 점검.  실행: npm test
 *
 * Electron 위에서 돌린다. store 가 app.getPath('userData') 를 쓰고 safeStorage 로 자격증명을
 * 암호화하기 때문에, 순수 Node 로는 같은 조건을 만들 수 없다.
 *
 * 이 시험은 절대 실제 포털에 접속하지 않는다. 포털 제공자를 건드리는 구간은 configured 를
 * 내려서 차단 여부만 확인한다.
 */

const { app, BrowserWindow } = require('electron')
// 시험 도중 만든 창(중복 확인 창 가로채기 시험)이 닫히면 Electron 기본 동작은 앱을 끝낸다.
// 그러면 남은 그룹이 종료 중에 돌아 Windows 에서는 크래시(exit -36861), macOS 에서는 간헐 SIGSEGV 가 났다.
// 종료는 마지막의 app.exit 만 한다.
app.on('window-all-closed', () => {})
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'main')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uci-test-'))
app.setPath('userData', TMP)

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`) }
}
const group = (title) => console.log(`\n[${title}]`)

/** store 를 모듈 캐시에서 떼어내 '앱 재실행'을 흉내낸다. */
const relaunchStore = () => {
  delete require.cache[require.resolve(path.join(SRC, 'store'))]
  return require(path.join(SRC, 'store'))
}

app.whenReady().then(async () => {
  const store = require(path.join(SRC, 'store'))
  const csv = require(path.join(SRC, 'csv'))
  const C = require(path.join(ROOT, 'src', 'shared', 'uci-constants'))
  const mock = require(path.join(SRC, 'providers', 'mock'))
  const providers = require(path.join(SRC, 'providers'))
  const selectorConfig = require(path.join(SRC, 'selector-config'))
  const { addBusinessDays } = require(path.join(SRC, 'business-days'))
  const dataFile = path.join(TMP, 'uci-data.json')

  /* ------------------------------------------------------------ 설정 기본값 */
  group('갓 설치한 상태의 기본값')
  /*
   * 새 PC 에서 처음 켰을 때 어느 모드인지가 중요하다. 연습용이 기본이면
   * 담당자가 신청한 줄 알았는데 포털에는 아무것도 안 간 상태가 된다.
   */
  check('기본 모드는 실제 포털', store.getSettings().mode === 'portal', store.getSettings().mode)
  check('자동화 창은 숨김', store.getSettings().showAutomationWindow === false)
  check('담당자 정보는 비어 있음', store.getSettings().managerName === '')
  check('개인정보 동의는 미체크', store.getSettings().privacyAgreed === false)
  check('처음 안내를 아직 안 봤다', store.getSettings().onboardingDone === false)

  /* ---------------------------------------------------------------- 저장소 */
  group('저장소 — 설정·이력')
  check('설정 저장/조회', store.setSettings({ orgName: '툰스퀘어' }).orgName === '툰스퀘어')
  check('파일에 남는다', fs.readFileSync(dataFile, 'utf8').includes('툰스퀘어'))

  store.addRecord({ uci: 'A-1', title: '가나다', writer: '홍길동', status: 'issued', appliedAt: new Date().toISOString() })
  store.addRecord({ uci: '', title: '실패건', writer: '김보라', status: 'failed', error: 'x', appliedAt: new Date().toISOString() })
  check('전체 조회', store.listRecords().length === 2)
  // 이력은 포털이 원본이라 파일에 쓰지 않는다. 로그인마다 새로 읽는다 (2026-10-22).
  check('이력은 파일에 남지 않는다', (() => { const raw = fs.readFileSync(dataFile, 'utf8'); return !raw.includes('가나다') && !('records' in JSON.parse(raw)) })())
  check('작품명 검색', store.listRecords({ query: '가나다' }).length === 1)
  check('작가명 검색', store.listRecords({ query: '김보라' }).length === 1)
  check('상태 필터', store.listRecords({ status: 'failed' }).length === 1)
  check('최신 건이 맨 앞', store.listRecords()[0].title === '실패건')
  check('개별 삭제', store.deleteRecord(store.listRecords()[0].id) && store.listRecords().length === 1)
  check('없는 id 삭제는 false', store.deleteRecord('nope') === false)

  store.clearRecords()
  store.addRecord({ title: 'p', status: 'pending' })
  store.addRecord({ title: 'n', status: 'needsFix' })
  store.addRecord({ title: 'i', status: 'issued' })
  // 보완요청은 담당자가 포털에서 고치면 다시 심사로 넘어가므로 계속 추적해야 한다.
  check('조회 대상은 심사중 + 보완요청', store.pendingRecords().length === 2, store.pendingRecords().map((r) => r.status))
  check('통계에 보완요청 집계', store.stats().needsFix === 1)
  store.clearRecords()

  group('저장소 — 연습 기록 걷어내기')
  {
    store.clearRecords()
    store.addRecord({ title: '진짜', status: 'pending', mode: 'portal' })
    store.addRecord({ title: '연습1', status: 'issued', mode: 'mock' })
    store.addRecord({ title: '연습2', status: 'pending', mode: 'mock' })
    // 연습 기록이 실제 이력에 섞이면 '이거 진짜 신청한 건가' 헷갈린다.
    check('연습(mock) 기록만 지운다', store.removeRecords((r) => r.mode === 'mock') === 2)
    check('실제 기록은 남는다', store.listRecords().length === 1 && store.listRecords()[0].title === '진짜')
    check('지울 게 없으면 0', store.removeRecords((r) => r.mode === 'mock') === 0)
    store.clearRecords()
  }

  group('저장소 — 자격증명')
  store.saveCredential('tooning', 'p@ss워드')
  const cred = store.getCredential()
  check('저장 후 복호화', cred?.loginId === 'tooning' && cred?.password === 'p@ss워드')
  check('디스크에 평문 비밀번호 없음', !fs.readFileSync(dataFile, 'utf8').includes('p@ss워드'))
  store.clearCredential()
  check('삭제', store.getCredential() === null)

  group('저장소 — 휴대폰 형식 (포털 규칙)')
  check('저장 시 하이픈을 붙인다', store.setSettings({ managerMobile: '01099998888' }).managerMobile === '010-9999-8888')

  /* ------------------------------------------------------ 데이터 손실 방지 */
  group('데이터 손실 방지 — 손상 + 백업 있음')
  {
    let s = relaunchStore()
    s.setSettings({ registrantNo: 'R-1', mode: 'portal', managerName: '홍길동' })
    s.setSettings({ orgName: '툰스퀘어' })   // 두 번 저장해야 .bak 에 앞 저장본이 남는다

    // 저장 도중 강제 종료를 흉내내 파일을 중간에서 자른다.
    const whole = fs.readFileSync(dataFile, 'utf8')
    fs.writeFileSync(dataFile, whole.slice(0, Math.floor(whole.length / 2)))

    s = relaunchStore()
    check('손상을 감지해 사유를 알려준다', !!s.getHealth().error, s.getHealth().error)
    check('손상된 원본을 보관한다', fs.readdirSync(TMP).some((f) => f.includes('corrupt')))
    check('직전 저장본으로 설정을 되살린다', s.getSettings().registrantNo === 'R-1' && s.getSettings().managerName === '홍길동', s.getSettings())
    check('복구했으므로 저장은 계속 가능', s.getHealth().readOnly === false)
    check('이력은 파일에 없으므로 비어서 시작한다', s.listRecords().length === 0)

    // 예전에는 이 한 번의 저장이 원본을 비운 상태로 덮어써서 설정이 사라졌다.
    s.setSettings({ theme: 'dark' })
    check('저장 후에도 설정 유지', JSON.parse(fs.readFileSync(dataFile, 'utf8')).settings.registrantNo === 'R-1')
  }

  group('데이터 손실 방지 — 손상 + 백업 없음')
  {
    fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true })
    let s = relaunchStore()
    s.setSettings({ registrantNo: 'R-2' })
    fs.rmSync(s.backupPath(), { force: true })
    const broken = '{"records": [{"title":'
    fs.writeFileSync(dataFile, broken)

    s = relaunchStore()
    check('되살릴 백업이 없으면 저장을 막는다', s.getHealth().readOnly === true)
    s.setSettings({ theme: 'dark' })
    check('원본을 덮어쓰지 않는다', fs.readFileSync(dataFile, 'utf8') === broken)
  }

  group('데이터 손실 방지 — 정상 동작')
  {
    fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true })
    let s = relaunchStore()
    s.setSettings({ registrantNo: 'R-3' })
    check('임시 파일을 남기지 않는다', !fs.existsSync(`${dataFile}.tmp`))
    s = relaunchStore()
    check('멀쩡한 파일에는 경고가 없다', s.getHealth().error === null, s.getHealth().error)
    check('첫 실행에도 경고가 없다', (() => {
      fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true })
      return relaunchStore().getHealth().error === null
    })())
  }
  relaunchStore()

  /* ------------------------------------------------------------------ CSV */
  group('CSV 내보내기')
  {
    const out = csv.stringify([{ a: '값,콤마', b: '따"옴', c: '줄\n바꿈' }],
      [{ key: 'a', label: '가' }, { key: 'b', label: '나' }, { key: 'c', label: '다' }])
    check('엑셀용 BOM 을 붙인다', out.startsWith('﻿'))
    check('특수문자를 인용한다', out.includes('"값,콤마"') && out.includes('"따""옴"'))
    const back = csv.parseWithHeader(out)
    check('내보낸 파일이 그대로 다시 읽힌다',
      back.items[0].가 === '값,콤마' && back.items[0].나 === '따"옴' && back.items[0].다 === '줄\n바꿈', back.items[0])
  }

  /* ------------------------------------------------------------ 업무일 계산 */
  group('처리예정일 — 업무일 3일')
  {
    const day = (iso) => new Date(iso).getDay()
    // 목요일 신청 → 금·월·화 = 다음 주 화요일
    check('주말을 건너뛴다', addBusinessDays('2026-07-30T10:00:00Z', 3).slice(0, 10) === '2026-08-04',
      addBusinessDays('2026-07-30T10:00:00Z', 3).slice(0, 10))
    check('결과가 주말에 걸리지 않는다',
      [0, 1, 2, 3, 4, 5, 6].every((i) => ![0, 6].includes(day(addBusinessDays(new Date(2026, 7, 3 + i, 10), 3)))))
  }

  /* -------------------------------------------------------------- 상수 목록 */
  group('포털에서 확인한 목록')
  check('장르 25종', C.GENRES.length === 25, C.GENRES.length)
  check('연재처 12곳', C.SYNDICATES.length === 12, C.SYNDICATES.length)
  check('연재처 코드 중복 없음', new Set(C.SYNDICATES.map((x) => x.code)).size === 12)
  check('연재상태 4종', C.SERIAL_STATUS.length === 4)

  /*
   * 아래 목록은 2026-09-10 실제 신청 화면에서 확인한 값이다.
   * 선택지 글자가 하나라도 다르면 그 칸이 빈 채로 제출되어 포털이 거부한다.
   * 화면에서 값을 바꿀 일이 있으면 반드시 포털을 다시 확인하고 여기도 같이 고칠 것.
   */
  check('연재유형이 포털과 같다',
    JSON.stringify(C.PUBLISH_FORMS) === JSON.stringify(['연재형', '단행본']), C.PUBLISH_FORMS)
  check('가격구분이 포털과 같다',
    JSON.stringify(C.PRICE_KINDS) === JSON.stringify(['연재가 회당', '연재가 권당', '비매품 무료', '합산가']), C.PRICE_KINDS)
  check('연재처 목록에 기타가 없다', !C.SYNDICATES.some((x) => x.name === '기타'))
  check('가격단위가 포털과 같다',
    JSON.stringify(C.CURRENCIES) === JSON.stringify(['원', '코인', '쿠키', '직접입력']), C.CURRENCIES)
  check('연재처 코드가 포털과 같다',
    C.SYNDICATES.find((x) => x.name === '네이버 웹툰')?.code === 'NC' &&
    C.SYNDICATES.find((x) => x.name === '리디')?.code === 'RA')
  // 포털 선택지와 글자까지 같아야 한다. 슬래시를 빼면 그 칸이 비어 제출되고 거부당한다.
  check('작가역할 표기가 포털과 같다',
    JSON.stringify(C.WRITER_ROLES) === JSON.stringify(['글/그림', '글', '그림']), C.WRITER_ROLES)
  // 저장값은 일괄 양식 11열의 표기와 같아야 한다 (양식 안내: "AL: 전체이용가, 12+, 15+, 18+").
  check('연령등급 저장값이 일괄 양식 표기와 같다',
    JSON.stringify(C.AGE_GRADES.map((g) => g.value)) === JSON.stringify(['AL', '12+', '15+', '18+']), C.AGE_GRADES)
  check('연령등급마다 포털 선택지 표기가 있다', C.AGE_GRADES.every((g) => g.portal && g.label))
  check('이력 한 쪽 건수 선택지는 포털 조회 화면의 작품개수와 같다', JSON.stringify(C.HISTORY_PAGE_SIZES) === '[10,20,50,100]', C.HISTORY_PAGE_SIZES)

  group('작가 목록 (한 줄에 한 사람)')
  check('authors 가 있으면 이름 있는 줄만', JSON.stringify(C.authorsOf({ authors: [{ role: '글', name: '홍길동' }, { role: '그림', name: ' ' }, { role: '그림', name: '김그림' }] })) === JSON.stringify([{ role: '글', name: '홍길동' }, { role: '그림', name: '김그림' }]))
  check('예전 기록(writerRole/writer)은 한 줄로', JSON.stringify(C.authorsOf({ writerRole: '글/그림', writer: '홍길동' })) === JSON.stringify([{ role: '글/그림', name: '홍길동' }]))
  check('작가가 없으면 빈 목록', C.authorsOf({}).length === 0 && C.authorsOf({ authors: [] , writer: '' }).length === 0)

  group('포털 상태 → 프로그램 상태')
  check('완료 = 발급완료', C.mapPortalStatus('완료') === 'issued')
  check('접수 = 심사중', C.mapPortalStatus('접수') === 'pending')
  check('재접수 = 심사중', C.mapPortalStatus('재접수') === 'pending')
  check('회차추가 = 심사중', C.mapPortalStatus('회차추가') === 'pending')
  check('보완요청 = 보완요청', C.mapPortalStatus('보완요청') === 'needsFix')
  check('처리불가 = 반려', C.mapPortalStatus('처리불가') === 'rejected')
  check('삭제 = 반려', C.mapPortalStatus('삭제') === 'rejected')
  // 현황 칸의 「처리불가 (사유)」 — 상태 글자와 사유를 나눈다 (2026-10-22 실제 포털 확인)
  check('처리불가 (사유) 도 반려', C.mapPortalStatus('처리불가 (중복신청)') === 'rejected')
  check('상태와 사유를 나눈다', JSON.stringify(C.splitPortalStatus('처리불가 (중복신청)')) === JSON.stringify({ status: '처리불가', note: '중복신청' }))
  check('사유 안의 괄호도 통째로', C.splitPortalStatus('처리불가 (기 발급 (G720:N+A244) 확인 바랍니다.)').note === '기 발급 (G720:N+A244) 확인 바랍니다.')
  check('괄호가 없으면 사유는 빈 값', JSON.stringify(C.splitPortalStatus(' 완료 ')) === JSON.stringify({ status: '완료', note: '' }))

  group('휴대폰·이메일 형식 (포털 규칙과 동일해야 함)')
  check('하이픈 없이 넣어도 맞춰준다', C.formatMobile('01012345678') === '010-1234-5678')
  check('공백이 섞여도 맞춰준다', C.formatMobile('010 1234 5678') === '010-1234-5678')
  check('이미 맞으면 그대로', C.formatMobile('010-1234-5678') === '010-1234-5678')
  check('포털 규칙 통과', C.isValidMobile('010-1234-5678') === true)
  check('하이픈 없으면 포털이 거부', C.isValidMobile('01012345678') === false)
  check('01 로 시작 안 하면 거부', C.isValidMobile('021-1234-5678') === false)
  check('이메일 형식', C.isValidEmail('a@tooning.io') === true && C.isValidEmail('a@b') === false)

  /* --------------------------------------------------- 신청 자격 (등록자번호) */
  group('신청 자격 확인')
  await mock.login({ loginId: 'tooning', password: 'pw' })
  store.setSettings({ registrantNo: '' })
  const noReg = await mock.verifyAccess()
  check('등록자번호 없으면 실패', !noReg.ok && noReg.error.includes('등록자번호'), noReg.error)
  store.setSettings({ registrantNo: '2024-000100' })
  check('등록자번호 있으면 통과', (await mock.verifyAccess()).ok)
  check('두 제공자가 같은 함수를 갖는다',
    typeof mock.verifyAccess === 'function' && typeof providers.portal.verifyAccess === 'function')

  group('연습 도중 꺼졌을 때 — 켤 때 모의 연동을 정리한다')
  {
    const keepMode = store.getSettings().mode
    store.setSettings({ mode: 'mock' })
    const left = store.addRecord({ title: '연습 찌꺼기', mode: 'mock', status: 'pending' })
    const real = store.addRecord({ title: '실제 기록', mode: 'portal', status: 'pending' })
    const r = store.clearLeftoverPractice()
    check('모의 연동이 남아 있으면 실제 연동으로 되돌린다', r.reset === true && store.getSettings().mode === 'portal', r)
    check('연습 기록은 지우고 실제 기록은 둔다', r.removed >= 1 && !store.listRecords({}).some((x) => x.id === left.id) && store.listRecords({}).some((x) => x.id === real.id))
    check('실제 연동이면 아무것도 안 한다', store.clearLeftoverPractice().reset === false)
    store.deleteRecord(real.id)
    store.setSettings({ mode: keepMode })
  }

  group('계정을 바꿔 로그인할 때 앞 계정 정보를 지운다')
  {
    const keep = store.getSettings()
    store.setSettings({ mode: 'portal', lastLoginId: 'companyA', registrantNo: '2018-000011', orgName: 'A회사', orgCode: 'A244', registrantVerifiedAt: '2026-10-16T00:00:00.000Z' })
    check('같은 아이디면 그대로 둔다', store.prepareLogin('companyA') === false && store.getSettings().orgName === 'A회사')
    check('다른 아이디면 등록자 정보를 지운다', store.prepareLogin('companyB') === true)
    {
      const s = store.getSettings()
      check('등록자번호·기관명·코드·확인 시각이 비워진다', s.registrantNo === '' && s.orgName === '' && s.orgCode === '' && s.registrantVerifiedAt === '', s)
    }
    store.setSettings({ mode: 'mock', lastLoginId: 'companyA', registrantNo: '2018-000011', orgName: 'A회사' })
    check('모의 연동에서는 건드리지 않는다 (흉내용 입력값)', store.prepareLogin('companyB') === false && store.getSettings().orgName === 'A회사')
    store.setSettings({ mode: 'portal', lastLoginId: '' })
    check('처음 로그인(이전 아이디 없음)이면 지울 것이 없다', store.prepareLogin('companyB') === false)
    store.setSettings({ mode: keep.mode, lastLoginId: keep.lastLoginId, registrantNo: keep.registrantNo, orgName: keep.orgName, orgCode: keep.orgCode, registrantVerifiedAt: keep.registrantVerifiedAt })
  }

  /* -------------------------------------------------------------- 단건 신청 */
  group('단건 신청 — 포털 필수 항목')
  const full = {
    contentType: 'webtoon', publishForm: '연재형', title: '우리 동네',
    writerRole: '글/그림', writer: '홍길동', ageGrade: 'AL', genres: ['로맨스/순정'],
    syndicateName: '네이버 웹툰', syndicateCode: 'NC', url: 'https://a.com',
    serialStatus: '연재중', priceKind: '연재가 회당', price: '0', currency: '원',
    episodeStart: '1', episodeEnd: '10',
    managerName: '김담당', managerEmail: 'a@b.com', managerMobile: '010-0000-0000',
    receiveMethod: 'handphone', privacyAgreed: true, rightsAgreed: true
  }
  const applied = await mock.apply(full)
  check('전부 채우면 접수', applied.ok, applied)
  check('접수 직후 상태는 심사중', applied.status === 'pending')
  // 2026-10-15 파트너 실증: 포털이 "연령등급을 선택하세요" 로 거부했다. 모의 연동도 같은 자리에서 막는다.
  const noGrade = await mock.apply({ ...full, ageGrade: '' })
  check('연령등급이 비면 거부 (포털과 같게)', !noGrade.ok && /연령등급/.test(noGrade.error || ''), noGrade)
  const twoAuthors = await mock.apply({ ...full, writerRole: '', writer: '', authors: [{ role: '글', name: '홍길동' }, { role: '그림', name: '김그림' }] })
  check('작가 두 줄(글·그림)도 접수', twoAuthors.ok, twoAuthors)
  const noAuthor = await mock.apply({ ...full, writerRole: '', writer: '', authors: [] })
  check('작가가 없으면 거부', !noAuthor.ok && /작가/.test(noAuthor.error || ''), noAuthor)
  const noRole = await mock.apply({ ...full, writerRole: '', writer: '', authors: [{ role: '', name: '홍길동' }] })
  check('역할 없는 줄은 거부 (포털의 짝 검사)', !noRole.ok && /작가/.test(noRole.error || ''), noRole)
  check('접수 시점에 UCI 는 없다', applied.uci === undefined)

  // 포털은 같은 작품명이 있으면 접수 대신 "회차 추가 / 새 작품으로 등록" 을 묻는다 (2026-10-15 확인).
  // 모의 연동은 작품명에 '중복' 이 들어가면 그 상황을 흉내낸다.
  const dupe = await mock.apply({ ...full, title: '중복 작품' })
  check('같은 작품명이면 접수하지 않고 중복으로 멈춘다', !dupe.ok && dupe.duplicate === true && /중복 작품/.test(dupe.error || ''), dupe)
  const forced = await mock.apply({ ...full, title: '중복 작품', forceNew: true })
  check('새 작품으로 등록을 고르면 접수된다', forced.ok && forced.status === 'pending', forced)
  const dupeBulk = await mock.applyBulk([full, { ...full, title: '중복 작품 2' }])
  check('일괄도 같은 작품명이면 어느 작품인지 알려 주고 멈춘다', !dupeBulk.ok && dupeBulk.duplicate === true && dupeBulk.workName === '중복 작품 2', dupeBulk)
  // 포털 서버처럼 이력에 같은 유형·같은 작품명이 있어도 중복으로 본다 (연습에서 같은 제목을 다시 신청하는 경우).
  const seeded = store.addRecord({ ...full, title: '이미 낸 작품', status: 'pending', mode: 'mock', appliedAt: new Date().toISOString() })
  const again = await mock.apply({ ...full, title: '이미 낸 작품' })
  check('이력에 있는 작품명이면 중복으로 멈춘다', !again.ok && again.duplicate === true, again)
  const spaced = await mock.apply({ ...full, title: ' 이미  낸 작품 ' })
  check('띄어쓰기만 달라도 같은 작품으로 본다', !spaced.ok && spaced.duplicate === true, spaced)
  const otherType = await mock.apply({ ...full, title: '이미 낸 작품', contentType: 'webnovel' })
  check('유형이 다르면 다른 작품이다', otherType.ok === true, otherType)
  const failedOnly = store.addRecord({ ...full, title: '실패했던 작품', status: 'failed', mode: 'mock', appliedAt: new Date().toISOString() })
  check('실패 기록은 포털에 없으니 중복이 아니다', (await mock.apply({ ...full, title: '실패했던 작품' })).ok === true)
  store.deleteRecord(seeded.id); store.deleteRecord(failedOnly.id)

  for (const [key, label] of [
    ['managerName', '담당자명'], ['managerEmail', '담당자 이메일'], ['managerMobile', '담당자 휴대폰'],
    ['publishForm', '연재유형'], ['title', '작품명'], ['writerRole', '작가역할'], ['writer', '작가명'],
    ['syndicateName', '연재처'], ['price', '가격'], ['serialStatus', '연재상태'],
    ['episodeStart', '회차 시작번호'], ['episodeEnd', '회차 끝번호']
  ]) {
    check(`${label} 없으면 거부`, !(await mock.apply({ ...full, [key]: '' })).ok)
  }
  check('장르 없으면 거부', !(await mock.apply({ ...full, genres: [] })).ok)
  check('저작권자 동의 없으면 거부', !(await mock.apply({ ...full, rightsAgreed: false })).ok)
  check('개인정보 동의 없으면 거부', !(await mock.apply({ ...full, privacyAgreed: false })).ok)
  check('하이픈 없는 휴대폰 거부', !(await mock.apply({ ...full, managerMobile: '01012345678' })).ok)
  check('잘못된 이메일 거부', !(await mock.apply({ ...full, managerEmail: 'nope' })).ok)

  group('가격 단위 — 직접입력')
  {
    // 단위를 직접 쓰기로 해놓고 비워 두면 포털에서 걸린다. 여기서 먼저 막는다.
    const etc = { ...full, currency: '직접입력' }
    check('직접입력인데 단위가 비면 거부', !(await mock.apply(etc)).ok)
    check('단위를 적으면 통과', (await mock.apply({ ...etc, currencyEtc: '포인트' })).ok)
    check('포털에 넣을 칸이 등록돼 있다',
      selectorConfig.load().apply.fields.currencyEtc === '#currencyCodeEtc')

    // 엑셀의 가격단위 칸은 자유 입력이라 '직접입력' 이 아니라 실제 단위가 들어가야 한다.
    const bulk = require(path.join(SRC, 'bulk-excel'))
    check('엑셀에는 실제 단위가 들어간다',
      bulk.toRow({ currency: '직접입력', currencyEtc: '포인트' })[7] === '포인트',
      bulk.toRow({ currency: '직접입력', currencyEtc: '포인트' })[7])
    check('보통은 고른 값 그대로', bulk.toRow({ currency: '코인' })[7] === '코인')
  }

  group('회차 범위')
  check('역순 거부', !(await mock.apply({ ...full, episodeStart: '10', episodeEnd: '1' })).ok)
  check('300화 초과 거부', !(await mock.apply({ ...full, episodeStart: '1', episodeEnd: '301' })).ok)
  check('정확히 300화는 통과', (await mock.apply({ ...full, episodeStart: '1', episodeEnd: '300' })).ok)

  group('형식 오류 — 숫자 칸에 글자 (SFR-002 입력값 검증)')
  {
    // 요구사항추적표: 숫자를 받아야 하는 칸에 문자열이 들어오면 처리(거부)해야 한다. 예전에는 Number() 로 바꿔 보고 넘어가서 '1e3' 같은 값이 통과했다.
    check('가격에 글자가 섞이면 거부', !(await mock.apply({ ...full, price: '5백' })).ok)
    check('가격의 지수·소수 표기도 거부', !(await mock.apply({ ...full, price: '1e3' })).ok && !(await mock.apply({ ...full, price: '1.5' })).ok)
    check('가격 0 은 통과', (await mock.apply({ ...full, price: '0' })).ok)
    check('회차에 단위를 붙이면 거부', !(await mock.apply({ ...full, episodeStart: '1화' })).ok && !(await mock.apply({ ...full, episodeEnd: '10화' })).ok)
    check('회차에 음수·소수는 거부', !(await mock.apply({ ...full, episodeStart: '-1' })).ok && !(await mock.apply({ ...full, episodeEnd: '10.5' })).ok)
    check('앞뒤 공백은 허용', (await mock.apply({ ...full, price: ' 500 ', episodeEnd: ' 10 ' })).ok)
    const p = C.typeProblem({ price: 'abc' })
    check('오류에 칸 이름과 입력값이 함께 온다', p && p.field === 'price' && /abc/.test(p.message), p)
    check('빈 칸은 형식 오류가 아니다 (필수 검사가 따로 본다)', C.typeProblem({ price: '', episodeStart: '' }) === null)
    check('URL·휴대폰·이메일 형식도 같은 자리에서 본다',
      C.typeProblem({ url: '주소 아님' })?.field === 'url' && C.typeProblem({ managerMobile: '01012345678' })?.field === 'managerMobile' && C.typeProblem({ managerEmail: 'nope' })?.field === 'managerEmail')
    // 작품 URL 은 앞부분을 빼먹고 적는 일이 많다. 거부하지 않고 https:// 를 붙여 준다.
    check('URL 에 http(s):// 가 없으면 https:// 를 붙인다',
      C.normalizeUrl('comic.naver.com/webtoon') === 'https://comic.naver.com/webtoon' && C.normalizeUrl('http://a.com') === 'http://a.com' && C.normalizeUrl(' ') === '')
    check('앞부분 없는 URL 도 신청 통과', (await mock.apply({ ...full, url: 'comic.naver.com/webtoon/list?titleId=1' })).ok)
    check('숫자 판정 함수', C.isDigits('12') && C.isDigits(' 0 ') && !C.isDigits('1e3') && !C.isDigits('') && !C.isDigits('１２'))
  }

  /* -------------------------------------------------------------- 결과 조회 */
  group('심사 결과 조회')
  {
    const fresh = { title: 'ㄱ', contentType: 'webtoon', url: 'https://a.com', appliedAt: new Date().toISOString() }
    check('심사 기간 중에는 대기', (await mock.checkStatus(fresh)).status === 'pending')

    const old = { ...fresh, appliedAt: new Date(Date.now() - 60000).toISOString() }
    const done = await mock.checkStatus(old)
    check('기간이 지나면 발급', done.ok && done.status === 'issued', done)
    check('UCI 형식', /^I410-ECN-0102-\d{4}-\d{3}-\d{9}$/.test(done.uci || ''), done.uci)
    check('웹툰 분류코드 620', (done.uci || '').split('-')[4] === '620')
    check('웹소설 분류코드 300', ((await mock.checkStatus({ ...old, contentType: 'webnovel' })).uci || '').split('-')[4] === '300')
    check('반려 경로', (await mock.checkStatus({ ...old, url: 'https://a.com/reject' })).status === 'rejected')

    const codes = new Set()
    for (let i = 0; i < 30; i++) codes.add((await mock.checkStatus({ ...old, title: 't' + i })).uci)
    check('연속 발급 시 코드 중복 없음', codes.size === 30, codes.size)
  }

  /* ------------------------------------------------------------ 모드 전환 */
  group('모드 전환')
  store.setSettings({ mode: 'mock' })
  check('mock 모드 → mock 제공자', providers.current() === providers.mock)
  store.setSettings({ mode: 'portal' })
  check('portal 모드 → portal 제공자', providers.current() === providers.portal)
  store.setSettings({ mode: 'mock' })

  /* --------------------------------------------------- 포털 접속 안전장치 */
  group('안전장치 — 실제 포털에 접속하지 않는지')
  {
    // 이 구간은 절대 네트워크를 타면 안 된다. configured 를 내려 차단 여부만 본다.
    const off = selectorConfig.load()
    off.configured = false
    fs.writeFileSync(selectorConfig.userPath(), JSON.stringify(off), 'utf8')

    check('configured=false 면 미설정으로 본다', providers.portal.isLoginConfigured() === false)
    const blocked = await providers.portal.login({ loginId: 'a', password: 'b' })
    check('설정이 꺼져 있으면 접속을 시도하지 않는다',
      !blocked.ok && blocked.error.includes('selectors.json'), blocked.error)
    check('신청도 막는다', !(await providers.portal.apply({ title: 'x' })).ok)
    check('일괄 신청도 막는다', !(await providers.portal.applyBulk([{ title: 'x' }])).ok)

    group('현황 조회 — 같은 이름이 여러 줄일 때')
    {
      const { pickStatusRow } = providers.portal._test
      const col = { title: 3, uci: 4, appliedAt: 5, issuedAt: 7, status: 8 }
      const row = (title, applied, uci) => ['1', '웹툰', '연재형', title, uci, applied, applied, '', '완료']
      const rows = [row('달빛 편의점', '2026.10.20', 'UCI-B'), row('달빛 편의점', '2026.10.02', 'UCI-A'), row('달빛 편의점 외전', '2026.10.02', 'UCI-C')]
      check('이름이 하나뿐이면 그 줄', pickStatusRow(rows, col, { title: '달빛 편의점 외전' })[4] === 'UCI-C')
      check('같은 이름이 여럿이면 신청일이 같은 줄', pickStatusRow(rows, col, { title: '달빛 편의점', appliedAt: '2026-10-02T03:00:00.000Z' })[4] === 'UCI-A')
      check('신청일이 어느 줄과도 안 맞으면 첫 줄', pickStatusRow(rows, col, { title: '달빛 편의점', appliedAt: '2026-09-01T03:00:00.000Z' })[4] === 'UCI-B')
      check('신청일이 없으면 첫 줄', pickStatusRow(rows, col, { title: '달빛 편의점' })[4] === 'UCI-B')
      check('정확히 같은 이름이 없으면 첫 줄 (기존 동작)', pickStatusRow(rows, col, { title: '없는 작품' })[4] === 'UCI-B')
      check('부분 일치는 다른 작품으로 본다', pickStatusRow(rows, col, { title: '달빛' })[4] === 'UCI-B')
    }

    group('현황 목록 읽기 — 줄 해석과 이력 합치기')
    {
      const { parseStatusRow } = providers.portal._test
      const col = { type: 1, publishForm: 2, title: 3, uci: 4, appliedAt: 5, lastAppliedAt: 6, issuedAt: 7, status: 8 }
      const it = parseStatusRow(['1', '웹소설', '단행본', '달빛 편의점', 'I410-ECN-0102-2026-620-000123456', '2026.10.02', '2026.10.02', '2026.10.06', '완료'], col)
      check('현황 줄을 이력 모양으로 바꾼다', it && it.contentType === 'webnovel' && it.publishForm === '단행본' && it.title === '달빛 편의점' && it.uci.startsWith('I410') && it.portalStatus === '완료', it)
      check('날짜가 ISO 로 바뀐다', /^2026-10-0[12]T/.test(it.appliedAt) && /^2026-10-0[56]T/.test(it.issuedAt), [it.appliedAt, it.issuedAt])
      check('안내 문구만 있는 줄은 버린다', parseStatusRow(['신청정보가 없습니다.'], col) === null)

      // 이력 합치기: 같은 작품은 상태만 갱신, 없는 작품은 새 줄, 입력값은 건드리지 않는다
      const mine = store.addRecord({ contentType: 'webtoon', title: '합치기 시험', writer: '홍길동', genres: ['드라마'], status: 'pending', uci: '', appliedAt: '2026-10-10T03:00:00.000Z', mode: 'portal' })
      const r1 = store.mergePortalRecords([
        { contentType: 'webtoon', title: '합치기 시험', uci: 'UCI-NEW', status: 'issued', appliedAt: '2026-10-10T03:00:00.000Z', issuedAt: '2026-10-14T03:00:00.000Z', portalStatus: '완료' },
        { contentType: 'webtoon', title: '다른 PC 작품', uci: '', status: 'pending', appliedAt: '2026-10-12T03:00:00.000Z', portalStatus: '접수' }
      ], 'acctA')
      check('있는 작품은 갱신, 없는 작품은 추가', r1.updated === 1 && r1.added === 1, r1)
      const after = store.listRecords({}).find((r) => r.id === mine.id)
      check('상태·UCI 가 갱신되고 입력값은 그대로', after.status === 'issued' && after.uci === 'UCI-NEW' && after.writer === '홍길동' && after.genres[0] === '드라마', after)
      check('계정 표시 없던 기록이 이 계정 것으로 붙는다', after.account === 'acctA', after.account)
      const fromPortal = store.listRecords({}).find((r) => r.title === '다른 PC 작품')
      check('새 줄은 포털 출처 표시가 붙고 입력값은 비어 있다', fromPortal && fromPortal.source === 'portal' && fromPortal.writer === '' && fromPortal.status === 'pending' && fromPortal.account === 'acctA', fromPortal)
      const failed = store.addRecord({ contentType: 'webtoon', title: '실패했다 포털에 있는 작품', writer: '김작가', status: 'failed', error: '신청 실패: 연령등급을 선택하세요', appliedAt: '2026-10-11T03:00:00.000Z', mode: 'portal' })
      store.mergePortalRecords([{ contentType: 'webtoon', title: '실패했다 포털에 있는 작품', uci: '', status: 'pending', appliedAt: '2026-10-11T05:00:00.000Z', portalStatus: '접수' }], 'acctA')
      const revived = store.listRecords({}).find((r) => r.id === failed.id)
      check('실패 기록이 포털에 있으면 심사중으로 바뀌고 실패 사유는 지워진다', revived.status === 'pending' && revived.error === '' && revived.writer === '김작가', revived)
      store.deleteRecord(failed.id)
      const r2 = store.mergePortalRecords([{ contentType: 'webtoon', title: '다른 PC 작품', uci: '', status: 'pending', appliedAt: '2026-10-12T03:00:00.000Z', portalStatus: '접수' }], 'acctA')
      check('같은 목록을 다시 합쳐도 늘어나지 않는다', r2.added === 0 && r2.updated === 0, r2)
      store.deleteRecord(mine.id); store.deleteRecord(fromPortal.id)

      // 2026-10-21 감리 리뷰: 포털에 같은 작품명의 신청이 여럿인 계정에서 줄이 하나로 뭉개지고, 발급된 기록이 「반려」로 바뀌었다.
      const issued = store.addRecord({ contentType: 'webtoon', title: '권별 작품', writer: '박작가', status: 'issued', uci: 'UCI-VOL1', appliedAt: '2026-09-01T03:00:00.000Z', mode: 'portal', account: 'acctA' })
      const r3 = store.mergePortalRecords([
        { contentType: 'webtoon', title: '권별 작품', uci: 'UCI-VOL1', status: 'issued', appliedAt: '2026-09-01T03:00:00.000Z', portalStatus: '완료' },
        { contentType: 'webtoon', title: '권별 작품', uci: '', status: 'rejected', appliedAt: '2026-09-20T03:00:00.000Z', portalStatus: '삭제' },
        { contentType: 'webtoon', title: '권별 작품', uci: 'UCI-VOL2', status: 'issued', appliedAt: '2026-10-01T03:00:00.000Z', portalStatus: '완료' }
      ], 'acctA')
      const kept = store.listRecords({}).find((r) => r.id === issued.id)
      check('발급된 기록은 같은 이름의 지운 신청에 덮이지 않는다', kept.status === 'issued' && kept.uci === 'UCI-VOL1' && kept.writer === '박작가', kept)
      check('같은 이름의 다른 신청은 각각 기록이 된다', r3.added === 2 && store.listRecords({ account: 'acctA' }).filter((r) => r.title === '권별 작품').length === 3, r3)
      const r4 = store.mergePortalRecords([
        { contentType: 'webtoon', title: '권별 작품', uci: 'UCI-VOL1', status: 'issued', appliedAt: '2026-09-01T03:00:00.000Z', portalStatus: '완료' },
        { contentType: 'webtoon', title: '권별 작품', uci: '', status: 'rejected', appliedAt: '2026-09-20T03:00:00.000Z', portalStatus: '삭제' },
        { contentType: 'webtoon', title: '권별 작품', uci: 'UCI-VOL2', status: 'issued', appliedAt: '2026-10-01T03:00:00.000Z', portalStatus: '완료' }
      ], 'acctA')
      check('다시 합쳐도 늘지 않는다 (UCI·신청일로 짝을 찾는다)', r4.added === 0 && r4.updated === 0, r4)
      // 이 프로그램으로 낸 신청(UCI 없음)은 같은 날 최초신청일의 포털 줄과 짝이 된다. 하루 어긋나도 짝이 된다.
      const sent = store.addRecord({ contentType: 'webtoon', title: '권별 작품', writer: '박작가', status: 'pending', uci: '', appliedAt: '2026-10-15T14:50:00.000Z', mode: 'portal', account: 'acctA' })
      const r5 = store.mergePortalRecords([{ contentType: 'webtoon', title: '권별 작품', uci: 'UCI-VOL3', status: 'issued', appliedAt: '2026-10-16T03:00:00.000Z', portalStatus: '완료' }], 'acctA')
      const got = store.listRecords({}).find((r) => r.id === sent.id)
      check('프로그램으로 낸 신청은 신청일이 같은(±1일) 포털 줄에서 UCI 를 받는다', r5.added === 0 && got.status === 'issued' && got.uci === 'UCI-VOL3' && got.writer === '박작가', got)
      store.listRecords({ account: 'acctA' }).filter((r) => r.title === '권별 작품').forEach((r) => store.deleteRecord(r.id))
    }

    group('이력은 계정별로 보인다')
    {
      const a = store.addRecord({ account: 'acctA', contentType: 'webtoon', title: '계정A 작품', status: 'pending', appliedAt: '2026-10-13T03:00:00.000Z' })
      const b = store.addRecord({ account: 'acctB', contentType: 'webtoon', title: '계정B 작품', status: 'pending', appliedAt: '2026-10-13T03:00:00.000Z' })
      const legacy = store.addRecord({ contentType: 'webtoon', title: '계정 표시 없는 옛 기록', status: 'issued', uci: 'UCI-OLD', appliedAt: '2026-10-01T03:00:00.000Z' })
      const titlesFor = (acct) => store.listRecords({ account: acct }).map((r) => r.title)
      check('A 에게는 A 것과 옛 기록만 보인다', titlesFor('acctA').includes('계정A 작품') && titlesFor('acctA').includes('계정 표시 없는 옛 기록') && !titlesFor('acctA').includes('계정B 작품'), titlesFor('acctA'))
      check('B 에게는 B 것과 옛 기록만', titlesFor('acctB').includes('계정B 작품') && !titlesFor('acctB').includes('계정A 작품'))
      check('계정을 안 주면 전부', titlesFor(undefined).includes('계정A 작품') && titlesFor(undefined).includes('계정B 작품'))
      check('심사중 조회 대상도 계정별', store.pendingRecords('acctA').some((r) => r.id === a.id) && !store.pendingRecords('acctA').some((r) => r.id === b.id))
      check('현황 숫자도 계정별', store.stats('acctB').pending >= 1 && !store.listRecords({ account: 'acctB' }).some((r) => r.id === a.id))
      // B 의 포털 현황에 A 와 같은 작품명이 있어도 A 의 기록을 건드리지 않는다
      const rb = store.mergePortalRecords([{ contentType: 'webtoon', title: '계정A 작품', uci: 'UCI-B', status: 'issued', appliedAt: '2026-10-13T03:00:00.000Z', portalStatus: '완료' }], 'acctB')
      const aAfter = store.listRecords({}).find((r) => r.id === a.id)
      check('다른 계정의 같은 작품명은 덮어쓰지 않고 그 계정 줄로 새로 생긴다', rb.added === 1 && rb.updated === 0 && aAfter.status === 'pending' && !aAfter.uci, [rb, aAfter.status])
      const bDup = store.listRecords({ account: 'acctB' }).find((r) => r.title === '계정A 작품' && r.account === 'acctB')
      check('전체 삭제는 그 계정 것만 지운다', store.clearRecords('acctB') >= 2 && store.listRecords({}).some((r) => r.id === a.id) && !store.listRecords({}).some((r) => r.id === b.id))
      void bDup
      store.deleteRecord(a.id); store.deleteRecord(legacy.id)
    }

    group('연동 모듈 인터페이스 — 세 구현이 같은 동작을 갖는다')
    {
      const { OPERATIONS } = require(path.join(SRC, 'providers', 'interface'))
      const names = OPERATIONS.map((o) => o.name)
      check('동작 목록이 정의돼 있다', names.length === 13 && names.includes('apply') && names.includes('countApplications') && names.includes('listApplications') && names.includes('getApplicationDetails') && names.includes('getIssuedEpisodes'))
      for (const [label, impl] of [['mock', mock], ['portal', providers.portal], ['api', providers.api]]) {
        check(`${label} 가 동작을 전부 갖는다`, names.every((n) => typeof impl[n] === 'function'), names.filter((n) => typeof impl[n] !== 'function'))
      }
      // API 자리: 규격이 없으니 미개통으로만 답해야 한다 (가정 호출 금지)
      check('api 는 아직 미개통이다', providers.api.isConfigured() === false)
      const l = await providers.api.login({ loginId: 'a', password: 'b' })
      check('api 로그인은 미개통 안내로 답한다', !l.ok && /개통/.test(l.error), l)
      check('api 신청도 미개통', !(await providers.api.apply({ title: 'x' })).ok)
      check('api 현황 읽기도 미개통', !(await providers.api.listApplications()).ok)
      check('api 상세·회차도 미개통', !(await providers.api.getApplicationDetail({ portalKey: 'x' })).ok && !(await providers.api.getIssuedEpisodes({ portalKeys: ['x'] })).ok)
      const keepMode = store.getSettings().mode
      store.setSettings({ mode: 'api' })
      check("설정 mode 가 'api' 면 api 모듈을 고른다", providers.current() === providers.api)
      store.setSettings({ mode: 'portal' })
      check("'portal' 이면 포털 자동입력", providers.current() === providers.portal)
      store.setSettings({ mode: keepMode })
    }

    group('포털 중복 확인 창 가로채기')
    {
      const T = providers.portal._test
      const dupPop = (p) => T.isDuplicatePopup(p, 'workCode_info_duplicate_pop.do', 'popup')
      check('창 이름으로 알아본다', dupPop({ url: '', frameName: 'popup' }))
      check('주소로도 알아본다', dupPop({ url: 'https://www.nl.go.kr/seoji/module/S90202000000_workCode_info_duplicate_pop.do', frameName: '' }))
      check('일괄의 popup2 를 건별 popup 으로 오인하지 않는다',
        !dupPop({ url: 'https://x/S90202000000_workCode_info_duplicate_pop2.do', frameName: 'popup2' }))
      check('다른 창 요청은 중복이 아니다', !dupPop({ url: 'https://x/syndicate_code_table_pop.do', frameName: 'syn' }))

      // 실제 창에서: 포털처럼 window.open + target 폼 전송을 하면 창은 안 뜨고 요청만 남아야 한다.
      const w = await T.ensureWindow()
      T.clearDialogs()
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<form id="f" method="post" target="popup" action="https://example.invalid/S90202000000_workCode_info_duplicate_pop.do"></form>'))
      const before = BrowserWindow.getAllWindows().length
      await w.webContents.executeJavaScript(`window.open('', 'popup', 'width=100,height=100'); document.getElementById('f').submit(); true`)
      await new Promise((r) => setTimeout(r, 800))
      const got = T.takePopups()
      check('중복 확인 창 요청을 가로챈다', got.some((p) => dupPop(p)), got)
      check('창은 실제로 열리지 않는다', BrowserWindow.getAllWindows().length === before, BrowserWindow.getAllWindows().length)
      check('꺼낸 뒤에는 비어 있다', T.takePopups().length === 0)
      // data: 페이지의 폼 전송(example.invalid)이 진행 중인 창을 바로 지우면 Electron 이 다음 그룹에서
      // 죽는다(Windows 재현, macOS 간헐). 요청을 멈추고 창이 완전히 닫힌 뒤에 넘어간다.
      w.webContents.stop()
      const closed = new Promise((r) => w.once('closed', r))
      providers.portal.destroyWindow()
      await closed
      await new Promise((r) => setTimeout(r, 500))
    }
    selectorConfig.resetToDefault()
  }

  /* ------------------------------------- 포털 자동입력 — 가짜 포털로 끝까지 */
  group('포털 자동입력 — 가짜 포털로 끝까지 (실제 포털에는 닿지 않는다)')
  {
    /*
     * 실제 포털과 같은 id·버튼·알림·중복 확인 창·현황 표를 흉내낸 페이지(test/fake-portal)로 선택자의
     * 주소만 바꿔 자동입력 모듈을 끝까지 돌린다. 로그인 → 자격 확인 → 건별 신청(접수·거부·중복·새 작품)
     * → 일괄 신청 → 현황 조회 → 현황 목록(쪽 넘김) → 세션 만료 → 로그아웃.
     * 이 동안 창이 http(s) 로 가려 하면 실패로 본다. 포털 왕복이 아닌 '우리 쪽 동작' 만 시험한다.
     */
    const { pathToFileURL } = require('node:url')
    const page = (name) => pathToFileURL(path.join(ROOT, 'test', 'fake-portal', name)).href
    const P = providers.portal
    const T = P._test
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100) } return false }
    const current = async () => (await T.ensureWindow()).webContents.getURL()
    /** 가짜 신청 폼이 접수 뒤 주소(#) 에 남긴 요약 — 자동입력이 어떤 값을 넣었는지 포털 쪽에서 본 모습 */
    const sentSummary = async () => { const h = (await current()).split('#')[1]; return h ? JSON.parse(decodeURIComponent(h)) : null }

    const fake = selectorConfig.load()
    fake.configured = true
    fake.login.url = page('login.html')
    fake.apply.webtoon = { menuUrl: page('menu-webtoon.html'), formUrl: page('apply-webtoon.html') + '?type=new', newWorkSubmitUrl: page('done.html') }
    fake.apply.webnovel = { ...fake.apply.webtoon }
    fake.status.url = page('status.html')
    // 상세 화면은 file:// 에서 POST 를 못 보내므로 GET 으로 연다. 선택자는 실제 포털 것 그대로다.
    fake.status.detail = { ...fake.status.detail, url: page('view.html'), method: 'get' }
    fake.bulk.webtoon = { popupUrl: page('bulk-pop.html') }
    fake.bulk.webnovel = { popupUrl: page('bulk-pop.html') }
    fake.timeouts = { pageLoad: 10000, element: 3000, afterSubmit: 8000, bulkSubmit: 8000 }
    const useFake = (patch = {}) => fs.writeFileSync(selectorConfig.userPath(), JSON.stringify({ ...fake, ...patch }), 'utf8')
    useFake()
    const used = [fake.login.url, ...Object.values(fake.apply.webtoon), ...Object.values(fake.apply.webnovel), fake.status.url, fake.bulk.webtoon.popupUrl, fake.bulk.webnovel.popupUrl]
    check('시험이 쓰는 주소는 전부 로컬 파일', used.every((u) => u.startsWith('file://')), used)

    const leaked = []
    app.on('web-contents-created', (_e, wc) => wc.on('did-start-navigation', (ev, url) => {
      const u = String(ev?.url ?? url ?? '')
      if (/^https?:/i.test(u)) leaked.push(u)
    }))
    const windowsBefore = BrowserWindow.getAllWindows().length

    group('가짜 포털 — 로그인')
    {
      check('로그인 전에는 세션이 없다', P.getSession() === null)
      check('로그인 전 자격 확인은 거부', !(await P.verifyAccess()).ok)
      const bad = await P.login({ loginId: 'tester', password: 'wrong' })
      check('틀린 비밀번호는 포털 알림 문구 그대로 거부', !bad.ok && /올바르지 않습니다/.test(bad.error), bad)
      const ok = await P.login({ loginId: 'tester', password: 'good' })
      check('맞는 계정은 로그인 성공', ok.ok && ok.user.loginId === 'tester', ok)
      check('세션이 생긴다', P.getSession()?.loginId === 'tester')
      check('자동화 창은 숨긴 채 하나만 쓴다', BrowserWindow.getAllWindows().length === windowsBefore + 1 && !(await T.ensureWindow()).isVisible())
    }

    group('가짜 포털 — 신청 자격 (등록자번호를 포털 폼에서 읽는다)')
    {
      store.setSettings({ registrantNo: '', orgName: '', orgCode: '' })
      const v = await P.verifyAccess()
      check('신청 폼이 열리면 자격 있음', v.ok && v.account.registrantNo === '2024-000100', v)
      const s = store.getSettings()
      check('읽은 등록자번호·제작사를 설정에 저장', s.registrantNo === '2024-000100' && s.orgName === '(주)예시제작사' && s.orgCode === 'A619', s)
      useFake({ apply: { ...fake.apply, webtoon: { ...fake.apply.webtoon, menuUrl: page('menu-webtoon.html') + '?noreg=1' } } })
      const none = await P.verifyAccess()
      check('등록자번호가 비어 내려오면 자격 없음으로 안내', !none.ok && /등록자번호가 없습니다/.test(none.error), none)
      useFake()
    }

    const meta = {
      contentType: 'webtoon', publishForm: '연재형', title: '달빛 편의점 2부',
      authors: [{ role: '글', name: '김글' }, { role: '그림', name: '이그림' }], ageGrade: '15+', genres: ['드라마', '일상'],
      syndicateName: '네이버 웹툰', syndicateCode: 'NC', url: 'https://comic.naver.com/webtoon/1',
      serialStatus: '연재중', priceKind: '연재가 회당', price: '500', currency: '직접입력', currencyEtc: '포인트',
      episodeStart: '1', episodeEnd: '12',
      managerName: '김담당', managerEmail: 'a@b.com', managerMobile: '010-0000-0000', receiveMethod: 'email'
    }

    group('가짜 포털 — 건별 신청')
    {
      const r = await P.apply(meta)
      check('필수 항목을 다 채우면 접수', r.ok && r.status === 'pending' && /완료/.test(r.notice || ''), r)
      await until(async () => /done\.html#/.test(await current()))
      const sent = await sentSummary()
      check('작품명·연재유형이 들어간다', sent?.workName === '달빛 편의점 2부' && sent?.publishForm === '연재형', sent)
      check('작가 두 사람이 각자 줄로 들어간다 (글·그림)', sent?.authorList?.length === 2 && sent.authorList[0].roleName === '글' && sent.authorList[1].roleName === '그림' && sent.authorList[1].authorName === '이그림', sent?.authorList)
      check('연령등급이 선택된다', sent?.ageGrade === '15+', sent?.ageGrade)
      check('연재처 코드·URL 이 팝업 없이 들어간다', sent?.syndicateCode === 'NC' && sent?.syndicateUrl === 'https://comic.naver.com/webtoon/1', sent)
      check('가격·직접입력 단위가 들어간다', sent?.priceKind === '연재가 회당' && sent?.price === '500' && sent?.currency === '직접입력' && sent?.currencyEtc === '포인트', sent)
      check('연재상태·장르·회차가 들어간다', sent?.serialStatus === '연재중' && String(sent?.genres) === '드라마,일상' && String(sent?.episodes) === '1,12', sent)
      check('담당자와 수신 방법이 들어간다', String(sent?.manager) === '김담당,a@b.com,010-0000-0000,email', sent?.manager)
      check('동의 두 칸을 체크한다', String(sent?.agreed) === 'true,true', sent?.agreed)
      check('새 작품 표식 없이 보낸다 (보통 접수)', sent?.newType === '', sent?.newType)

      // 2026-10-15 파트너 실증: 포털이 "연령등급을 선택하세요" 로 거부했다. 그 문구가 그대로 사유로 와야 한다.
      const noGrade = await P.apply({ ...meta, ageGrade: '' })
      check('연령등급이 비면 포털 알림 문구 그대로 거부', !noGrade.ok && /연령등급을 선택하세요/.test(noGrade.error), noGrade)
      const badGrade = await P.apply({ ...meta, ageGrade: '99+' })
      check('포털 선택지에 없는 연령등급은 보내기 전에 멈춘다', !badGrade.ok && /연령등급/.test(badGrade.error), badGrade)
      const one = await P.apply({ ...meta, authors: [], writerRole: '글/그림', writer: '홍길동' })
      check('작가 한 사람은 줄을 늘리지 않고 접수', one.ok, one)

      const dup = await P.apply({ ...meta, title: '이미 있는 작품' })
      check('같은 작품명이면 포털 중복 확인 창을 알아채고 멈춘다', !dup.ok && dup.duplicate === true && /이미 있는 작품/.test(dup.error), dup)
      const forced = await P.apply({ ...meta, title: '이미 있는 작품', forceNew: true })
      check('새 작품으로 등록을 고르면 접수한다', forced.ok && forced.status === 'pending', forced)
      await until(async () => /done\.html\?/.test(await current()))
      check('그때는 신규 표식(newType=new)을 세워 접수 주소로 보낸다', /newType=new/.test(await current()), await current())
    }

    group('가짜 포털 — 일괄 신청 (엑셀 업로드)')
    {
      const items = [{ ...meta, title: '일괄 작품 1' }, { ...meta, title: '일괄 작품 2', authors: [{ role: '글/그림', name: '박작가' }] }]
      const r = await P.applyBulk(items)
      check('엑셀을 만들어 첨부하고 접수까지', r.ok && r.count === 2 && /접수/.test(r.notice || ''), r)
      check('첨부한 파일이 포털에 닿았다 (파일 이름)', /UCI일괄신청_웹툰\.xls/.test(r.notice || ''), r.notice)
      const mixed = await P.applyBulk([items[0], { ...items[1], contentType: 'webnovel' }])
      check('웹툰과 웹소설을 섞으면 막는다', !mixed.ok && /한 번에/.test(mixed.error), mixed)
      const dup = await P.applyBulk(items.map((i) => ({ ...i, managerName: '중복담당자' })))
      check('파일 안에 이미 있는 작품명이 있으면 어느 작품인지 알려 주고 멈춘다', !dup.ok && dup.duplicate === true && dup.workName === '이미 있는 작품', dup)
      const forced = await P.applyBulk(items.map((i) => ({ ...i, managerName: '중복담당자', forceNew: true })))
      check('새 작품으로 등록을 고르면 포털의 재업로드 함수로 접수한다', forced.ok && forced.count === 2, forced)
      // 2026-10-15 파트너 실증: 포털은 반려할 때 알림을 두 번 띄운다. 둘 다 사유에 남아야 한다.
      const form = await P.applyBulk(items.map((i) => ({ ...i, managerName: '양식오류담당자' })))
      check('양식 반려는 두 알림을 모두 모아 사유로 남긴다', !form.ok && /누락/.test(form.error) && /양식/.test(form.error), form)
      check('빈 목록은 막는다', !(await P.applyBulk([])).ok)
    }

    group('가짜 포털 — 현황 조회 (작품명으로 찾는다)')
    {
      const st = (title) => P.checkStatus({ title })
      const issued = await st('달빛 편의점')
      check('완료 → 발급 (UCI·발급일을 읽는다)', issued.ok && issued.status === 'issued' && issued.uci === 'I410-ECN-0102-2026-620-000123456' && new Date(issued.issuedAt).getDate() === 6, issued)
      check('접수 → 심사중', (await st('옆집 강아지')).status === 'pending')
      check('보완요청 → 보완 필요', (await st('우리 동네 이야기')).status === 'needsFix')
      check('처리불가 → 반려', (await st('반려된 작품')).status === 'rejected')
      const none = await st('없는 작품')
      check('없는 작품명은 조회되지 않는다고 알린다', !none.ok && /조회되지 않습니다/.test(none.error), none)
      check('작품명이 없으면 조회하지 않는다', !(await st('')).ok)
    }

    group('가짜 포털 — 현황을 쪽 단위로 읽는다')
    {
      const t0 = Date.now()
      const p1 = await P.listApplications({ page: 1 })
      console.log(`  [속도] 가짜 포털 현황 1쪽 읽기 (숨은 창 자동화, 네트워크 없음) ${Date.now() - t0}ms`)
      check('첫 쪽은 10건, 총 14건 2쪽', p1.ok && p1.items.length === 10 && p1.total === 14 && p1.pages === 2 && p1.pageSize === 10, { ok: p1.ok, n: p1.items?.length, total: p1.total, pages: p1.pages, error: p1.error })
      check('줄마다 포털 키를 뽑는다', p1.items.every((i) => /^k\d+$/.test(i.portalKey)), p1.items?.map((i) => i.portalKey))
      check('줄마다 작품명·상태·UCI 를 가져온다', !!p1.items.find((i) => i.title === '달빛 편의점' && i.portalKey === 'k1' && i.portalStatus === '완료' && i.uci.startsWith('I410')), p1.items?.[0])
      check('웹소설 줄은 유형을 구분한다', p1.items.find((i) => i.title === '반려된 작품')?.contentType === 'webnovel')
      const p2 = await P.listApplications({ page: 2 })
      check('둘째 쪽은 나머지 4건', p2.ok && p2.items.length === 4 && p2.page === 2, { n: p2.items?.length, error: p2.error })
      const twice = [...p1.items, ...p2.items].filter((i) => i.title === '두 번 낸 작품')
      check('같은 작품명·같은 최초신청일의 줄 둘은 키가 다르다', twice.length === 2 && twice[0].portalKey !== twice[1].portalKey, twice.map((i) => i.portalKey))

      // 상태 묶음별 건수 — 그 상태들만 체크해 검색한 뒤 오른쪽 아래 건수 요소를 읽는다 (대시보드가 먼저 쓴다)
      const cDone = await P.countApplications({ statuses: ['완료'] })
      const cPend = await P.countApplications({ statuses: ['접수', '재접수', '회차추가'] })
      check('완료 건수를 건수 요소에서 읽는다', cDone.ok && cDone.total === 2, cDone)
      check('접수·재접수·회차추가 건수', cPend.ok && cPend.total === 10, cPend)
      check('상태를 안 주면 거부', !(await P.countApplications({})).ok)
      const done = await P.listApplications({ page: 1, statuses: ['완료'] })
      check('상태 필터: 완료만 조회하면 2건', done.ok && done.total === 2 && done.items.every((i) => i.portalStatus === '완료'), { total: done.total, error: done.error })
      const found = await P.listApplications({ page: 1, query: '두 번 낸' })
      check('작품명 검색', found.ok && found.total === 2 && found.items.every((i) => i.title === '두 번 낸 작품'), { total: found.total, error: found.error })

      // 여러 건 상세 — 불러오기가 쓴다. 가짜 포털은 file:// 라 fetch 대신 한 건씩 화면을 옮겨 읽는 길로 간다.
      const seen = []
      const many = await P.getApplicationDetails({ portalKeys: ['k1', 'k4', 'k999'], onProgress: (p) => seen.push(p.done) })
      check('여러 건 상세: 되는 건은 상세, 없는 키는 실패로', many.ok && many.results.k1?.ok && many.results.k1.detail.title === '달빛 편의점' && many.results.k4?.ok && !many.results.k999?.ok, many.results && Object.keys(many.results))
      check('진행을 알린다', JSON.stringify(seen) === '[1,2,3]', seen)
      const eps = await P.getIssuedEpisodes({ portalKeys: ['k1'] })
      check('가짜 포털에서는 회차 엑셀을 건너뛴다', eps.ok && eps.skipped === true && Object.keys(eps.episodes).length === 0, eps)

      // 상세 화면: 신청 폼의 모든 값이 채워져 있다. 작가는 줄마다 한 사람.
      const d = await P.getApplicationDetail({ portalKey: 'k1' })
      check('상세를 읽는다 (작품명·연령등급·연재처 코드·가격·연재상태)', d.ok && d.detail.title === '달빛 편의점' && d.detail.ageGrade === '15+' && d.detail.syndicateCode === 'NC' && d.detail.price === '500' && d.detail.currency === '직접입력' && d.detail.currencyEtc === '포인트' && d.detail.serialStatus === '완결', d)
      check('작가 두 줄을 따로 읽는다', d.ok && JSON.stringify(d.detail.authors) === JSON.stringify([{ role: '글', name: '김글' }, { role: '그림', name: '이그림' }]), d.detail?.authors)
      check('장르 체크를 읽는다', d.ok && JSON.stringify(d.detail.genres) === JSON.stringify(['드라마', '일상']), d.detail?.genres)
      check('머리의 신청일·처리상태를 읽는다', d.ok && d.detail.info['처리상태'] === '완료' && d.detail.info['신청일'] === '2026.10.02', d.detail?.info)
      const rej = await P.getApplicationDetail({ portalKey: 'k4' })
      check('반려 건의 상세는 열리고 처리내용은 비어 있다 (사유는 현황 칸에 있다)', rej.ok && !rej.detail.info['처리내용'], rej.detail?.info)
      const rejRow = p1.items.find((i) => i.portalKey === 'k4')
      check('현황 줄에서 처리불가 사유를 상태와 나눠 읽는다', rejRow && rejRow.portalStatus === '처리불가' && /등록자번호/.test(rejRow.portalNote), rejRow)
      check('없는 키는 실패로 답한다', !(await P.getApplicationDetail({ portalKey: 'k999' })).ok)
      check('키가 없으면 읽지 않는다', !(await P.getApplicationDetail({})).ok)

      // 심사 결과 조회: 같은 작품명이 둘이어도 포털 키로 정확한 줄을 고른다
      const byKey = await P.checkStatus({ title: '두 번 낸 작품', portalKey: 'k14' })
      check('현황 조회는 포털 키가 같은 줄을 고른다', byKey.ok && byKey.portalStatus === '회차추가' && byKey.portalKey === 'k14', byKey)

      // 이력 합치기: 포털 키로 짝을 찾고, 이 프로그램으로 낸 신청은 작품명·신청일로 키를 받는다
      store.clearRecords()
      const mine = store.addRecord({ contentType: 'webtoon', title: '옆집 강아지', writer: '홍길동', status: 'pending', uci: '', appliedAt: '2026-10-14T03:00:00.000Z', mode: 'portal', account: 'tester' })
      const merged = store.mergePortalRecords([...p1.items, ...p2.items].map((i) => ({ ...i, status: C.mapPortalStatus(i.portalStatus) })), 'tester')
      check('줄마다 기록 하나, 포털 키가 붙는다', merged.added === 13 && merged.updated === 1 && store.listRecords({ account: 'tester', onPortal: true }).length === 14, merged)
      check('이 프로그램으로 낸 신청이 포털 줄의 키를 받는다', store.getRecord(mine.id).portalKey === 'k2' && store.getRecord(mine.id).writer === '홍길동')
      const local = store.addRecord({ contentType: 'webtoon', title: '포털에 없는 신청', status: 'failed', mode: 'portal', account: 'tester', appliedAt: '2026-10-15T03:00:00.000Z' })
      check('포털에 없는 기록은 화면 목록에서 빠진다', store.listRecords({ account: 'tester', onPortal: true }).every((r) => r.id !== local.id) && store.listRecords({ account: 'tester' }).some((r) => r.id === local.id))
      const k1 = store.recordsByKeys(['k1'], 'tester').k1
      check('키로 기록을 찾는다', k1 && k1.title === '달빛 편의점' && k1.source === 'portal' && !k1.writer, k1)
      const filled = store.applyDetail(k1.id, d.detail)
      check('상세를 기록에 넣는다 (작가·장르·연재처·가격)', filled.writer === '김글, 이그림' && filled.writerRole === '글, 그림' && filled.genres.join() === '드라마,일상' && filled.syndicateCode === 'NC' && filled.price === '500' && filled.serialStatus === '완결' && Boolean(filled.detailAt), filled)
      const k4 = store.recordsByKeys(['k4'], 'tester').k4
      check('처리불가 사유가 기록(portalNote)에 들어온다', k4 && k4.portalStatus === '처리불가' && /등록자번호/.test(k4.portalNote), k4)
      const filled4 = store.applyDetail(k4.id, rej.detail)
      check('상세를 읽어도 사유는 그대로다', /등록자번호/.test(filled4.portalNote) && filled4.error === '', filled4)
      const again = store.mergePortalRecords([...p1.items].map((i) => ({ ...i, status: C.mapPortalStatus(i.portalStatus) })), 'tester')
      check('같은 쪽을 다시 합쳐도 늘지 않는다', again.added === 0, again)

      // 전체를 읽은 뒤: 포털에 없던 기록은 화면에서 빠지고(지우지는 않음), 상세 안 읽은 줄은 읽을 대상이 된다
      const allKeys = [...p1.items, ...p2.items].map((i) => i.portalKey)
      const ghost = store.addRecord({ contentType: 'webtoon', title: '포털에서 지운 작품', status: 'pending', mode: 'portal', account: 'tester', portalKey: 'k-gone', appliedAt: '2026-10-01T03:00:00.000Z' })
      const marked = store.markPortalSync('tester', allKeys)
      check('전체 읽기 뒤 포털에 없던 키는 「없음」 표시 — 화면에서 빠진다', marked.gone === 1 && Boolean(store.getRecord(ghost.id).goneAt) && !store.listRecords({ account: 'tester', onPortal: true }).some((r) => r.id === ghost.id), marked)
      check('다시 보이면 되살린다', store.markPortalSync('tester', [...allKeys, 'k-gone']).back === 1 && !store.getRecord(ghost.id).goneAt)
      store.deleteRecord(ghost.id)
      const need = store.recordsNeedingDetail('tester')
      check('상세 안 읽은 줄이 읽을 대상이다 (k1·k4 는 읽었으니 빠진다)', need.length === 12 && !need.some((r) => r.portalKey === 'k1' || r.portalKey === 'k4'), need.length)
      const changed = store.applyEpisodes({ 'I410-ECN-0102-2026-620-000123456': { start: '0001', end: '0060' } }, 'tester')
      const k1b = store.recordsByKeys(['k1'], 'tester').k1
      check('회차 범위를 UCI 로 넣는다 (0001 → 1)', changed === 1 && k1b.episodeStart === '1' && k1b.episodeEnd === '60', [changed, k1b.episodeStart, k1b.episodeEnd])
      store.updateRecord(k1.id, { error: '포털에서 보완요청 상태입니다.' })
      check('심사 결과 조회가 적은 사유는 상세를 다시 읽어도 남는다', store.applyDetail(k1.id, d.detail).error === '포털에서 보완요청 상태입니다.')
      // 포털에서 온 줄의 최초신청일시는 포털 값(시:분 포함)으로 맞춘다. 이 프로그램으로 낸 신청은 보낸 시각을 둔다.
      const k5 = store.recordsByKeys(['k5'], 'tester').k5
      store.mergePortalRecords([{ ...p1.items.find((i) => i.portalKey === 'k5'), status: 'issued', appliedAt: '2026-10-03T06:37:00.000Z' }], 'tester')
      check('포털 줄의 신청일시는 포털 값으로 갱신', store.getRecord(k5.id).appliedAt === '2026-10-03T06:37:00.000Z')
      store.mergePortalRecords([{ ...p1.items.find((i) => i.portalKey === 'k2'), status: 'pending', appliedAt: '2026-10-14T06:00:00.000Z' }], 'tester')
      check('이 프로그램으로 낸 신청의 시각은 그대로', store.getRecord(mine.id).appliedAt === '2026-10-14T03:00:00.000Z')
      check('같은 값을 다시 넣으면 바뀐 게 없다', store.applyEpisodes({ 'I410-ECN-0102-2026-620-000123456': { start: '1', end: '60' } }, 'tester') === 0)
      const ordered = store.listRecords({ account: 'tester', onPortal: true })
      check('이력은 포털 차례 (최신 신청이 위)', ordered.length === 14 && ordered.every((r, i) => i === 0 || String(ordered[i - 1].appliedAt) >= String(r.appliedAt)), ordered.map((r) => r.appliedAt).slice(0, 3))
      const found2 = await P.lookup('I410-ECN-0102-2026-620-000123456')
      check('UCI 로 이력에서 찾는다', found2.ok && found2.record.title === '달빛 편의점', found2)
      check('없는 UCI 는 못 찾는다', !(await P.lookup('I410-없음')).ok)
      store.clearRecords()
    }

    group('조회/정정 엑셀 — 회차 범위 해석')
    {
      const XLSX = require('xlsx')
      const { parseEpisodesWorkbook } = providers.portal._test
      const book = (rows) => { const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(rows), '콘텐츠목록'); return XLSX.write(w, { type: 'buffer', bookType: 'biff8' }) }
      const got = parseEpisodesWorkbook(book([
        ['UCI 콘텐츠 목록'], [],
        ['번호', '신청대상', '연재유형', 'UCI', '작품명', '작가명', '제작사', '연재처', '가격정보', '회차시작번호', '회차끝번호'],
        [1, '웹툰', '연재형', 'G720:T+A000-20260000001', '테스트 웹툰 1', '테스트작가1/테스트작가2 - 총 기여자 수(1)', '테스트제작사', '테스트 연재처', '연재가 회당 - 400(원)', 1, 60],
        [2, '웹툰', '연재형', 'G720:T+A000-20260000002', '테스트 웹툰 2', '테스트작가3', '테스트제작사', '테스트 연재처', '', '', '']
      ]))
      check('머리글로 열을 찾아 UCI → 회차 시작·끝 (.xls)', got['G720:T+A000-20260000001']?.start === '1' && got['G720:T+A000-20260000001']?.end === '60', got)
      check('회차가 비어 있으면 빈 글자', got['G720:T+A000-20260000002']?.start === '' && got['G720:T+A000-20260000002']?.end === '', got)
      check('머리글 없는 시트는 무시', Object.keys(parseEpisodesWorkbook(book([['a', 'b'], [1, 2]]))).length === 0)
    }

    group('가짜 포털 — 세션 만료 (로그인 화면으로 튕길 때)')
    {
      useFake({ status: { ...fake.status, url: page('login.html') } })
      store.clearCredential()
      const expired = await P.listApplications()
      check('저장된 로그인 정보가 없으면 다시 로그인하라고 알린다', !expired.ok && /만료/.test(expired.error), expired)
      check('세션을 내린다', P.getSession() === null)
      await P.login({ loginId: 'tester', password: 'good' })
      store.saveCredential('tester', 'good')
      const kept = await P.checkStatus({ title: '달빛 편의점' })
      check('저장된 정보로 다시 로그인해 보고, 그래도 튕기면 알린다', !kept.ok && /유지하지 못했습니다/.test(kept.error), kept)
      store.clearCredential()
      useFake()
    }

    group('가짜 포털 — 로그아웃')
    {
      await P.login({ loginId: 'tester', password: 'good' })
      const out = await P.logout()
      check('로그아웃하면 세션과 창을 정리한다', out.ok && P.getSession() === null && BrowserWindow.getAllWindows().length === windowsBefore)
      check('로그아웃 뒤 신청은 거부', !(await P.apply(meta)).ok)
      check('로그아웃 뒤 현황 조회도 거부', !(await P.checkStatus({ title: 'x' })).ok)
      check('로그아웃 뒤 창을 새로 만들지 않는다', BrowserWindow.getAllWindows().length === windowsBefore)
    }

    check('이 동안 실제 포털(http/https)로 간 적이 없다', leaked.length === 0, leaked)
    selectorConfig.resetToDefault()
  }

  group('일괄 신청 연동 설정')
  {
    const s2 = selectorConfig.load()
    check('웹툰·웹소설 팝업 주소가 다르다', s2.bulk.webtoon.popupUrl !== s2.bulk.webnovel.popupUrl)
    check('팝업 주소가 일괄신청 경로다', s2.bulk.webtoon.popupUrl.includes('apply_all_pop'))
    check('엑셀 첨부칸 선택자', s2.bulk.fileInput === '#fileName')
    check('제출은 fn_apply', s2.bulk.submitButton.includes('fn_apply'))
    // 담당자 정보는 엑셀이 아니라 팝업 화면에서 한 번만 받는다.
    check('담당자 입력칸이 건별과 같다',
      s2.bulk.fields.managerName === '#inputName' && s2.bulk.fields.managerEmail === '#inputEMail')
    check('동의 체크는 agreeEssential', s2.bulk.rightsAgreeCheckbox === '#agreeEssential')
  }

  group('일괄 신청 자동화 — 안전 관련 코드')
  {
    const src = fs.readFileSync(path.join(SRC, 'providers', 'portal.js'), 'utf8')
    // 파일 첨부는 스크립트로 못 한다. 개발자도구 통로를 써야 한다.
    check('파일 첨부에 CDP 를 쓴다', src.includes('DOM.setFileInputFiles'))
    check('붙였던 디버거를 반드시 뗀다', src.includes('if (attachedHere)') && src.includes('dbg.detach()'))
    // 작품 목록이 담긴 임시 파일을 남기면 안 된다.
    check('임시 엑셀을 지운다', /finally\s*\{[\s\S]*rmSync/.test(src))
    check('업로드는 건별보다 넉넉히 기다린다', src.includes('bulkSubmit'))
    // 고급 설정을 감추면 창 표시를 끌 방법도 없다. 그때는 저장값과 무관하게 숨겨야 한다.
    check('고급 설정을 감추면 자동화 창도 숨긴다',
      src.includes('SHOW_ADVANCED_SETTINGS && Boolean(store.getSettings().showAutomationWindow)'))
  }

  group('배포되는 연동 설정')
  {
    const s = selectorConfig.load()
    check('실제 포털 값이 채워져 있다', providers.portal.isConfigured() === true)
    check('로그인 선택자', s.login.idInput === '#publishID' && s.login.submitButton === '#publishBtn')
    check('로그인 성공 판정 기준', s.login.successMarker.includes('logout.do'))
    check('웹툰·웹소설 주소가 다르다', s.apply.webtoon.menuUrl !== s.apply.webnovel.menuUrl)
    check('신청 폼 표식', s.apply.formMarker === '#workName')
    check('제출 버튼은 fn_save', s.apply.submitButton.includes('fn_save'))
    check('등록자번호를 포털에서 읽는다', s.apply.accountFields.registrantNo === 'input[name="pubRegNumber"]')
    check('현황 조회는 작품명 기준 (option value 는 WOR, 화면 글자는 작품명)', s.status.searchFieldValue === 'WOR')
    check('결과표 열 위치', s.status.columns.uci === 4 && s.status.columns.status === 8)
  }

  group('연동 설정 파일 — 새 항목 보강')
  {
    /*
     * 사용자 사본은 첫 실행 때 한 번 만들어진다. 새 버전에서 설정 항목이 늘었을 때
     * 그게 사본에 안 들어가면, 새 기능이 조용히 빈 값으로 동작한다. (실제로 겪은 문제)
     */
    const old = JSON.parse(fs.readFileSync(selectorConfig.BUNDLED_PATH, 'utf8'))
    delete old.apply.accountFields
    old.login.idInput = '#사용자가고친값'
    old.timeouts.pageLoad = 99999
    fs.writeFileSync(selectorConfig.userPath(), JSON.stringify(old, null, 2), 'utf8')

    const r = selectorConfig.ensureSeeded()
    check('빠진 항목을 채워 넣는다', r.added.includes('apply.accountFields'), r.added)
    const after = selectorConfig.load()
    check('사용자가 고친 값은 그대로', after.login.idInput === '#사용자가고친값')
    check('사용자가 고친 숫자도 그대로', after.timeouts.pageLoad === 99999)
    check('이미 다 있으면 아무것도 안 바꾼다', selectorConfig.ensureSeeded().added.length === 0)
    selectorConfig.resetToDefault()
  }

  group('포털 자동화 — 안전 관련 코드')
  {
    const portalSrc = fs.readFileSync(path.join(SRC, 'providers', 'portal.js'), 'utf8')
    const preloadSrc = fs.readFileSync(path.join(SRC, 'providers', 'portal-preload.js'), 'utf8')

    // 알림창 메시지를 페이지에 쌓아두면 화면이 넘어갈 때 같이 사라져 접수번호를 놓친다.
    check('알림창 메시지를 즉시 본체로 보낸다', preloadSrc.includes("ipcRenderer.send('portal:dialog'"))
    check('ipcRenderer 를 페이지에 노출하지 않는다', !/window\.\w*\s*=\s*.*ipcRenderer/.test(preloadSrc))
    check('결과 판정에는 alert 만 쓴다', portalSrc.includes("drainDialogs (kinds = ['alert'])"))
    check('제출 직전 알림창 큐를 비운다', (portalSrc.match(/clearDialogs\(\)/g) || []).length >= 3)

    // 페이지가 응답하지 않으면 영원히 기다리게 되어 로그인이 멈춘 것처럼 보인다.
    check('스크립트 실행에 시간 제한이 있다', portalSrc.includes('EVALUATE_TIMEOUT'))
    check('자격 확인 전체에도 상한이 있다', portalSrc.includes('VERIFY_ACCESS_BUDGET'))

    // 조회가 목록의 첫 행을 그대로 읽으면 모든 건에 같은 UCI 가 박힌다.
    check('작품명이 일치하는 줄만 고르고, 포털 키가 있으면 그 줄을 고른다', portalSrc.includes('items.find((i) => i.portalKey === record.portalKey)) || pickStatusItem(items, record)'))
    check('신청 버튼은 apply 에서만 누른다', (portalSrc.match(/apply\.submitButton/g) || []).length === 1)
  }

  group('옛 CSV 일괄 등록이 제거되었는지')
  {
    /*
     * 예전에는 CSV 를 읽어 여러 건을 신청하는 별도 메뉴가 있었다. 그건 지웠다.
     * 지금의 일괄 신청은 신청 화면에서 작품 카드를 늘리고 포털 공식 엑셀 양식으로
     * 내보내는 방식이라 완전히 다르다 — 그 코드까지 지우지 않도록 이름으로 구분해 둔다.
     */
    const files = ['index.js', 'csv.js', 'store.js'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n')
    const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'index.js'), 'utf8')
    const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8')
    const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')

    check('옛 CSV 신청 핸들러가 없다', !files.includes('applyBatch'))
    check('본체에 CSV 가져오기가 없다', !files.includes("csv:import"))
    check('통로에 batch 가 없다', !preload.includes('batch'))
    check('옛 CSV 화면 코드가 없다', !renderer.includes('renderBatch'))
    check('메뉴에서 빠졌다', !html.includes('data-view="batch"'))
    check('매핑 모듈이 삭제되었다', !fs.existsSync(path.join(SRC, 'import-map.js')))
    check('내보내기는 그대로 남아 있다', files.includes("records:export"))
    // 새 방식은 살아 있어야 한다.
    check('새 일괄 신청은 살아 있다', files.includes('uci:applyBulk'))
  }

  /* ------------------------------------------------------------ 데모 빌드 */
  group('데모 빌드 — 포털에 닿을 수 없는가')
  {
    /*
     * 데모 여부는 패키지 안 package.json 의 demo 값 하나로 갈린다.
     * 여기서는 그 값이 켜진 사본을 실제로 만들어 놓고, 그 사본의 모듈이
     * 정말 모의로만 도는지 확인한다. 주석이 아니라 동작으로 확인해야 하는 부분이다.
     */
    const stage = path.join(TMP, 'demo-stage')
    fs.rmSync(stage, { recursive: true, force: true })
    fs.mkdirSync(stage, { recursive: true })
    fs.cpSync(path.join(ROOT, 'src'), path.join(stage, 'src'), { recursive: true })
    fs.writeFileSync(path.join(stage, 'package.json'),
      JSON.stringify({ ...require(path.join(ROOT, 'package.json')), demo: true }), 'utf8')
    // 사본도 xlsx 같은 외부 모듈을 찾을 수 있어야 한다. 복사 대신 연결만 걸어 둔다.
    try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(stage, 'node_modules'), 'dir') } catch { /* 이미 있으면 무시 */ }

    const load = (rel) => {
      const f = path.join(stage, rel)
      delete require.cache[require.resolve(f)]
      return require(f)
    }

    check('사본은 데모로 인식된다', load('src/shared/app-mode.js').IS_DEMO === true)
    check('원본은 실제용 그대로', require(path.join(ROOT, 'src', 'shared', 'app-mode.js')).IS_DEMO === false)

    const demoStore = load('src/main/store.js')
    const demoProviders = load('src/main/providers/index.js')

    // 설정을 실제 포털로 바꿔 놓아도 데모는 넘어가면 안 된다.
    demoStore.setSettings({ mode: 'portal' })
    check('설정을 포털로 바꿔도 모의로 읽힌다', demoStore.getSettings().mode === 'mock', demoStore.getSettings().mode)
    check('제공자도 모의로 고정된다', demoProviders.current() === demoProviders.mock)

    // 시연 도중 설정 화면부터 채우게 만들지 않는다.
    fs.rmSync(path.join(TMP, 'uci-data.json'), { force: true })
    fs.rmSync(path.join(TMP, 'uci-data.json.bak'), { force: true })
    const seeded = load('src/main/store.js').getSettings()
    check('담당자 정보가 미리 채워져 있다', !!seeded.managerName && !!seeded.managerEmail && !!seeded.managerMobile, seeded.managerName)
    check('신청 자격이 통과 상태다', !!seeded.registrantNo && !!seeded.registrantVerifiedAt)
    check('개인정보 동의가 켜져 있다', seeded.privacyAgreed === true)

    fs.rmSync(stage, { recursive: true, force: true })
    fs.rmSync(path.join(TMP, 'uci-data.json'), { force: true })
  }

  group('데모 빌드 — 실제용이 오염되지 않았는가')
  {
    const pkg = require(path.join(ROOT, 'package.json'))
    // 이 값이 원본에 새겨지는 순간 실제용 빌드가 조용히 데모로 나간다.
    check('저장소 package.json 에 demo 가 없다', pkg.demo === undefined, pkg.demo)
    check('제품명이 실제용이다', pkg.productName === 'UCI 등록 도우미', pkg.productName)
    check('빌드 설정이 살아 있다', !!pkg.build && pkg.build.appId === 'io.tooning.uci.registrar')
    check('데모 빌드 스크립트가 별도로 있다', pkg.scripts['build:demo'] === 'node scripts/build-demo.js')
  }

  /* -------------------------------------------------- 일괄 신청용 엑셀 */
  group('복수 건 연속 신청 — 단건 신청을 작품마다 되풀이')
  {
    /*
     * 수행 계획서의 「복수 건 연속 신청(단건 폼 반복 호출)」. 포털의 엑셀 일괄신청은 쓰지 않는다 (포털이 막아 둔 기능).
     * 화면은 카드마다 단건 신청을 차례로 보내고, 막힌 카드만 남긴다. 엑셀 경로 코드는 본체에 남아 있지만 화면에서는 부르지 않는다.
     */
    const renderer = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8')
    const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8')
    check('작품 추가 단추가 늘 있다 (스위치 없음)', /data-action="add-work"/.test(renderer) && !/BULK_ENABLED/.test(renderer) && C.BULK_ENABLED === undefined)
    check('신청은 카드마다 단건 신청을 차례로 부른다', /for \(let i = 0; i < total; i\+\+\) \{[\s\S]{0,400}api\.apply\.one\(/.test(renderer))
    check('화면은 엑셀 일괄 경로를 부르지 않는다', !/api\.apply\.bulk/.test(renderer))
    check('막힌 카드만 남긴다', /state\.works = failed\.length \? failed\.map/.test(renderer))
    check('같은 작품명 갈래는 그 작품에서 멈춰 묻는다', /await askDuplicate\(/.test(renderer))
    check('헤더의 엑셀 업로드 칸과 안내 창이 없다', !/bulk-drop|onBulkFile/.test(renderer) && !/id="notice"/.test(html))
    check('엑셀 일괄 코드는 본체에 남아 있다 (화면에서 안 씀)',
      typeof mock.applyBulk === 'function' && typeof providers.portal.applyBulk === 'function' && typeof require(path.join(SRC, 'bulk-excel')).writeBulkFile === 'function')
  }

  group('일괄 신청 엑셀 — 공식 양식 유지')
  {
    const bulk = require(path.join(SRC, 'bulk-excel'))
    const XLSX = require('xlsx')
    const base = {
      contentType: 'webtoon', publishForm: '연재형', title: '우리 동네',
      writerRole: '글/그림', writer: '홍길동', ageGrade: '15+', genres: ['로맨스/순정', '일상'],
      syndicateName: '네이버 웹툰', url: 'https://comic.naver.com/webtoon/1',
      priceKind: '비매품 무료', price: '0', currency: '원',
      serialStatus: '연재중', episodeStart: '1', episodeEnd: '12'
    }
    const out = path.join(TMP, 'bulk.xls')
    bulk.writeBulkFile([base, { ...base, title: '옆집 강아지', writerRole: '글' }], out)

    const sh = XLSX.readFile(out).Sheets['일괄(대량)등록 신청 메타데이터']
    const at = (r, c) => (sh[XLSX.utils.encode_cell({ r, c })] || {}).v ?? ''

    // 서버는 이 표식으로 양식이 맞는지 판정한다. 깨지면 통째로 반려된다.
    check('버전 표식이 남는다', at(1, 0) === 'UCI_APPLY_WEBTOON_V02', at(1, 0))
    check('열 제목이 남는다', at(2, 0) === '연재유형*' && at(2, 1) === '콘텐츠명(작품명)*', [at(2, 0), at(2, 1)])
    check('설명줄이 남는다', String(at(3, 0)).includes('연재유형'))
    check('둘째 시트가 남는다', XLSX.readFile(out).SheetNames.length === 2)

    // 양식에 딸려오는 예시 3줄을 안 지우면 그대로 신청돼 버린다.
    check('양식의 예시 줄이 지워진다', at(4, 1) === '우리 동네' && at(6, 1) === '', [at(4, 1), at(6, 1)])

    check('작가역할이 그대로 나간다', at(4, 3) === '글/그림', at(4, 3))
    check('다른 역할도 그대로', at(5, 3) === '글', at(5, 3))
    {
      const two = bulk.toRow({ ...base, authors: [{ role: '글', name: '홍길동' }, { role: '그림', name: '김그림' }] })
      check('작가 여러 줄은 양식대로 쉼표 병렬 표기', two[3] === '글,그림' && two[4] === '홍길동,김그림', [two[3], two[4]])
    }
    check('연재처와 URL을 한 칸에 합친다',
      at(4, 2) === '네이버 웹툰(https://comic.naver.com/webtoon/1)', at(4, 2))
    check('URL이 없으면 연재처만', bulk.syndicateCell({ syndicateName: '탑툰' }) === '탑툰')
    check('장르를 쉼표로 잇는다', at(4, 8) === '로맨스/순정,일상', at(4, 8))
    check('비매품 무료도 그대로 나간다', at(4, 5) === '비매품 무료', at(4, 5))

    // 열 위치는 양식이 정한 것이라 서버가 제목이 아니라 자리로 읽는다.
    check('연재상태는 18번째 열', at(4, 17) === '연재중', at(4, 17))
    check('회차는 28·29번째 열', at(4, 27) === 1 && at(4, 28) === 12, [at(4, 27), at(4, 28)])
    check('30개 열을 넘지 않는다', bulk.toRow(base).length === 30)
    check('연령등급은 11번째 열', at(4, 10) === '15+', at(4, 10))

    // 양식의 예시 줄은 가격·회차를 숫자 셀로 둔다. 글자 셀('500')로 쓰면 서버가 숫자로 읽다 깨질 수 있다.
    const cellType = (r, c) => (sh[XLSX.utils.encode_cell({ r, c })] || {}).t
    check('가격수량은 숫자 셀', cellType(4, 6) === 'n' && at(4, 6) === 0, [cellType(4, 6), at(4, 6)])
    check('회차 번호는 숫자 셀', cellType(4, 27) === 'n' && cellType(4, 28) === 'n', [cellType(4, 27), cellType(4, 28)])
    // 안 쓰는 칸은 양식처럼 빈 셀로 둔다. 빈 글자('')를 넣으면 글자 셀이 생긴다.
    check('안 쓰는 칸은 셀을 만들지 않는다', cellType(4, 9) === undefined && cellType(4, 29) === undefined, [cellType(4, 9), cellType(4, 29)])
    check('숫자가 아닌 값은 글자로 둔다', bulk.number('abc') === 'abc' && bulk.number('') === null && bulk.number(' 12 ') === 12)

    const novel = path.join(TMP, 'bulk-novel.xls')
    bulk.writeBulkFile([{ ...base, contentType: 'webnovel' }], novel)
    check('웹소설은 다른 표식을 쓴다',
      (XLSX.readFile(novel).Sheets['일괄(대량)등록 신청 메타데이터'].B2 || XLSX.readFile(novel).Sheets['일괄(대량)등록 신청 메타데이터'].A2).v === 'UCI_APPLY_WEBNOVEL_V02')

    let blocked = false
    try { bulk.writeBulkFile([base, { ...base, contentType: 'webnovel' }], out) } catch { blocked = true }
    check('웹툰과 웹소설을 한 파일에 못 담는다', blocked)

    let empty = false
    try { bulk.writeBulkFile([], out) } catch { empty = true }
    check('빈 목록은 막는다', empty)

    check('양식 파일이 함께 배포된다',
      fs.existsSync(path.join(SRC, 'templates', 'bulk-webtoon.xls')) &&
      fs.existsSync(path.join(SRC, 'templates', 'bulk-webnovel.xls')))
  }

  console.log(`\n결과: ${pass}건 통과, ${fail}건 실패`)
  app.exit(fail ? 1 : 0)
})
