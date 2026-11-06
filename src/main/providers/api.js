'use strict'

/**
 * 국립중앙도서관 API 연동 모듈 — API 가 개통되면 채우는 자리.
 * 규격이 없어 지금은 모든 동작이 '미개통' 으로 답한다.
 * 채우는 법: api.json 에 주소·인증·경로를 적고, 아래 동작들을 request() 로 호출하도록 채운 뒤 설정 mode 를 'api' 로.
 */

const path = require('node:path')
const fs = require('node:fs')

const CONFIG_PATH = path.join(__dirname, 'api.json')

function loadConfig () {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return { configured: false, baseUrl: '', endpoints: {} }
  }
}

function isConfigured () {
  const c = loadConfig()
  return c.configured === true && Boolean(c.baseUrl)
}

const NOT_OPEN = 'API 연동은 아직 개통되지 않았습니다. 국립중앙도서관 API 규격이 제공되면 providers/api.js 와 api.json 을 채우고 설정에서 전환하세요.'

/** 미개통 응답. 모든 동작이 같은 모양으로 답한다. */
const notOpen = () => ({ ok: false, error: NOT_OPEN })

let session = null

/**
 * 규격에 맞춰 채울 공통 호출부. 지금은 경로가 비어 있어 항상 미개통이다.
 * @param {string} op  endpoints 의 키
 * @param {object} body 보낼 내용
 */
async function request (op, body) {
  const c = loadConfig()
  const route = c.endpoints?.[op]
  if (!isConfigured() || !route) return notOpen()
  // 규격이 정해지면 여기서 fetch 로 호출한다. 인증 헤더는 c.auth 에 따른다.
  //   const res = await fetch(new URL(route, c.baseUrl), { method: 'POST', headers: { ... }, body: JSON.stringify(body) })
  //   return await res.json()
  void body
  return notOpen()
}

/** 로그인. 성공하면 session 에 사용자 정보를 담는다. */
async function login ({ loginId, password }) {
  if (!loginId || !password) return { ok: false, error: '아이디와 비밀번호를 모두 입력해 주세요.' }
  const res = await request('login', { loginId, password })
  if (!res.ok) return res
  session = { loginId, name: loginId, orgName: res.orgName || '', orgCode: res.orgCode || '' }
  return { ok: true, user: { ...session } }
}

/** 로그아웃. */
async function logout () {
  session = null
  return { ok: true }
}

/** 로그인돼 있으면 사용자 정보, 아니면 null. */
function getSession () {
  return session ? { ...session } : null
}

/** 신청 자격(등록자번호) 확인. */
async function verifyAccess () {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('verifyAccess', {})
}

/** 작품 한 건 신청. */
async function apply (meta) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('apply', meta)
}

/** 여러 작품 일괄 신청. */
async function applyBulk (items) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('applyBulk', { items })
}

/** 신청 한 건의 심사 결과 조회. */
async function checkStatus (record) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('status', { title: record?.title, uci: record?.uci })
}

/** 이 계정의 신청 현황 전체 목록. */
async function listApplications (opts) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('list', opts || {})
}

/** 상태 묶음별 건수. */
async function countApplications ({ statuses } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('count', { statuses })
}

/** 신청 한 건의 상세. */
async function getApplicationDetail ({ portalKey } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('detail', { portalKey })
}

/** 여러 건의 상세. */
async function getApplicationDetails ({ portalKeys } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('details', { portalKeys })
}

/** 발급된 건의 회차 범위. */
async function getIssuedEpisodes ({ portalKeys } = {}) {
  if (!session) return { ok: false, error: '로그인이 필요합니다.' }
  return request('episodes', { portalKeys })
}

/** 발급된 UCI 하나 조회. */
async function lookup (uci) {
  return request('status', { uci })
}

module.exports = {
  login, logout, getSession, verifyAccess, apply, applyBulk, checkStatus, listApplications, countApplications, getApplicationDetail, getApplicationDetails, getIssuedEpisodes, lookup,
  isConfigured, NOT_OPEN
}
