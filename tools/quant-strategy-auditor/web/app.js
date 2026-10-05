let socket = null;
let currentMode = "DESKTOP";
let sessionSeconds = 0;
let sessionTimer = null;
let eventsList = [];
let strategyMode = true;
let currentDate = "";
let currentSessionId = "";
let tabMediaStream = null;
const tabVideoElement = document.createElement("video");
tabVideoElement.autoplay = true;
tabVideoElement.muted = true;

window.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  initAudioVisualizer();
  initHotkeys();
  startSessionTimer();
  refreshWindowsList();
  checkGeminiStatus();
  loadTerminalPreference();
});

function startSessionTimer() {
  if (sessionTimer) clearInterval(sessionTimer);
  sessionSeconds = 0;
  sessionTimer = setInterval(() => {
    sessionSeconds++;
    const h = String(Math.floor(sessionSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((sessionSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(sessionSeconds % 60).padStart(2, "0");
    const badge = document.getElementById("sessionTimeBadge");
    if (badge) badge.innerText = `${h}:${m}:${s}`;
  }, 1000);
}

function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    document.getElementById("footerStatus").innerText = "WebSocket: Kết nối ổn định (8765)";
    document.getElementById("footerStatus").style.color = "var(--color-buy)";
    document.getElementById("statusDot").style.backgroundColor = "var(--color-buy)";
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (e) {
      console.error("Lỗi WebSocket:", e);
    }
  };

  socket.onclose = () => {
    document.getElementById("footerStatus").innerText = "WebSocket: Mất kết nối, đang thử lại...";
    document.getElementById("footerStatus").style.color = "var(--color-sell)";
    document.getElementById("statusDot").style.backgroundColor = "var(--color-sell)";
    setTimeout(initWebSocket, 2000);
  };
}

function handleSocketMessage(data) {
  if (data.type === "INIT_STATE") {
    currentMode = data.mode || "DESKTOP";
    strategyMode = data.strategy_mode !== undefined ? data.strategy_mode : true;
    currentDate = data.current_date || "";
    currentSessionId = data.session_id || "";

    updateModeUI(currentMode);
    updateSessionBadge();
    
    const chk = document.getElementById("chkStrategyMode");
    if (chk) chk.checked = strategyMode;
    updateStrategyUI(strategyMode);

    if (data.summary) updateSummaryUI(data.summary);
    if (data.recent_events) {
      eventsList = data.recent_events;
      renderEventsTable();
    }
    if (data.gemini_status) {
      renderGeminiBadge(data.gemini_status);
    }
  } else if (data.type === "TRADE_LOGGED" || data.type === "EVENT_LOGGED" || data.type === "REJECT_LOGGED" || data.type === "EVENT_UPDATED") {
    if (data.event) {
      const incomingId = data.event.id;
      let existingIndex = -1;
      if (incomingId) {
        existingIndex = eventsList.findIndex(e => e.id === incomingId);
      }
      if (existingIndex === -1) {
        existingIndex = eventsList.findIndex(e => 
          e.timestamp === data.event.timestamp && 
          e.type === data.event.type && 
          e.action === data.event.action && 
          String(e.price) === String(data.event.price)
        );
      }

      if (existingIndex !== -1) {
        eventsList[existingIndex] = { ...eventsList[existingIndex], ...data.event };
      } else {
        eventsList.unshift(data.event);
        if (eventsList.length > 50) eventsList.pop();
      }
      renderEventsTable();
    }
    if (data.summary) {
      updateSummaryUI(data.summary);
    }
  } else if (data.type === "SESSION_SWITCHED") {
    currentDate = data.date || currentDate;
    currentSessionId = data.session_id || currentSessionId;
    updateSessionBadge();
    eventsList = data.recent_events || [];
    renderEventsTable();
    if (data.summary) updateSummaryUI(data.summary);
    startSessionTimer();
    loadSessionsList();
  } else if (data.type === "MODE_CHANGED") {
    currentMode = data.mode;
    updateModeUI(currentMode);
  } else if (data.type === "STRATEGY_MODE_CHANGED") {
    strategyMode = data.enabled;
    const chk = document.getElementById("chkStrategyMode");
    if (chk) chk.checked = strategyMode;
    updateStrategyUI(strategyMode);
  }
}

function updateSessionBadge() {
  const badge = document.getElementById("activeSessionBadge");
  if (!badge) return;
  const timePart = currentSessionId.replace("session_", "");
  const timeFormatted = timePart.length === 6 ? `${timePart.slice(0,2)}:${timePart.slice(2,4)}` : timePart;
  badge.innerText = `Phiên: ${currentDate} ${timeFormatted}`;
}

// Drawer Quản lý Phiên theo Ngày
function toggleSessionsDrawer() {
  const drawer = document.getElementById("sessionsDrawer");
  const overlay = document.getElementById("drawerOverlay");
  const isOpen = drawer.classList.contains("open");
  if (isOpen) {
    drawer.classList.remove("open");
    overlay.style.display = "none";
  } else {
    drawer.classList.add("open");
    overlay.style.display = "block";
    loadSessionsList();
  }
}

async function loadSessionsList() {
  const container = document.getElementById("sessionsListContainer");
  if (!container) return;
  try {
    const res = await fetch("/api/sessions");
    const data = await res.json();
    const dates = data.dates || [];
    if (dates.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:30px;">Chưa có phiên lưu trữ nào.</div>`;
      return;
    }

    let html = "";
    dates.forEach(dg => {
      html += `<div class="date-group-header mono">${dg.date}</div>`;
      dg.sessions.forEach(s => {
        const isActive = (s.date === currentDate && s.id === currentSessionId);
        html += `
          <div class="session-item ${isActive ? 'active' : ''}">
            <div>
              <div style="font-weight:600; font-size:12px;">${s.label}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                ${s.events_count} thao tác ${isActive ? '<span style="color:var(--color-buy); font-weight:700;">(Đang ghi)</span>' : ''}
              </div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              ${s.has_html ? `<a href="/api/sessions/${s.date}/${s.id}/report/html" target="_blank" class="btn btn-secondary" style="padding:3px 6px; font-size:10px; text-decoration:none;">HTML</a>` : ''}
              ${s.has_pdf ? `<a href="/api/sessions/${s.date}/${s.id}/report/pdf" target="_blank" class="btn btn-secondary" style="padding:3px 6px; font-size:10px; text-decoration:none;">PDF</a>` : ''}
              ${!isActive ? `<button class="btn btn-secondary" style="padding:3px 8px; font-size:10px;" onclick="switchSession('${s.date}', '${s.id}')">Chọn</button>` : ''}
              <button class="btn btn-danger" style="padding:3px 6px; font-size:10px;" onclick="deleteSession('${s.date}', '${s.id}')">&times;</button>
            </div>
          </div>
        `;
      });
    });
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div style="color:var(--color-sell); padding:10px;">Lỗi tải danh sách phiên.</div>`;
  }
}

async function createNewSession() {
  try {
    const res = await fetch("/api/sessions/new", { method: "POST" });
    const data = await res.json();
    currentDate = data.date;
    currentSessionId = data.session_id;
    updateSessionBadge();
    eventsList = [];
    renderEventsTable();
    loadSessionsList();
    toggleSessionsDrawer();
    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: "Phiên mới",
        text: `Đã khởi tạo ${data.session_id} (${data.date})`,
        icon: "success",
        timer: 1200,
        showConfirmButton: false,
        background: "#0E121A",
        color: "#F0F4F8"
      });
    }
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({ title: "Lỗi", text: "Lỗi khi tạo phiên mới: " + e, icon: "error", background: "#0E121A", color: "#F0F4F8" });
    } else {
      alert("Lỗi khi tạo phiên mới: " + e);
    }
  }
}

async function switchSession(date, sessionId) {
  try {
    await fetch("/api/sessions/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: date, session_id: sessionId })
    });
    toggleSessionsDrawer();
  } catch (e) {
    alert("Lỗi khi chuyển phiên: " + e);
  }
}

async function deleteSession(date, sessionId) {
  if (typeof Swal !== "undefined") {
    const result = await Swal.fire({
      title: "Xóa phiên này?",
      html: `Bạn có chắc muốn xóa phiên <b style="color:var(--color-sell);">${sessionId}</b> (${date})?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Xác nhận xóa",
      cancelButtonText: "Hủy",
      confirmButtonColor: "#EF4444",
      cancelButtonColor: "#1F2633",
      background: "#0E121A",
      color: "#F0F4F8"
    });
    if (!result.isConfirmed) return;
  } else {
    if (!confirm(`Bạn có chắc muốn xóa phiên ${sessionId} (${date})?`)) return;
  }

  try {
    const res = await fetch(`/api/sessions/${date}/${sessionId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.status === "ok") {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          title: "Đã xóa!",
          text: "Phiên giao dịch đã được xóa thành công.",
          icon: "success",
          timer: 1200,
          showConfirmButton: false,
          background: "#0E121A",
          color: "#F0F4F8"
        });
      }
      loadSessionsList();
    } else {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          title: "Không thể xóa",
          text: data.message || "Lỗi khi xóa phiên",
          icon: "error",
          background: "#0E121A",
          color: "#F0F4F8"
        });
      }
    }
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: "Lỗi kết nối",
        text: String(e),
        icon: "error",
        background: "#0E121A",
        color: "#F0F4F8"
      });
    }
  }
}

async function deleteAllSessions() {
  if (typeof Swal !== "undefined") {
    const result = await Swal.fire({
      title: "Xóa tất cả các phiên?",
      html: `Hành động này sẽ xóa <b style="color:var(--color-sell);">TOÀN BỘ</b> lịch sử phiên và thiết lập một phiên mới tinh khôi.<br/><br/><span style="color:var(--text-muted); font-size:12px;">Dữ liệu sau khi xóa không thể phục hồi.</span>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Đồng ý xóa hết",
      cancelButtonText: "Hủy bỏ",
      confirmButtonColor: "#EF4444",
      cancelButtonColor: "#1F2633",
      background: "#0E121A",
      color: "#F0F4F8"
    });
    if (!result.isConfirmed) return;
  } else {
    if (!confirm("Bạn có chắc muốn xóa TOÀN BỘ phiên giao dịch?")) return;
  }

  try {
    const res = await fetch("/api/sessions", { method: "DELETE" });
    const data = await res.json();
    if (data.status === "ok") {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          title: "Đã xóa tất cả!",
          text: "Toàn bộ phiên cũ đã được xóa sạch.",
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
          background: "#0E121A",
          color: "#F0F4F8"
        });
      }
      loadSessionsList();
    } else {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          title: "Lỗi",
          text: "Không thể xóa tất cả các phiên.",
          icon: "error",
          background: "#0E121A",
          color: "#F0F4F8"
        });
      }
    }
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: "Lỗi kết nối",
        text: String(e),
        icon: "error",
        background: "#0E121A",
        color: "#F0F4F8"
      });
    }
  }
}

