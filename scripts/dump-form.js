/* global copy */
/* ===========================================================================
   포털 화면 구조 뽑기 (개발자도구 콘솔용)

   selectors.json 을 손으로 채우는 대신, 화면에 있는 입력칸을 한 번에 긁어냅니다.

   사용법
     1. 크롬으로 https://www.nl.go.kr/seoji/ 에 로그인합니다.
     2. UCI → UCI 신청 → '작품 건별 신청' 화면으로 들어갑니다.
     3. F12 → Console 탭을 엽니다.
        (크롬이 "허용하려면 allow pasting을 입력하세요" 라고 하면 그대로 입력 후 Enter)
     4. 이 파일 내용을 통째로 붙여넣고 Enter.
     5. 결과가 클립보드에 복사됩니다. 그대로 붙여넣어 전달해 주세요.

   'UCI 신청 현황 조회' 화면에서도 똑같이 한 번 더 실행해 주세요.

   ※ 아이디·비밀번호는 수집하지 않습니다. password 칸은 위치만 기록하고 값은 읽지 않습니다.
   =========================================================================== */

(() => {
  /** 이 요소를 다시 찾아낼 수 있는 CSS 선택자를 만든다. 짧고 안정적인 것부터 시도한다. */
  const buildSelector = (el) => {
    const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s)

    // 1순위: id — 단, 자동 생성된 티가 나는 건 신뢰하지 않는다.
    if (el.id && !/^\d|:|\d{4,}/.test(el.id)) {
      const s = '#' + esc(el.id)
      try { if (document.querySelectorAll(s).length === 1) return s } catch { /* 선택자가 잘못되면 다음 후보로 */ }
    }
    // 2순위: name
    if (el.name) {
      const s = `${el.tagName.toLowerCase()}[name="${el.name}"]`
      try { if (document.querySelectorAll(s).length === 1) return s } catch { /* 선택자가 잘못되면 다음 후보로 */ }
      // 같은 name 이 여럿이면 폼 이름으로 좁힌다.
      if (el.form && el.form.name) {
        const scoped = `form[name="${el.form.name}"] ${s}`
        try { if (document.querySelectorAll(scoped).length === 1) return scoped } catch { /* 선택자가 잘못되면 다음 후보로 */ }
      }
    }
    // 3순위: 부모를 타고 올라가며 경로를 만든다.
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase()
      if (node.id && !/^\d|:|\d{4,}/.test(node.id)) { parts.unshift('#' + esc(node.id)); break }
      const siblings = node.parentElement
        ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName)
        : []
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  /** 입력칸 옆에 붙은 설명 문구를 찾는다. 어느 항목인지 알아보는 단서가 된다. */
  const findLabel = (el) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (el.id) {
      const byFor = document.querySelector(`label[for="${el.id}"]`)
      if (byFor) return clean(byFor.textContent)
    }
    const wrapping = el.closest('label')
    if (wrapping) return clean(wrapping.textContent)
    // 표 형태의 폼이면 같은 행의 머리글 칸이 항목 이름인 경우가 많다.
    const cell = el.closest('td, dd')
    if (cell) {
      const head = cell.parentElement?.querySelector('th, dt')
      if (head) return clean(head.textContent)
    }
    return clean(el.getAttribute('title') || el.placeholder || '')
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  }

  const fields = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'hidden')
    .map((el) => {
      const info = {
        selector: buildSelector(el),
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        label: findLabel(el),
        placeholder: el.placeholder || '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        visible: visible(el),
        form: el.form?.name || el.form?.id || ''
      }
      // 선택 목록은 어떤 값을 넣어야 하는지 알려주므로 옵션까지 챙긴다.
      if (el.tagName === 'SELECT') {
        info.options = [...el.options].slice(0, 25)
          .map((o) => ({ value: o.value, text: (o.textContent || '').trim() }))
      }
      // 비밀번호 칸은 위치만 남기고 값은 절대 읽지 않는다.
      if (el.type === 'password') info.note = '비밀번호 칸 (값 수집 안 함)'
      return info
    })

  const buttons = [...document.querySelectorAll(
    'button, a[onclick], input[type=submit], input[type=button], [class*=btn]'
  )]
    .filter(visible)
    .slice(0, 40)
    .map((el) => ({
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      onclick: (el.getAttribute('onclick') || '').slice(0, 100)
    }))
    .filter((b) => b.text)

  const iframes = [...document.querySelectorAll('iframe')].map((f) => ({
    id: f.id, name: f.name, src: (f.src || '').slice(0, 150), visible: visible(f)
  }))

  const result = {
    수집시각: new Date().toISOString(),
    주소: location.href,
    제목: document.title,
    폼목록: [...document.forms].map((f) => ({
      name: f.name, id: f.id, action: f.action, method: f.method
    })),
    입력칸: fields,
    버튼: buttons,
    iframe: iframes,
    표시된테이블머리글: [...document.querySelectorAll('table thead th, table tr th')]
      .slice(0, 30).map((th) => (th.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  }

  const json = JSON.stringify(result, null, 1)

  if (iframes.some((f) => f.visible && f.src)) {
    console.warn(
      '⚠ 화면에 iframe 이 있습니다. 신청 폼이 그 안에 들어 있다면 입력칸이 안 잡힙니다.\n' +
      '   콘솔 위쪽의 프레임 선택 드롭다운(기본값 top)에서 해당 프레임을 고른 뒤 다시 실행해 주세요.'
    )
  }
  console.log(`입력칸 ${fields.length}개, 버튼 ${buttons.length}개를 찾았습니다.`)

  try {
    copy(json)
    console.log('✅ 클립보드에 복사되었습니다. 그대로 붙여넣어 전달해 주세요.')
  } catch {
    console.log('클립보드 복사에 실패했습니다. 아래 내용을 직접 복사해 주세요.\n')
    console.log(json)
  }
  return `입력칸 ${fields.length}개 수집 완료`
})()
