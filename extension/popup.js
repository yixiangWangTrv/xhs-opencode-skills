function renderStatus(wsConnected) {
  set("bridge-status", "bridge-dot", "bridge-text", wsConnected, wsConnected ? "已连接" : "未连接");
  set("ext-status",   "ext-dot",   "ext-text",   true, "运行中");
  document.getElementById("hint").textContent = wsConnected
    ? "一切正常，可以运行 Python 脚本。"
    : "请先运行：python scripts/cli.py <命令>";
}

function set(badgeId, dotId, textId, ok, label) {
  const cls = ok ? "ok" : "err";
  document.getElementById(badgeId).className  = `badge ${cls}`;
  document.getElementById(dotId).className    = `dot ${cls}`;
  document.getElementById(textId).textContent = label;
}

// 初始化：拉取当前状态
try {
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.success) {
      renderStatus(false);
      return;
    }
    renderStatus(resp.status.wsConnected);
  });
} catch (e) {
  renderStatus(false);
}

// 实时监听状态变化（background 主动推送）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATUS_CHANGED") {
    renderStatus(msg.status.wsConnected);
  }
});

// ── 风控扫描 ──────────────────────────────────────────────────

const RISK_LABELS = { safe: "安全", low: "低风险", medium: "中风险", high: "高风险" };

document.getElementById("scan-btn").addEventListener("click", async () => {
  const btn = document.getElementById("scan-btn");
  const resultEl = document.getElementById("risk-result");
  btn.disabled = true;
  btn.textContent = "扫描中...";
  resultEl.style.display = "none";

  try {
    const report = await chrome.runtime.sendMessage({ type: "ANALYZE_RISK_CONTROL" });
    if (!report || report.error) {
      showRiskError(report?.error || "扫描失败，请检查扩展连接状态");
      return;
    }
    renderRiskReport(report);
  } catch (e) {
    showRiskError(String(e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = "重新扫描";
  }
});

function renderRiskReport(report) {
  const badge = document.getElementById("risk-level-badge");
  const level = report.risk_level || "safe";
  badge.textContent = RISK_LABELS[level] || level;
  badge.className = `risk-badge risk-${level}`;

  const list = document.getElementById("issue-list");
  list.innerHTML = "";
  if (!report.issues || report.issues.length === 0) {
    const li = document.createElement("li");
    li.textContent = "✓ 未发现风控特征";
    li.style.color = "#1e8e3e";
    list.appendChild(li);
  } else {
    for (const issue of report.issues) {
      const li = document.createElement("li");
      const icon = issue.level === "high" ? "✗" : issue.level === "medium" ? "!" : "·";
      li.textContent = `${icon} ${issue.msg}`;
      li.style.color = issue.level === "high" ? "#c5221f" : issue.level === "medium" ? "#b7950b" : "#666";
      list.appendChild(li);
    }
  }

  document.getElementById("risk-result").style.display = "block";
}

function showRiskError(msg) {
  const badge = document.getElementById("risk-level-badge");
  badge.textContent = "错误";
  badge.className = "risk-badge risk-medium";
  const list = document.getElementById("issue-list");
  list.innerHTML = `<li style="color:#c5221f">${msg}</li>`;
  document.getElementById("risk-result").style.display = "block";
}

// ── 404 诊断事件面板 ──────────────────────────────────────────

const CAUSE_COLORS = {
  token:             "#b7950b",
  signature:         "#1565c0",
  session:           "#6a1b9a",
  ip_block:          "#c5221f",
  account_block:     "#a50000",
  risk_control:      "#c5221f",
  content_unavailable: "#555",
};

function renderEvents(events) {
  const el = document.getElementById("event-list");
  const badge  = document.getElementById("intercept-badge");
  const dot    = document.getElementById("intercept-dot");
  const count  = document.getElementById("intercept-count");

  if (events.length === 0) {
    el.innerHTML = '<span style="color:#aaa">暂无拦截记录</span>';
    badge.className = "badge loading";
    dot.className   = "dot loading";
    count.textContent = "监听中";
    return;
  }

  badge.className = "badge err";
  dot.className   = "dot err";
  count.textContent = `${events.length} 条`;

  el.innerHTML = events.slice(0, 10).map(ev => {
    const color = CAUSE_COLORS[ev.diagnosis?.cause_category] || "#555";
    const time  = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString("zh-CN") : "";
    const urlShort = ev.url.replace(/https?:\/\/[^/]+/, "").slice(0, 45);
    return `
      <div style="border-left:3px solid ${color};padding:3px 6px;margin-bottom:4px;background:#fafafa;border-radius:0 4px 4px 0">
        <div style="color:${color};font-weight:600">[${ev.status}] ${ev.diagnosis?.root_cause || "未知"}</div>
        <div style="color:#666;font-size:9.5px">${urlShort}</div>
        <div style="color:#999;font-size:9px">${time} · ${ev.intercept_type || "fetch"}</div>
      </div>`;
  }).join("");
}

// 初始加载历史事件
chrome.runtime.sendMessage({ type: "GET_404_DIAGNOSTICS" }, (resp) => {
  renderEvents(resp?.events || []);
});

// 实时监听新事件
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "BLOCK_EVENT_ADDED") {
    chrome.runtime.sendMessage({ type: "GET_404_DIAGNOSTICS" }, (resp) => {
      renderEvents(resp?.events || []);
    });
  }
});

// 清空按钮
document.getElementById("clear-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "XHS_BLOCK_EVENT", event: null }).catch(() => {});
  // 直接通过 background command 清空
  chrome.storage.session.set({ blockEvents: [] }, () => renderEvents([]));
});