// Quản lý cửa sổ và Chrome Tab
async function refreshWindowsList() {
  try {
    const res = await fetch("/api/windows");
    const data = await res.json();
    const select = document.getElementById("selectTargetWindow");
    if (!select || !data.windows) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Chưa chọn cửa sổ --</option>';

    data.windows.forEach(title => {
      const opt = document.createElement("option");
      opt.value = title;
      opt.innerText = title;
      select.appendChild(opt);
    });

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
      select.value = currentVal;
    } else {
      select.value = "";
    }
  } catch (e) {
    console.error("Lỗi lấy danh sách cửa sổ:", e);
  }
}

async function onWindowSelectChange() {
  const select = document.getElementById("selectTargetWindow");
  const targetWindow = select ? select.value : "";
  await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: currentMode, target_window_title: targetWindow })
  });
}

async function pickChromeTab() {
  const statusElem = document.getElementById("tabStreamStatus");
  try {
    tabMediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });
    tabVideoElement.srcObject = tabMediaStream;
    const track = tabMediaStream.getVideoTracks()[0];
    if (statusElem && track) {
      statusElem.innerHTML = `<span style="color:var(--color-buy); font-weight:600;">&check; Đang stream:</span> ${track.label}`;
    }
    track.onended = () => {
      tabMediaStream = null;
      if (statusElem) statusElem.innerText = "Trạng thái tab: Đã ngắt kết nối";
    };
  } catch (err) {
    if (statusElem) statusElem.innerText = "Trạng thái tab: Đã hủy chọn tab";
  }
}

