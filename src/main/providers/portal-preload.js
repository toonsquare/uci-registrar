'use strict'

const { ipcRenderer } = require('electron')

/**
 * 포털 자동화 창에만 주입되는 스크립트. (앱 화면과는 무관하다)
 *
 * 국립중앙도서관 포털은 접수 완료·입력값 오류를 alert() 창으로 알린다.
 * 숨겨 둔 창에서 alert 이 뜨면 사용자가 볼 수도, 누를 수도 없는 채로 자동화가 멈춰버린다.
 * 그래서 대화상자를 띄우는 대신 메시지를 메인 프로세스로 곧바로 보내고 즉시 넘어가게 바꾼다.
 *
 * 메시지를 페이지 안에 쌓아두지 않고 바로 내보내는 이유:
 * 포털은 `alert('접수번호 U2026-000012'); location.href='...'` 처럼 알림 직후 화면을 넘긴다.
 * 원래 alert 은 사용자가 확인을 누를 때까지 멈추지만 우리는 즉시 반환하므로 곧바로 이동이 일어난다.
 * 페이지 안 배열에 담아 두면 그 배열이 문서와 함께 사라져서 접수번호를 놓치게 된다.
 *
 * 종류(alert/confirm/prompt)를 함께 보내는 이유:
 * "UCI를 신청하시겠습니까?" 같은 확인창 문구를 결과 판정에 섞으면 정상 접수를 실패로 오인한다.
 * 판정에는 alert 만 쓰고 나머지는 기록용으로만 둔다.
 *
 * 페이지와 같은 전역을 공유해야 원래 alert 을 덮어쓸 수 있어서 이 창에 한해 contextIsolation 을 끈다.
 * ipcRenderer 는 이 모듈 스코프에만 두고 window 에 노출하지 않으므로 페이지 코드는 접근할 수 없다.
 */

const send = (kind, message) => {
  try {
    ipcRenderer.send('portal:dialog', { kind, message: String(message ?? '') })
  } catch { /* 창이 정리되는 중이면 무시한다 */ }
}

window.alert = (message) => { send('alert', message) }

// 발급 과정의 "등록하시겠습니까?" 류 확인창은 승인한 것으로 처리한다.
window.confirm = (message) => { send('confirm', message); return true }

window.prompt = (message) => { send('prompt', message); return null }
