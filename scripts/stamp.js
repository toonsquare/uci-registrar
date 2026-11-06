'use strict'

/*
 * 빌드 시각을 파일명에 붙이기 위한 문자열을 만든다. `0819-1153` 형태.
 *
 * 이름이 늘 같으면 새로 구울 때마다 이전 설치 파일을 조용히 덮어쓴다.
 * 어느 게 최신인지도 알 수 없고, 옮겨 둔 파일이 옛날 것인지도 모른다.
 * 그래서 만든 시각을 이름에 남긴다.
 */
module.exports = function stamp (now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}