function captureTabFrame() {
  if (!tabMediaStream || !tabVideoElement.videoWidth) return "";
  try {
    const canvas = document.createElement("canvas");
    canvas.width = tabVideoElement.videoWidth;
    canvas.height = tabVideoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(tabVideoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch (e) {
    return "";
  }
}

// Bật / Tắt chế độ Chiến lược
async function toggleStrategyMode(enabled) {
  strategyMode = enabled;
  updateStrategyUI(enabled);
  await fetch("/api/strategy-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: enabled })
  });
}

function updateStrategyUI(enabled) {
  const desc = document.getElementById("strategyStatusDesc");
  if (!desc) return;
  if (enabled) {
    desc.innerHTML = `<span style="color:var(--color-buy);">&bull; Đang bật:</span> Kiểm tra giờ 09:15-10:00, cửa sổ T-5s đến T+3s.`;
  } else {
    desc.innerHTML = `<span style="color:var(--text-muted);">&bull; Tự do (Free Mode):</span> Không cảnh báo quy tắc, ghi nhận mọi thao tác.`;
  }
}

// Gemini AI
async function checkGeminiStatus() {
  try {
    const res = await fetch("/api/gemini/status");
    const data = await res.json();
    renderGeminiBadge(data);
  } catch (e) {
    renderGeminiBadge({ connected: false, error: "Không kết nối được server" });
  }
}

async function testGeminiConnection() {
  const output = document.getElementById("geminiTestOutput");
  if (output) output.innerText = "Đang kiểm tra kết nối Gemini...";
  try {
    const res = await fetch("/api/gemini/status");
    const data = await res.json();
    renderGeminiBadge(data);
    if (output) {
      if (data.connected) {
        output.innerHTML = `<span style="color:var(--color-buy);">&check; Kết nối thành công!</span> Model: ${data.model} (${data.latency_ms}ms)`;
      } else {
        output.innerHTML = `<span style="color:var(--color-sell);">&cross; ${data.error}</span>`;
      }
    }
  } catch (e) {
    if (output) output.innerText = "Lỗi khi kiểm tra kết nối";
  }
}

async function saveGeminiKey() {
  const input = document.getElementById("inputGeminiKey");
  const key = input ? input.value.trim() : "";
  if (!key) return;

  const res = await fetch("/api/gemini/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key })
  });
  const data = await res.json();
  renderGeminiBadge(data);
  testGeminiConnection();
}

