'use strict'

/**
 * 앱 아이콘(build/icon.png)을 만든다.
 *
 * 이미지 편집기나 외부 라이브러리 없이 Node 내장 zlib만으로 PNG를 직접 인코딩한다.
 * electron-builder 가 이 PNG를 읽어 Windows용 .ico 로 변환해 준다.
 *
 * 실행: npm run icon
 */

const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 512
const OUT = path.join(__dirname, '..', 'build', 'icon.png')

/* ------------------------------------------------------------- PNG 인코딩 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk (type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA 픽셀 버퍼를 PNG 파일 바이트로 만든다. */
function encodePng (rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // 채널당 8비트
  ihdr[9] = 6   // 트루컬러 + 알파
  ihdr[10] = 0  // 압축 방식
  ihdr[11] = 0  // 필터 방식
  ihdr[12] = 0  // 인터레이스 없음

  // 각 줄 앞에 필터 바이트(0 = 필터 없음)를 붙인다.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ------------------------------------------------------------- 도형 그리기 */

/** 부호 있는 거리(SDF)로 모서리가 둥근 사각형을 나타낸다. 음수면 도형 안쪽이다. */
function sdRoundedRect (px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius
}

function sdCircle (px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

/** 거리값을 0~1 덮임 비율로 바꾼다. 경계에서 부드럽게 떨어져 계단 현상을 줄인다. */
function coverage (d) {
  return Math.min(Math.max(0.5 - d, 0), 1)
}

function lerp (a, b, t) { return a + (b - a) * t }

/** 위 색을 아래 색 위에 알파 합성한다. */
function blend (dst, i, r, g, b, a) {
  if (a <= 0) return
  const inv = 1 - a
  dst[i] = Math.round(r * a + dst[i] * inv)
  dst[i + 1] = Math.round(g * a + dst[i + 1] * inv)
  dst[i + 2] = Math.round(b * a + dst[i + 2] * inv)
  dst[i + 3] = Math.round(255 * a + dst[i + 3] * inv)
}

function draw () {
  const s = SIZE
  const px = Buffer.alloc(s * s * 4) // 전부 투명으로 시작
  const c = s / 2

  // 도형 치수 — 512 기준으로 잡고 나중에 비율로 환산한다.
  const plateHalf = s * 0.5
  const plateRadius = s * 0.225

  const ringOuter = s * 0.30
  const ringInner = s * 0.225

  const barW = s * 0.115
  const barH = s * 0.021
  const barGap = s * 0.076

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4
      const cx = x + 0.5
      const cy = y + 0.5

      // 바탕: 둥근 사각형 + 위에서 아래로 흐르는 파란 그라데이션
      const plate = coverage(sdRoundedRect(cx, cy, c, c, plateHalf, plateHalf, plateRadius))
      if (plate > 0) {
        const t = (cx / s) * 0.35 + (cy / s) * 0.65
        blend(px, i, lerp(63, 26, t), lerp(123, 74, t), lerp(212, 176, t), plate)
      }

      // 흰 고리 — 발급 도장을 연상시키는 형태
      const ring = Math.min(
        coverage(sdCircle(cx, cy, c, c, ringOuter)),
        coverage(-sdCircle(cx, cy, c, c, ringInner))
      )
      if (ring > 0) blend(px, i, 255, 255, 255, ring * 0.97)

      // 고리 안의 짧은 막대 3개 — 식별 코드를 뜻한다.
      for (let k = -1; k <= 1; k++) {
        const w = k === 0 ? barW : barW * 0.72
        const bar = coverage(sdRoundedRect(cx, cy, c, c + k * barGap, w, barH, barH))
        if (bar > 0) blend(px, i, 255, 255, 255, bar * 0.97)
      }
    }
  }

  return px
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, encodePng(draw(), SIZE, SIZE))
console.log(`아이콘 생성 완료: ${OUT} (${SIZE}x${SIZE})`)
