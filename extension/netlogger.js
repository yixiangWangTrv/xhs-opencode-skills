/**
 * XHS NetLogger - 全量请求监听 + 检测维度归类
 *
 * 仅在 chrome.storage.local.netlogEnabled === true 时记录。
 * 环形缓冲 500 条；每 10 条 / 关键事件触发写入 storage。
 * 详细设计：docs/superpowers/specs/2026-05-19-xhs-netlogger-design.md
 */

const NETLOG_MAX_ENTRIES   = 500;
const NETLOG_REQBODY_MAX   = 2048;
const NETLOG_RESPBODY_MAX  = 4096;
const NETLOG_FLUSH_EVERY_N = 10;
const NETLOG_STORAGE_KEY   = "netLog";
const NETLOG_ENABLED_KEY   = "netlogEnabled";

const _netBuffer = [];
const _netPending = new Map();            // requestId → 半成品 entry（跨 webRequest 4 阶段）
let _netEnabled = false;
let _netFlushCounter = 0;
let _lastHostCookies = new Map();         // host → Set<cookie name> for cookieDiff

function netlogIsEnabled() { return _netEnabled; }

function netlogSetEnabled(v) {
  _netEnabled = !!v;
  chrome.storage.local.set({ [NETLOG_ENABLED_KEY]: _netEnabled });
  if (!_netEnabled) _netPending.clear();
}

async function netlogInit() {
  const data = await chrome.storage.local.get([NETLOG_ENABLED_KEY, NETLOG_STORAGE_KEY]);
  _netEnabled = !!data[NETLOG_ENABLED_KEY];
  if (Array.isArray(data[NETLOG_STORAGE_KEY])) {
    _netBuffer.push(...data[NETLOG_STORAGE_KEY].slice(-NETLOG_MAX_ENTRIES));
  }
}

function netlogGetAll() { return _netBuffer.slice(); }

function netlogClear() {
  _netBuffer.length = 0;
  _netPending.clear();
  _lastHostCookies.clear();
  chrome.storage.local.set({ [NETLOG_STORAGE_KEY]: [] });
}

function _netlogFlush(force = false) {
  _netFlushCounter++;
  if (!force && _netFlushCounter % NETLOG_FLUSH_EVERY_N !== 0) return;
  chrome.storage.local.set({ [NETLOG_STORAGE_KEY]: _netBuffer.slice(-NETLOG_MAX_ENTRIES) });
}

function _netlogPush(entry) {
  _netBuffer.push(entry);
  if (_netBuffer.length > NETLOG_MAX_ENTRIES) {
    _netBuffer.splice(0, _netBuffer.length - NETLOG_MAX_ENTRIES);
  }
  _netlogFlush(entry.category === "business_error" ||
               entry.category === "signature_failure" ||
               entry.category === "risk_redirect");
  // 通知 popup 增量
  chrome.runtime.sendMessage({ type: "NETLOG_ENTRY_ADDED", entry }).catch(() => {});
}