function renderGeminiBadge(status) {
  const badge = document.getElementById("geminiBadge");
  if (!badge) return;
  if (status && status.connected) {
    badge.innerText = `Gemini: ${status.model || "Sẵn sàng"}`;
    badge.style.background = "rgba(16,185,129,0.15)";
    badge.style.color = "var(--color-buy)";
  } else {
    badge.innerText = "Gemini: Chưa nhập API Key";
    badge.style.background = "rgba(245,158,11,0.15)";
    badge.style.color = "var(--color-warn)";
  }
}

function updateSummaryUI(summary) {
  document.getElementById("statPairsCount").innerText = summary.total_closed_pairs || 0;
  document.getElementById("statGrossPoints").innerText = (summary.total_gross_points || 0).toFixed(2);
  document.getElementById("statFeesPoints").innerText = `-${(summary.total_fees_points || 0).toFixed(2)}`;
  
  const net = summary.total_net_points || 0;
  const netElem = document.getElementById("statNetPoints");
  netElem.innerText = `${net >= 0 ? "+" : ""}${net.toFixed(2)} pts`;
  netElem.className = `stat-value mono ${net >= 0 ? "positive" : "negative"}`;

  renderPairsTable(summary.pairs || []);
}

function renderEventsTable() {
  const tbody = document.getElementById("feedTableBody");
  if (!eventsList || eventsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 32px;">Chưa có thao tác nào</td></tr>`;
    return;
  }

  tbody.innerHTML = eventsList.map(ev => {
    const action = ev.action || "";
    const badgeClass = action === "BUY" ? "badge-buy" : (action === "SELL" ? "badge-sell" : "badge-warn");
    const warnings = ev.warnings || [];
    const warnHtml = warnings.map(w => `<span class="badge badge-warn">${w.message}</span>`).join(" ");
    const aiNote = ev.ai_thesis || (ev.ai_analysis ? (ev.ai_analysis.ai_thesis || "") : "");
    let displayNote = "";
    if (ev.voice_transcript) {
      displayNote += `<div><b>Trader:</b> ${ev.voice_transcript}</div>`;
    }
    if (aiNote) {
      displayNote += `<div style="color:var(--color-accent); font-size:11px; margin-top:3px;"><b>🤖 AGY:</b> ${aiNote}</div>`;
    } else if (ev.ai_pending) {
      displayNote += `<div style="color:var(--text-muted); font-size:11px; margin-top:3px; font-style:italic;">🤖 Đang phân tích chiến lược...</div>`;
    }
    if (!displayNote) {
      displayNote = ev.reason || "<span style='color:var(--text-muted);'>-</span>";
    }
    
    return `
      <tr>
        <td class="mono" style="font-size:11px; color:var(--text-secondary);">${ev.timestamp || "-"}</td>
        <td><span class="badge ${badgeClass}">${ev.type || ""} ${action}</span></td>
        <td class="mono" style="font-weight:600;">${ev.price || "-"}</td>
        <td>${displayNote}</td>
        <td>${warnHtml || "<span style='color:var(--color-buy); font-size:11px;'>&bull; Hợp lệ</span>"}</td>
        <td>${ev.frame_path ? "<span style='color:var(--color-accent); font-size:11px;'>[Ảnh]</span>" : "-"}</td>
      </tr>
    `;
  }).join("");
}

