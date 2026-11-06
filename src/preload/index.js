'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * 화면(renderer)에 노출되는 유일한 통로.
 *
 * contextIsolation 이 켜져 있어서 화면 코드는 Node API에 직접 손댈 수 없다.
 * 여기 적힌 함수만 window.uci 로 쓸 수 있다.
 */
contextBridge.exposeInMainWorld('uci', {
  auth: {
    login: (payload) => ipcRenderer.invoke('auth:login', payload),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session'),
    savedCredential: () => ipcRenderer.invoke('auth:savedCredential'),
    verifyAccess: () => ipcRenderer.invoke('auth:verifyAccess'),
    clearCredential: () => ipcRenderer.invoke('auth:clearCredential')
  },
  apply: {
    one: (meta) => ipcRenderer.invoke('uci:apply', meta),
    bulk: (items) => ipcRenderer.invoke('uci:applyBulk', items),
    refreshStatus: () => ipcRenderer.invoke('uci:refreshStatus'),
    lookup: (code) => ipcRenderer.invoke('uci:lookup', code),
    onRefreshProgress: (cb) => {
      const listener = (_e, data) => cb(data)
      ipcRenderer.on('uci:refreshProgress', listener)
      return () => ipcRenderer.off('uci:refreshProgress', listener)
    }
  },
  records: {
    list: (filter) => ipcRenderer.invoke('records:list', filter),
    /** 포털 현황 전체(와 상세)를 읽어 이력에 저장한다. { scope: 'full' | 'recent' } */
    sync: (opts) => ipcRenderer.invoke('records:sync', opts),
    /** 뒤에서 도는 불러오기 상태. { running, scope, startedAt, last } */
    syncState: () => ipcRenderer.invoke('records:syncState'),
    onSyncProgress: (handler) => {
      const listener = (_event, payload) => handler(payload)
      ipcRenderer.on('records:syncProgress', listener)
      return () => ipcRenderer.off('records:syncProgress', listener)
    },
    remove: (id) => ipcRenderer.invoke('records:delete', id),
    clear: () => ipcRenderer.invoke('records:clear'),
    exportCsv: (filter) => ipcRenderer.invoke('records:export', filter)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    openSelectors: () => ipcRenderer.invoke('settings:openSelectors'),
    revealSelectors: () => ipcRenderer.invoke('settings:revealSelectors'),
    resetSelectors: () => ipcRenderer.invoke('settings:resetSelectors')
  },
  tutorial: {
    start: () => ipcRenderer.invoke('tutorial:start'),
    finish: () => ipcRenderer.invoke('tutorial:finish'),
    skip: () => ipcRenderer.invoke('tutorial:skip')
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    copy: (text) => ipcRenderer.invoke('app:copy', text),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    revealData: () => ipcRenderer.invoke('app:revealData')
  }
})
