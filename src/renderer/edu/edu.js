/* =========================================================
   1) 캐릭터 (원작 없는 자체 디자인, SVG)
   ========================================================= */
const CHARS = {
  seoyun: { name:'한서윤 선배', hair:'#3B2A24', coat:'#2E4270', inner:'#FFFFFF', tie:'#3A6FE0', style:'bob' },
  jian:   { name:'윤지안 주무관', hair:'#26304A', coat:'#7FA7D9', inner:'#F6F1E7', tie:'#1B2B4B', style:'long', glasses:true }
};
function charSVG(id, expr){
  const c = CHARS[id]; const skin='#FBE3D2', line='#1B2B4B';
  const eyes = {
    normal:`<ellipse cx="128" cy="178" rx="8" ry="11" fill="${line}"/><ellipse cx="172" cy="178" rx="8" ry="11" fill="${line}"/><circle cx="131" cy="174" r="3" fill="#fff"/><circle cx="175" cy="174" r="3" fill="#fff"/>`,
    smile:`<path d="M119 180 q9 -10 18 0" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M163 180 q9 -10 18 0" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    surprise:`<ellipse cx="128" cy="178" rx="9" ry="13" fill="#fff" stroke="${line}" stroke-width="3"/><ellipse cx="172" cy="178" rx="9" ry="13" fill="#fff" stroke="${line}" stroke-width="3"/><circle cx="128" cy="180" r="4" fill="${line}"/><circle cx="172" cy="180" r="4" fill="${line}"/>`,
    worry:`<ellipse cx="128" cy="180" rx="7" ry="9" fill="${line}"/><ellipse cx="172" cy="180" rx="7" ry="9" fill="${line}"/><circle cx="130" cy="177" r="2" fill="#fff"/><circle cx="174" cy="177" r="2" fill="#fff"/>`
  }[expr] || '';
  const brows = expr==='worry' ? `<path d="M116 160 l22 6 M184 160 l-22 6" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`
             : expr==='surprise' ? `<path d="M116 154 q12 -8 24 0 M160 154 q12 -8 24 0" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>`
             : `<path d="M117 160 q11 -5 22 0 M161 160 q11 -5 22 0" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const mouth = { normal:`<path d="M142 214 q8 5 16 0" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
                  smile:`<path d="M138 210 q12 14 24 0 z" fill="#E77F7A" stroke="${line}" stroke-width="2"/>`,
                  surprise:`<ellipse cx="150" cy="216" rx="7" ry="9" fill="#E77F7A" stroke="${line}" stroke-width="2"/>`,
                  worry:`<path d="M142 218 q8 -5 16 0" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>` }[expr] || '';
  const back = c.style==='long'
    ? `<path d="M76 170 q-8 -110 74 -112 q82 2 74 112 l6 190 q-80 24 -160 0 z" fill="${c.hair}"/>`
    : `<path d="M78 196 q-14 -130 72 -134 q86 4 72 134 q-4 30 -14 42 l-116 0 q-10 -12 -14 -42 z" fill="${c.hair}"/>`;
  const front = c.style==='long'
    ? `<path d="M88 170 q4 -86 62 -90 q58 4 62 90 q-22 -44 -62 -52 q-40 8 -62 52 z" fill="${c.hair}"/>`
    : `<path d="M86 184 q-2 -96 64 -100 q66 4 64 100 q-14 -40 -30 -56 q-10 24 -60 34 q-18 4 -38 22 z" fill="${c.hair}"/>`;
  const glasses = c.glasses ? `<g fill="none" stroke="${line}" stroke-width="3"><rect x="110" y="162" width="36" height="30" rx="10"/><rect x="154" y="162" width="36" height="30" rx="10"/><path d="M146 176 h8"/></g>` : '';
  return `<svg viewBox="0 0 300 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${c.name}">
    ${back}
    <path d="M30 560 q6 -190 120 -206 q114 16 120 206 z" fill="${c.coat}"/>
    <path d="M118 356 l32 64 l32 -64 z" fill="${c.inner}"/>
    <path d="M144 380 l6 90 l6 -90 z" fill="${c.tie}"/>
    <rect x="132" y="262" width="36" height="100" rx="14" fill="${skin}"/>
    <ellipse cx="150" cy="186" rx="68" ry="80" fill="${skin}"/>
    <ellipse cx="112" cy="206" rx="12" ry="7" fill="#F6B8AE" opacity=".7"/><ellipse cx="188" cy="206" rx="12" ry="7" fill="#F6B8AE" opacity=".7"/>
    ${front}${brows}${eyes}${glasses}${mouth}
    <rect x="186" y="430" width="44" height="56" rx="6" fill="#FFFFFF" stroke="${line}" stroke-width="2"/>
    <path d="M150 356 l48 74" stroke="${c.tie}" stroke-width="4"/>
  </svg>`;
}

/* =========================================================
   2) 시나리오 데이터 — 내용 수정은 여기서
   t: 대사 / c: 캐릭터(seoyun·jian·me·null) / e: 표정 / bg: 배경
   {name} 은 플레이어 이름으로 치환됨
   ========================================================= */
const SCRIPT = [
  {type:'title'},

  {type:'chapter', no:'프롤로그', title:'신작 연재 첫날', chap:'프롤로그'},
  {bg:'office', c:null, t:'입사 한 달 차 신입 PD {name}. 오늘은 우리 스튜디오 신작 웹툰 「달빛 편의점」의 연재 첫날이다.'},
  {c:null, t:'메신저가 울린다. 대표님이다.\n\n“{name} PD, 달빛 편의점 1화 UCI 오늘 신청해 줘요. 모르는 건 서윤 PD한테 물어보고.”'},
  {c:'me', t:'유… 유씨아이? 그게 뭐지…'},
  {c:'seoyun', e:'smile', t:'표정 보니까 처음 들었구나? 괜찮아, 나도 작년에 똑같았어.'},
  {c:'seoyun', e:'normal', t:'오늘 안에 개념부터 신청까지 한 번에 끝내 보자. 중간중간 퀴즈 낼 거니까 긴장하고.'},

  {type:'chapter', no:'1장', title:'UCI가 뭐예요?', chap:'1장 · UCI 개념'},
  {bg:'office', c:'seoyun', e:'normal', t:'UCI는 Universal Content Identifier, 우리말로는 국가 콘텐츠 식별체계야.'},
  {c:'seoyun', e:'normal', t:'콘텐츠 하나하나에 겹치지 않는 고유 번호를 붙여서, 어디서 유통되든 “이게 그 작품이다”라고 알아볼 수 있게 하는 거지.'},
  {c:'seoyun', e:'smile', t:'책에 ISBN이 있잖아? 웹툰·웹소설에는 이제 UCI가 그 역할을 한다고 생각하면 돼.'},
  {c:'seoyun', e:'normal', t:'2008년에 방송통신표준(KS X OT0058)으로 채택된 국가 표준이라, 플랫폼이 자기들끼리 매기는 관리 번호와는 달라. 플랫폼이 바뀌어도 번호는 그대로야.'},
  {c:'seoyun', e:'worry', t:'또 하나 헷갈리기 쉬운 거. UCI는 작가한테 주는 번호가 아니라 작품·회차 같은 “콘텐츠”에 붙는 번호야. 저작권 등록과도 다른 제도고.'},
  {type:'lesson', title:'UCI 한눈에 보기', sub:'퀴즈 전에 핵심만 정리해 볼게요.', items:[
    ['이름','Universal Content Identifier, 국가 콘텐츠 식별체계'],
    ['하는 일','콘텐츠마다 겹치지 않는 고유 번호를 붙여, 어디서 유통되든 같은 작품으로 알아볼 수 있게 함'],
    ['지위','2008년 방송통신표준(KS X OT0058)으로 채택된 국가 표준'],
    ['붙는 대상','작가(사람)가 아니라 작품·회차 같은 콘텐츠'],
    ['헷갈리지 말 것','플랫폼 자체 관리 번호, 저작권 등록 번호와는 다른 제도']]},
  {type:'choice', pts:10, q:'UCI를 가장 정확하게 설명한 것은?',
    opts:[
      ['웹툰 플랫폼마다 따로 매기는 작품 관리 번호','no','플랫폼 자체 번호와는 달라. UCI는 국가 표준이라 플랫폼이 달라도 같은 번호로 통해.'],
      ['디지털 콘텐츠에 유일한 코드를 부여하는 국가 표준 식별체계','ok','정답! 2008년에 방송통신표준(KS X OT0058)으로 채택된 국가 표준이야.'],
      ['웹툰 작가 개인에게 발급되는 저작권 등록증 번호','no','작가가 아니라 콘텐츠(작품·회차)에 붙는 번호야. 저작권 등록과도 별개 제도고.']
    ]},
  {c:'seoyun', e:'normal', t:'UCI에는 알아 두면 좋은 특징이 네 가지 있어. 하나씩 볼게.'},
  {c:'seoyun', e:'normal', t:'첫째, 유일성. 서로 다른 콘텐츠에 같은 번호가 붙는 일은 없어. 그래서 국가가 번호를 관리하는 거야.'},
  {c:'seoyun', e:'normal', t:'둘째, 호환성. ISBN·ISSN·DOI처럼 이미 쓰이던 다른 식별번호도 UCI 안에 담을 수 있어서 기존 번호와 함께 쓸 수 있어.'},
  {c:'seoyun', e:'normal', t:'셋째, 변환 서비스. 온라인에서 UCI를 누르면 그 콘텐츠의 URL이나 작품 정보(메타데이터) 같은 관련 정보를 보여줘.'},
  {c:'seoyun', e:'smile', t:'넷째, 포괄성. 한국 안에서만이 아니라 전 세계 범위에서 하나뿐인 번호로 쓰이도록 만들어졌어.'},
  {type:'lesson', title:'UCI의 네 가지 특징', items:[
    ['유일성','서로 다른 콘텐츠에 같은 식별자가 부여되지 않는다'],
    ['호환성','ISBN·ISSN·DOI 같은 기존 식별자를 수용할 수 있다'],
    ['변환 서비스','UCI를 누르면 URL·메타데이터 등 관련 정보를 보여준다'],
    ['포괄성','전 세계 범위에서 유일한 식별자로 쓰인다']]},
  {type:'match', pts:10, q:'UCI의 특징과 설명을 짝지어 보세요', sub:'왼쪽을 누른 뒤 알맞은 오른쪽을 누르면 연결됩니다.',
    pairs:[
      ['유일성','서로 다른 콘텐츠에 같은 식별자가 부여되지 않는다'],
      ['호환성','ISBN·ISSN·DOI 같은 기존 식별자를 수용할 수 있다'],
      ['변환 서비스','UCI를 누르면 URL·메타데이터 등 관련 정보를 보여준다'],
      ['포괄성','전 세계 범위에서 유일한 식별자로 쓰인다']
    ]},

  {type:'chapter', no:'2장', title:'왜 지금 받아야 할까', chap:'2장 · 정책 배경'},
  {bg:'office', c:'me', t:'그런데 선배, 예전에는 웹툰도 ISBN 받지 않았어요?'},
  {c:'seoyun', e:'normal', t:'맞아. 그런데 ISBN은 한 권으로 끝나는 출판물용이라 매주 회차가 쌓이는 연재물이랑 잘 안 맞았어.'},
  {c:'seoyun', e:'normal', t:'그래서 2022년 1월에 연재형 웹콘텐츠는 ISBN 발급 대상에서 빠졌고, 그 자리를 UCI가 이어받았어.'},
  {c:'seoyun', e:'smile', t:'국립중앙도서관이 2025년 9월부터 웹툰·웹소설에 UCI를 부여하기 시작했고, 지금은 회차 단위로도 받을 수 있어.'},
  {c:'seoyun', e:'normal', t:'비용이 싸서 바꾼 것도, 해외에서 ISBN을 안 받아 줘서 바꾼 것도 아니야. 핵심은 딱 하나, “연재”라는 형태가 ISBN과 안 맞았다는 거.'},
  {type:'lesson', title:'ISBN에서 UCI로 바뀐 이유', items:[
    ['ISBN','한 권으로 완결되는 출판물에 붙이는 번호'],
    ['문제','웹툰·웹소설은 회차가 계속 늘어나는 연재형이라 ISBN 기준과 맞지 않음'],
    ['2022년 1월','연재형 웹콘텐츠가 ISBN 발급 대상에서 제외됨'],
    ['2025년 9월','국립중앙도서관이 웹툰·웹소설에 UCI 부여 시작'],
    ['지금','작품 단위는 물론 회차 단위로도 발급 가능']]},
  {type:'choice', pts:10, q:'연재형 웹툰·웹소설이 ISBN 대신 UCI를 받게 된 이유로 가장 알맞은 것은?',
    opts:[
      ['ISBN보다 발급 비용이 저렴해서','no','비용 문제가 아니야. 핵심은 연재라는 형태에 있어.'],
      ['연재형 콘텐츠가 단일 출판물 기준인 ISBN 발급 대상에서 제외되어서','ok','정답! 회차가 계속 늘어나는 연재물은 ISBN 체계와 맞지 않아서 2022년에 발급 대상에서 빠졌어.'],
      ['해외 플랫폼이 ISBN을 인정하지 않아서','no','해외 인정 여부 때문은 아니야. 연재 형태가 ISBN 기준과 안 맞는 게 이유야.']
    ]},
  {bg:'library', c:'jian', e:'smile', t:'안녕하세요, 국립중앙도서관 UCI 담당 윤지안입니다. 서윤 PD님이 신입 교육 중이라고 하셔서 잠깐 들렀어요.'},
  {c:'jian', e:'normal', t:'UCI 제도에는 기관이 여럿 등장해서 처음엔 헷갈리실 거예요. 역할만 구분해 두시면 됩니다.'},
  {c:'jian', e:'normal', t:'UCI 전체를 총괄하는 곳은 한국저작권위원회, 웹콘텐츠 분야 등록을 관리하는 곳은 저희 국립중앙도서관이에요.'},
  {c:'jian', e:'normal', t:'법적 근거는 「콘텐츠산업 진흥법」 제23조와 같은 법 시행령 제28조, 그리고 문화체육관광부 고시인 콘텐츠식별체계 준칙입니다.'},
  {c:'jian', e:'smile', t:'실제로 신청하실 때 상대하는 곳은 저희 국립중앙도서관이에요. 신청·발급·문의는 모두 도서관 시스템에서 합니다.'},
  {type:'lesson', title:'누가 무엇을 맡고 있나', items:[
    ['한국저작권위원회','UCI 제도 전체를 관리하는 총괄기구'],
    ['국립중앙도서관','웹툰·웹소설 UCI의 신청 접수와 발급을 맡는 등록관리기관'],
    ['콘텐츠산업 진흥법 제23조','콘텐츠 식별체계의 법적 근거 (시행령 제28조, 문체부 고시 준칙과 함께)']]},
  {type:'match', pts:10, q:'기관·근거와 역할을 연결해 보세요', sub:'UCI 제도를 이루는 세 축입니다.',
    pairs:[
      ['한국저작권위원회','UCI 총괄기구'],
      ['국립중앙도서관','웹콘텐츠 UCI 등록관리기관'],
      ['콘텐츠산업 진흥법 제23조','콘텐츠 식별체계의 법적 근거']
    ]},
  {c:'jian', e:'normal', t:'참고로 UCI는 연재 허가증이 아니라 식별 번호예요. 한 번 받으면 계속 쓰는 번호라 매년 갱신할 필요도 없고요.'},

  {type:'chapter', no:'3장', title:'누가 신청할 수 있을까', chap:'3장 · 발급 자격'},
  {bg:'library', c:'jian', e:'normal', t:'UCI는 아무나 신청하는 번호가 아니에요. 먼저 “등록자번호”를 받아야 합니다.'},
  {c:'jian', e:'normal', t:'등록자 요건은 두 가지예요. 웹콘텐츠의 제작 또는 유통에 참여하는 사업자일 것, 그리고 관할 시·구청에 출판사 신고를 마쳐 출판사 신고확인증이 있을 것.'},
  {c:'jian', e:'normal', t:'여기서 “사업자”에는 작품을 만드는 제작사뿐 아니라, 작품을 유통하는 플랫폼 사업자도 포함돼요.'},
  {c:'jian', e:'worry', t:'반대로 출판사 신고를 하지 않은 개인 작가, 예를 들어 SNS에 연재하는 인스타툰 작가는 지금 기준으로는 등록자번호를 받을 수 없어요.'},
  {c:'jian', e:'worry', t:'주의하실 점! 등록자번호는 등록자별로 딱 하나만 발급되고, 발급된 뒤에는 바꿀 수 없어요. 발행처명 같은 정보가 신고확인증과 다르면 번호가 나오지 않으니 꼼꼼히 확인하세요.'},
  {c:'jian', e:'normal', t:'번호 자체는 못 바꾸지만, 주소나 대표자명처럼 발행자 정보가 바뀐 경우에는 정정 신청을 할 수 있어요.'},
  {type:'lesson', title:'등록자번호를 받을 수 있는 조건', items:[
    ['조건 ①','웹콘텐츠의 제작 또는 유통에 참여하는 사업자 (제작사·유통 플랫폼 모두 해당)'],
    ['조건 ②','관할 시·구청에 출판사 신고를 마치고 출판사 신고확인증을 발급받음'],
    ['받을 수 없는 경우','출판사 신고를 하지 않은 개인 창작자 (예: 개인 SNS 연재 작가)'],
    ['개수·변경','등록자별 1개, 발급 후 번호 변경 불가'],
    ['정정 가능','발행처명·주소·대표자명 등 정보 변경은 정정 신청으로 처리']]},
  {c:'seoyun', e:'smile', t:'우리 스튜디오는 출판사 신고도 했고 등록자번호도 작년에 받아 뒀어. 그래서 오늘은 바로 작품 신청으로 가면 돼.'},
  {type:'judge', ptsEach:5, q:'이 사람들은 등록자번호를 신청할 수 있을까요?', sub:'각 사례에 O 또는 X를 눌러 주세요.',
    cases:[
      {who:'웹툰 제작 스튜디오 A', desc:'출판사 신고를 마치고 신고확인증을 발급받았다.', ans:true, fb:'요건 두 가지를 모두 갖췄어요.'},
      {who:'인스타툰 작가 B', desc:'개인 SNS에 연재 중이며 출판사 신고는 하지 않았다.', ans:false, fb:'출판사 신고가 없어 현행 기준으로는 등록자번호를 받을 수 없어요.'},
      {who:'웹소설 유통 플랫폼 C', desc:'웹소설을 유통하는 사업자이며 출판사 신고를 마쳤다.', ans:true, fb:'제작뿐 아니라 유통에 참여하는 사업자도 요건에 해당해요.'},
      {who:'제작사 D', desc:'등록자번호를 받았는데, 번호가 마음에 안 들어 새 번호로 바꾸려 한다.', ans:false, fb:'등록자번호는 발급 후 변경할 수 없어요. 발행처 주소·대표자명 같은 정보 정정은 별도 신청이 가능합니다.'}
    ]},

  {type:'chapter', no:'4장', title:'신청은 이런 순서로', chap:'4장 · 신청 절차'},
  {bg:'office', c:'seoyun', e:'normal', t:'자, 이제 실제 흐름을 정리해 보자. 처음 하는 사람은 순서를 헷갈려서 반려되는 경우가 많거든.'},
  {c:'seoyun', e:'normal', t:'시스템에 로그인하고 콘텐츠 유형을 고른 다음, 신청 방법을 골라. 신청 방법은 세 가지야.'},
  {c:'seoyun', e:'normal', t:'작품 하나를 입력하는 “작품 건별 신청”, 엑셀로 여러 작품을 올리는 “작품 일괄 신청”, 이미 UCI를 받은 작품에 새 회차를 붙이는 “회차 추가”.'},
  {c:'seoyun', e:'smile', t:'쉽게 말해 처음 등록하는 작품이면 건별 신청, 이미 받은 작품에 다음 화가 나오면 회차 추가야. 같은 작품을 새로 또 등록하면 작품이 두 개로 잡혀 버려.'},
  {c:'seoyun', e:'worry', t:'참고로 회차 추가는 우리 프로그램에서는 안 돼. 포털에서 직접 하는 거야. 우리 프로그램은 새 작품을 처음 신청할 때 쓰는 거고.'},
  {type:'lesson', title:'신청 방법 세 가지', items:[
    ['작품 건별 신청','처음 등록하는 작품 하나의 정보를 입력해 신청'],
    ['작품 일괄 신청','여러 작품의 정보를 엑셀로 한 번에 신청'],
    ['회차 추가','이미 UCI를 받은 작품에 새 회차를 이어 붙여 신청'],
    ['기억할 것','이미 받은 작품의 다음 화는 새 작품으로 등록하지 말고 회차 추가 (포털에서 직접)']]},
  {c:'seoyun', e:'normal', t:'신청하면 업무일 기준 3일 안에 처리되고, 결과는 이메일이랑 카카오톡 알림톡으로 와. 알림톡을 안 쓰면 문자로 오고.'},
  {c:'seoyun', e:'normal', t:'전체 순서를 한 번 정리해 줄게. 출판사 신고가 맨 앞이고, 등록자번호는 처음 한 번만 받으면 돼.'},
  {type:'lesson', title:'처음 UCI를 받는 순서', steps:true, items:['관할 시·구청 출판사 신고','시스템 로그인 후 등록자번호 신청·발급','콘텐츠 유형 선택 (웹툰/웹소설)','신청 방법 선택 후 작품·회차 정보 입력','신청 후 처리 결과 알림 확인 (업무일 3일 이내)']},
  {type:'order', pts:15, q:'처음 UCI를 받는 순서대로 눌러 보세요', sub:'앞에서 본 순서를 떠올리며 단계를 차례대로 누르세요.',
    items:['관할 시·구청 출판사 신고','시스템 로그인 후 등록자번호 신청·발급','콘텐츠 유형 선택 (웹툰/웹소설)','신청 방법 선택 후 작품·회차 정보 입력','신청 후 처리 결과 알림 확인 (업무일 3일 이내)']},
  {type:'choice', pts:10, q:'「달빛 편의점」 1화로 UCI를 받은 뒤, 다음 주 2화가 올라왔어요. 어떤 방법으로 신청해야 할까요?',
    opts:[
      ['작품 건별 신청으로 2화를 새 작품처럼 등록한다','no','그러면 같은 작품이 두 개로 등록돼 버려. 이미 받은 UCI에 이어 붙여야 해.'],
      ['회차 추가로 기존 UCI에 2화를 붙인다','ok','정답! 이미 등록·발급된 작품에는 회차 추가로 새 회차를 붙이면 돼.'],
      ['작품 일괄 신청으로 1화와 2화를 다시 함께 올린다','no','1화는 이미 발급됐으니 다시 올릴 필요가 없어. 회차 추가가 맞아.']
    ]},
  {c:'seoyun', e:'worry', t:'마지막으로 제일 중요한 거. UCI를 등록할 때는 저작권자의 동의가 필요해.'},
  {c:'seoyun', e:'normal', t:'동의 없이 등록하면 민·형사상 책임은 등록한 쪽이 지고, 발급이 취소될 수도 있어. 작가 계약서에 동의 조항이 있는지 꼭 확인하자.'},
  {c:'seoyun', e:'worry', t:'도서관이 대신 작가한테 동의를 받아 주지는 않아. 동의 확보는 신청하는 우리 몫이야.'},
  {type:'lesson', title:'저작권자 동의', items:[
    ['필수 여부','UCI 등록 시 저작권자의 동의가 반드시 필요'],
    ['동의 확보','신청하는 등록자가 직접 확보 (도서관이 대신 받지 않음)'],
    ['동의 없이 등록하면','민·형사상 법적 책임은 등록자에게 있고, 발급이 취소될 수 있음'],
    ['확인 방법','작가 계약서의 UCI 등록 동의 조항 등']]},
  {type:'choice', pts:10, q:'작가의 동의를 받지 않고 UCI를 등록했다면?',
    opts:[
      ['등록자가 법적 책임을 지고, 발급이 취소될 수 있다','ok','정답! 그래서 신청 전에 저작권자 동의를 반드시 확보해야 해.'],
      ['국립중앙도서관이 대신 작가에게 동의를 받아 준다','no','도서관이 대신 받아 주지 않아. 동의 확보는 등록자 몫이야.'],
      ['UCI는 공공 번호라 동의가 필요 없다','no','동의가 필요해. 없이 등록하면 등록자에게 책임이 돌아가.']
    ]},

  {type:'chapter', no:'5장', title:'직접 신청해 보기', chap:'5장 · 신청 실습'},
  {bg:'night', c:'seoyun', e:'smile', t:'이론은 끝! 이제 직접 해 보자. 실습은 우리 프로그램 실제 화면에서 할 거야.'},
  {c:'seoyun', e:'normal', t:'연습 모드라 포털에는 아무것도 안 보내. 끝나면 연습 기록도 지워지니까 편하게 눌러 봐.'},
  {c:'seoyun', e:'normal', t:'순서는 이래. 담당자 정보를 한 번 저장하고, 작품 정보를 채워서 신청하고, 심사 결과를 조회한 다음, 이력에서 발급된 UCI를 확인하는 거야.'},
  {c:'seoyun', e:'smile', t:'항목 옆 물음표에 마우스를 올리면 입력 기준이 나와. 모르겠으면 그거부터 봐. 화면 아래 띠에서 내가 단계마다 안내해 줄게.'},
  {type:'lesson', title:'신청 화면 입력 요령', sub:'실제 화면 그대로입니다. 이 순서대로 채우면 됩니다.', items:[
    ['담당자 정보','설정에서 한 번만 저장. 신청할 때마다 자동으로 들어감'],
    ['작품명·작가명','연재처에 공개된 표기 그대로'],
    ['장르·연재처','직접 쓰지 말고 목록에서 선택'],
    ['연령등급','연재처에 표시된 등급 그대로 선택 (전체·12세·15세·18세 이상). 포털이 꼭 확인하는 항목'],
    ['회차 범위','숫자만 입력 (1화~10화 → 1, 10)'],
    ['저작권자 동의','계약서로 동의를 확인한 뒤 체크'],
    ['비슷한 작품','「이전 신청 불러오기」로 이전 입력값을 가져와 고쳐 쓰면 빠르다. 회차 범위는 새로 넣는다'],
    ['결과 확인','대시보드 「심사 결과 조회」 → 신청 이력에서 UCI 확인']]},
  {type:'lesson', title:'핵심 요약', items:[
    ['UCI','콘텐츠마다 유일한 코드를 부여하는 국가 표준 식별체계'],
    ['기관','총괄은 한국저작권위원회, 웹콘텐츠 등록관리는 국립중앙도서관'],
    ['등록자번호','출판사 신고 후 발급. 한 번만 받고, 발급 후 변경 불가'],
    ['신청 방법','작품 건별 · 작품 일괄은 프로그램에서, 회차 추가는 포털에서 직접'],
    ['처리','업무일 3일. 결과는 이메일·알림톡, 그리고 프로그램의 심사 결과 조회'],
    ['저작권자 동의','필수. 없이 등록하면 책임은 등록자에게']]},
  {type:'practice'}
];

/* =========================================================
   3) 엔진
   ========================================================= */
const $ = s => document.querySelector(s);
const layer=$('#layer'), bgEl=$('#bg'), charEl=$('#char'), logEl=$('#log');
const S = { i:0, score:0, name:'', log:[], typing:null, attempts:0 };

const fill = t => t.replace(/\{name\}/g, S.name || '신입');
function esc(t){ return String(t).replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function addScore(n){ S.score += n; updateGauge(); }
function updateGauge(){ /* 점수는 매기지 않는다. 교육이지 시험이 아니다. 퀴즈 처리 경로는 그대로 두고 표시만 뺐다. */ }
function setBg(bg){ if(bg){ bgEl.className = 'bg bg-'+bg; } }
/*
 * 인물 그림 파일. 비어 있으면 아래 charSVG 가 코드로 그린다.
 * 일러스트가 준비되면 img/ 에 넣고 여기 경로만 적으면 된다. 표정별로 한 장씩.
 *   seoyun: { normal:'img/seoyun-normal.png', smile:'img/seoyun-smile.png', surprise:'…', worry:'…' }
 */
const CHAR_IMAGES = {
  seoyun: { normal:'img/seoyun-normal.png', smile:'img/seoyun-smile.png', surprise:'img/seoyun-surprise.png', worry:'img/seoyun-worry.png' },
  jian:   { normal:'img/jian-normal.png',   smile:'img/jian-smile.png',   surprise:'img/jian-surprise.png',   worry:'img/jian-worry.png' }
};
function charMarkup(id, expr){
  const src = (CHAR_IMAGES[id]||{})[expr] || (CHAR_IMAGES[id]||{}).normal;
  return src ? `<img src="${src}" alt="${CHARS[id].name}" draggable="false">` : charSVG(id, expr);
}
function setChar(c,e){
  if(c && CHARS[c]){ charEl.innerHTML = charMarkup(c,e||'normal'); charEl.classList.remove('hide'); }
  else charEl.classList.add('hide');
}
function shuffle(a){ const b=a.slice(); for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; }
function next(){ S.i++; render(); }
function pushLog(who, t){ S.log.push({who, t}); }

function render(){
  const st = SCRIPT[S.i]; if(!st) return;
  clearInterval(S.typing); layer.innerHTML='';
  if(st.chap) $('#chap').textContent = st.chap;
  setBg(st.bg);
  const T = st.type || 'say';
  ({title:renderTitle, chapter:renderChapter, say:renderSay, lesson:renderLesson, choice:renderChoice, match:renderMatch,
    order:renderOrder, judge:renderJudge, skip:renderSkip, practice:renderPractice})[T](st);
  bindReview();
}

/* 설명 카드 */
function lessonHTML(st){
  const body = st.items.map((it,n)=> st.steps
    ? `<div class="li"><span class="num">${n+1}</span><span>${esc(it)}</span></div>`
    : `<div class="li"><b>${esc(it[0])}</b><span>${esc(it[1])}</span></div>`).join('');
  return `<h2>${esc(st.title)}</h2>${st.sub?`<div class="sub">${esc(st.sub)}</div>`:''}<div class="lesson ${st.steps?'steps':''}">${body}</div>`;
}
function renderLesson(st){
  setChar(null);
  layer.innerHTML = `<div class="panel">${lessonHTML(st)}<div class="row"><button class="btn" id="nb">이해했어요</button></div></div>`;
  pushLog('정리', st.title + ' — ' + st.items.map(it=>Array.isArray(it)?it[0]+': '+it[1]:it).join(' / '));
  $('#nb').onclick=next; $('#nb').focus();
}
function lastLessonIdx(){ for(let j=S.i-1;j>=0;j--){ if(SCRIPT[j].type==='lesson') return j; if(SCRIPT[j].type==='chapter') break; } return -1; }
function reviewHTML(){ return lastLessonIdx()>=0 ? '<button class="btn ghost left" id="rv">설명 다시 보기</button>' : ''; }
function bindReview(){
  const b=$('#rv'); if(!b) return;
  b.onclick=()=>{
    const st=SCRIPT[lastLessonIdx()]; if(!st) return;
    const d=document.createElement('div'); d.className='review';
    d.innerHTML=`<div class="panel">${lessonHTML(st)}<div class="row"><button class="btn" id="rvc">문제로 돌아가기</button></div></div>`;
    layer.appendChild(d); $('#rvc').onclick=()=>d.remove(); $('#rvc').focus();
  };
}

/* 타이틀 */
function renderTitle(){
  setChar(null);
  layer.innerHTML = `<div class="cover static">
    <div class="title-main">UCI 첫 발급 대작전</div>
    <div class="title-sub">신입 PD가 되어 선배와 함께 웹툰 UCI를 처음부터 끝까지 받아 보는 실습입니다.<br>약 15분 · 설명 → 퀴즈 → 신청 실습 순서로 진행</div>
    <div class="namebox"><input id="nm" type="text" maxlength="8" placeholder="내 이름" aria-label="플레이어 이름"><button class="btn" id="go">시작하기</button></div>
    <div class="hint">Enter·Space 키로도 대화를 넘길 수 있습니다</div></div>`;
  const go = ()=>{ S.name = ($('#nm').value.trim() || '신입'); next(); };
  $('#go').onclick = go; $('#nm').onkeydown = e=>{ if(e.key==='Enter') go(); };
  setTimeout(()=>$('#nm').focus(), 50);
}

/* 챕터 표지 */
function renderChapter(st){
  setChar(null);
  layer.innerHTML = `<div class="cover" id="cv" tabindex="0"><div class="no">${esc(st.no)}</div><div class="ttl">${esc(st.title)}</div><div class="hint">눌러서 계속</div></div>`;
  $('#cv').onclick = next; $('#cv').focus();
}

/* 대사 */
function renderSay(st){
  setChar(st.c, st.e);
  const who = st.c==='me' ? S.name : (st.c ? CHARS[st.c].name : '');
  const text = fill(st.t);
  pushLog(who || '—', text);
  layer.innerHTML = `<div class="dialog ${st.c?'':'narr'}" id="dlg" tabindex="0" role="button" aria-label="대화 넘기기">
    <div class="name">${esc(who)}</div><div class="txt" id="txt"></div><div class="next" id="nx" hidden>▼</div></div>`;
  const txt=$('#txt'), nx=$('#nx'); let k=0; let done=false;
  const finish=()=>{ clearInterval(S.typing); txt.textContent=text; done=true; nx.hidden=false; };
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else S.typing = setInterval(()=>{ k++; txt.textContent=text.slice(0,k); if(k>=text.length) finish(); }, 24);
  const dlg=$('#dlg'); dlg.onclick = ()=> done ? next() : finish(); dlg.focus();
}

/* 객관식 */
function renderChoice(st){
  setChar(CHARS[lastSpeaker()] ? lastSpeaker() : 'seoyun','normal');
  let first=true, solved=false;
  const opts = shuffle(st.opts);
  layer.innerHTML = `<div class="panel"><h2>${esc(st.q)}</h2><div class="opts" id="opts"></div><div id="fb"></div>
    <div class="row">${reviewHTML()}<button class="btn" id="nb" disabled>계속</button></div></div>`;
  const box=$('#opts');
  opts.forEach(([t,r,f])=>{
    const b=document.createElement('button'); b.className='opt'; b.textContent=t;
    b.onclick=()=>{
      if(solved) return;
      b.classList.add(r); $('#fb').innerHTML = `<div class="fb ${r}">${esc(f)}</div>`;
      if(r==='ok'){ solved=true; if(first) addScore(st.pts); $('#nb').disabled=false; $('#nb').focus(); setChar(charEl.dataset.c||lastSpeaker(),'smile'); }
      else { first=false; b.disabled=true; setChar(lastSpeaker(),'worry'); }
      pushLog('퀴즈', `${st.q} → ${t}`);
    };
    box.appendChild(b);
  });
  $('#nb').onclick=next;
}
function lastSpeaker(){ for(let j=S.i;j>=0;j--){ const c=SCRIPT[j].c; if(c && CHARS[c]) return c; } return 'seoyun'; }

/* 짝짓기 */
function renderMatch(st){
  setChar(null);
  let miss=0, sel=null, left=st.pairs.length;
  const L = shuffle(st.pairs.map((p,i)=>({t:p[0],i}))), R = shuffle(st.pairs.map((p,i)=>({t:p[1],i})));
  layer.innerHTML = `<div class="panel"><h2>${esc(st.q)}</h2><div class="sub">${esc(st.sub||'')}</div>
    <div class="match"><div class="col" id="lc"></div><div class="col" id="rc"></div></div><div id="fb"></div>
    <div class="row">${reviewHTML()}<button class="btn" id="nb" disabled>계속</button></div></div>`;
  const mk=(o,side)=>{ const b=document.createElement('button'); b.className='chip'; b.textContent=o.t; b.dataset.i=o.i; b.dataset.s=side; return b; };
  L.forEach(o=>{ const b=mk(o,'L'); b.onclick=()=>{ if(b.classList.contains('done')) return; document.querySelectorAll('#lc .chip').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); sel=b; }; $('#lc').appendChild(b); });
  R.forEach(o=>{ const b=mk(o,'R'); b.onclick=()=>{
    if(b.classList.contains('done')) return;
    if(!sel){ $('#fb').innerHTML='<div class="fb no">왼쪽 항목을 먼저 눌러 주세요.</div>'; return; }
    if(sel.dataset.i===b.dataset.i){ sel.classList.remove('sel'); sel.classList.add('done'); b.classList.add('done'); sel=null; left--; $('#fb').innerHTML='';
      if(left===0){ if(miss===0) addScore(st.pts); $('#fb').innerHTML=`<div class="fb ok">${miss===0?'한 번에 모두 맞혔어요!':'모두 연결했어요. 틀린 조합은 '+miss+'번이었어요.'}</div>`; $('#nb').disabled=false; $('#nb').focus(); pushLog('활동', st.q+' 완료'); } }
    else { miss++; b.classList.add('shake'); setTimeout(()=>b.classList.remove('shake'),300); $('#fb').innerHTML='<div class="fb no">짝이 맞지 않아요. 다시 골라 보세요.</div>'; }
  }; $('#rc').appendChild(b); });
  $('#nb').onclick=next;
}

/* 순서 맞추기 */
function renderOrder(st){
  setChar(null);
  let seq=[], firstTry=true, solved=false;
  const pool = shuffle(st.items.map((t,i)=>({t,i})));
  layer.innerHTML = `<div class="panel"><h2>${esc(st.q)}</h2><div class="sub">${esc(st.sub||'')}</div>
    <div class="order-seq" id="sq"></div><div class="order-pick" id="pk"></div><div id="fb"></div>
    <div class="row">${reviewHTML()}<button class="btn ghost" id="rs">다시 고르기</button><button class="btn" id="ck" disabled>확인</button><button class="btn" id="nb" hidden>계속</button></div></div>`;
  const draw=()=>{
    $('#sq').innerHTML = seq.length ? seq.map((o,n)=>`<div class="item"><span class="num">${n+1}</span>${esc(o.t)}</div>`).join('') : '<div class="empty">여기에 순서가 쌓입니다</div>';
    $('#pk').innerHTML=''; pool.filter(o=>!seq.includes(o)).forEach(o=>{ const b=document.createElement('button'); b.className='chip'; b.textContent=o.t; b.onclick=()=>{ if(solved) return; seq.push(o); draw(); }; $('#pk').appendChild(b); });
    $('#ck').disabled = seq.length!==st.items.length || solved;
  };
  $('#rs').onclick=()=>{ if(solved) return; seq=[]; $('#fb').innerHTML=''; draw(); };
  $('#ck').onclick=()=>{
    const ok = seq.every((o,n)=>o.i===n);
    if(ok){ solved=true; if(firstTry) addScore(st.pts); $('#fb').innerHTML='<div class="fb ok">순서가 맞아요! 등록자번호는 첫 신청 전에 한 번만 받으면 되고, 그다음부터는 유형 선택부터 시작하면 됩니다.</div>'; $('#ck').hidden=true; $('#rs').hidden=true; $('#nb').hidden=false; $('#nb').focus(); pushLog('활동','신청 순서 맞추기 완료'); }
    else { firstTry=false; const bad = seq.findIndex((o,n)=>o.i!==n); $('#fb').innerHTML=`<div class="fb no">${bad+1}번째 단계부터 순서가 어긋났어요. 다시 골라 보세요.</div>`; }
  };
  $('#nb').onclick=next; draw();
}

/* O/X 판정 */
function renderJudge(st){
  setChar(null);
  let left=st.cases.length;
  layer.innerHTML = `<div class="panel"><h2>${esc(st.q)}</h2><div class="sub">${esc(st.sub||'')}</div><div class="cases" id="cs"></div>
    <div class="row">${reviewHTML()}<button class="btn" id="nb" disabled>계속</button></div></div>`;
  st.cases.forEach(cs=>{
    const d=document.createElement('div'); d.className='case';
    d.innerHTML=`<div class="who"><b>${esc(cs.who)}</b>${esc(cs.desc)}<div class="note"></div></div><div class="ox"><button aria-label="신청 가능">O</button><button aria-label="신청 불가">X</button></div>`;
    const [bo,bx]=d.querySelectorAll('.ox button');
    const pick=v=>{ const right = v===cs.ans; d.classList.add(right?'ok':'no'); if(right) addScore(st.ptsEach);
      d.querySelector('.note').textContent = (right?'맞아요. ':'아쉬워요. 정답은 '+(cs.ans?'O':'X')+' — ')+cs.fb;
      bo.disabled=bx.disabled=true; left--; if(left===0){ $('#nb').disabled=false; $('#nb').focus(); } };
    bo.onclick=()=>pick(true); bx.onclick=()=>pick(false);
    $('#cs').appendChild(d);
  });
  $('#nb').onclick=next;
}

/* 신청 실습 */
function renderSkip(st){
  setChar(null);
  layer.innerHTML = `<div class="skip" id="sk" tabindex="0">${esc(st.text)}<div class="days">${esc(st.days)}</div><div class="days">눌러서 계속</div></div>`;
  $('#sk').onclick=next; $('#sk').focus();
}

/* 실습 — 프로그램 실제 화면으로 넘긴다 */
function renderPractice(){
  setChar('seoyun','smile');
  layer.innerHTML = `<div class="panel practice">
    <h2>이제 직접 해 볼까요</h2>
    <div class="sub">프로그램 실제 화면에서 담당자 정보 저장 → 작품 신청 → 결과 조회 → UCI 확인까지 해봅니다.<br>연습 모드라 포털에는 아무것도 보내지 않고, 끝나면 연습 기록은 지워집니다. 약 2분 걸립니다.</div>
    <div class="row center"><button class="btn" id="pr">연습 시작하기</button><button class="btn ghost" id="lt">나중에 하기</button></div></div>`;
  pushLog('실습','프로그램 실제 화면에서 연습');
  $('#pr').onclick=()=>post('practice'); $('#lt').onclick=()=>post('close'); $('#pr').focus();
}

/*
 * 이 페이지는 프로그램 안에 iframe 으로 들어간다. 바깥과는 메시지로만 이야기한다.
 *   ready    — 페이지가 떴다
 *   practice — '연습 시작' 을 눌렀다 → 프로그램이 연습 모드로 들어간다
 *   close    — 닫거나 '나중에' 를 눌렀다
 */
function post(event, extra){
  try{ window.parent.postMessage({source:'uci-edu', event, name:S.name, ...(extra||{})}, '*'); }catch(e){ /* 바깥 창이 없으면 무시 */ }
}

/* 기록·리셋·키보드 */
function openLog(){
  logEl.innerHTML = `<button class="close" id="lc2">닫기</button>` + (S.log.map(l=>`<p><b>${esc(l.who)}</b>${esc(l.t)}</p>`).join('') || '<p>아직 기록이 없습니다.</p>');
  logEl.classList.add('on'); $('#lc2').onclick=()=>logEl.classList.remove('on'); $('#lc2').focus();
}
function reset(){ S.i=0; S.score=0; S.log=[]; S.name=''; $('#chap').textContent='UCI 첫 발급 대작전'; setBg('office'); render(); }
$('#btnLog').onclick=()=> logEl.classList.contains('on') ? logEl.classList.remove('on') : openLog();
$('#btnReset').onclick=()=>{ if(confirm('처음부터 다시 시작할까요? 진행 상황이 초기화됩니다.')) reset(); };
$('#btnClose').onclick=()=>post('close');
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && logEl.classList.contains('on')){ logEl.classList.remove('on'); return; }
  if(e.key!=='Enter' && e.key!==' ') return;
  const t=(SCRIPT[S.i]||{}).type||'say';
  if(['say','chapter','skip'].includes(t) && !logEl.classList.contains('on') && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); const el = $('#dlg')||$('#cv')||$('#sk'); if(el) el.click();
  }
});
render();
post('ready');