async function loadTerminalPreference() {
  try {
    const res = await fetch("/api/terminal/config");
    const data = await res.json();
    const sel = document.getElementById("selectTerminalType");
    if (sel && data.terminal_type) {
      sel.value = data.terminal_type;
    }
  } catch (e) {
    console.error("Lỗi tải cấu hình terminal:", e);
  }
}

async function onTerminalTypeChange(newType) {
  try {
    await fetch("/api/terminal/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminal_type: newType })
    });
  } catch (e) {
    console.error("Lỗi lưu cấu hình terminal:", e);
  }
}

async function openSelectedTerminal() {
  const sel = document.getElementById("selectTerminalType");
  const chosen = sel ? sel.value : "ORCA";
  try {
    const res = await fetch("/api/terminal/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminal_type: chosen })
    });
    const data = await res.json();
    const termNames = {
      "ORCA": "Orca Terminal",
      "WINDOWS": "Windows Console Host",
      "WT": "Windows Terminal",
      "NONE": "Không mở"
    };
    const titleText = `Đã mở ${termNames[data.terminal_type] || "Terminal"}`;
    if (typeof Swal !== "undefined") {
      Swal.fire({
        title: titleText,
        text: `Phiên ${data.session_id} (${data.date})`,
        icon: "success",
        timer: 1400,
        showConfirmButton: false,
        background: "#0E121A",
        color: "#F0F4F8"
      });
    }
  } catch (e) {
    alert("Lỗi mở terminal: " + e);
  }
}

function openOrcaTerminal() {
  openSelectedTerminal();
}

function renderPairsTable(pairs) {
  const tbody = document.getElementById("pairsTableBody");
  if (!pairs || pairs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 12px;">Chưa có cặp hợp đồng nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = pairs.map(p => {
    const net = p.net_points || 0;
    const color = net >= 0 ? "var(--color-buy)" : "var(--color-sell)";
    return `
      <tr>
        <td class="mono">${p.open_time}</td>
        <td class="mono">${p.close_time}</td>
        <td class="mono" style="color:var(--color-sell);">${p.p_red}</td>
        <td class="mono" style="color:var(--color-buy);">${p.p_green}</td>
        <td class="mono">${p.gross_points.toFixed(2)}</td>
        <td class="mono">-0.45</td>
        <td class="mono" style="font-weight:700; color:${color};">${net >= 0 ? "+" : ""}${net.toFixed(2)}</td>
      </tr>
    `;
  }).join("");
}

async function setMode(mode) {
  currentMode = mode;
  updateModeUI(mode);
  const select = document.getElementById("selectTargetWindow");
  const targetWindow = select ? select.value : "";
  await fetch("/api/mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: mode, target_window_title: targetWindow })
  });
}

function updateModeUI(mode) {
  const btnDesktop = document.getElementById("btnModeDesktop");
  const btnInApp = document.getElementById("btnModeInApp");
  const groupDesktop = document.getElementById("desktopSettingsGroup");
  const groupInApp = document.getElementById("inAppSettingsGroup");

  if (mode === "DESKTOP") {
    btnDesktop.classList.add("active");
    btnInApp.classList.remove("active");
    groupDesktop.style.display = "flex";
    groupInApp.style.display = "none";
  } else {
    btnInApp.classList.add("active");
    btnDesktop.classList.remove("active");
    groupDesktop.style.display = "none";
    groupInApp.style.display = "flex";
  }
}

async function triggerTrade(action) {
  const price = parseFloat(document.getElementById("inputTradePrice").value) || 0;
  const transcript = document.getElementById("inputVoiceTranscript").value;
  const frameBase64 = captureTabFrame();

  await fetch("/api/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "TRADE_MANUAL",
      action: action,
      price: price,
      contracts: 1,
      voice_transcript: transcript,
      frame_base64: frameBase64
    })
  });

  document.getElementById("inputVoiceTranscript").value = "";
}

async function triggerReject() {
  const transcript = document.getElementById("inputVoiceTranscript").value;
  const frameBase64 = captureTabFrame();

  await fetch("/api/reject-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: "Trader từ chối setup vì tín hiệu không đạt",
      voice_transcript: transcript,
      frame_base64: frameBase64
    })
  });
  document.getElementById("inputVoiceTranscript").value = "";
}

async function endSession() {
  try {
    const res = await fetch("/api/end-session", { method: "POST" });
    const data = await res.json();
    const reports = data.reports || {};
    if (reports.pdf) {
      window.open(`/api/sessions/${data.date}/${data.session_id}/report/pdf`, "_blank");
    } else if (reports.html) {
      window.open(`/api/sessions/${data.date}/${data.session_id}/report/html`, "_blank");
    }
    toggleSessionsDrawer();
  } catch (e) {
    alert("Lỗi khi xuất báo cáo: " + e);
  }
}

function initHotkeys() {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      triggerReject();
    }
  });
}

function initAudioVisualizer() {
  const canvas = document.getElementById("voiceCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById("micStatusText").innerText = "Micro: Không hỗ trợ";
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      document.getElementById("micStatusText").innerText = "Micro: Đang lắng nghe";
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * canvas.height;
          ctx.fillStyle = "#10B981";
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
      }
      draw();
    })
    .catch(() => {
      document.getElementById("micStatusText").innerText = "Micro: Sẵn sàng";
    });
}
