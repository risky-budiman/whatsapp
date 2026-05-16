/**
 * Main Application Logic (Vanilla JS SPA)
 */

let activeView = 'dashboard';

/**
 * Custom Toast Notification System
 * type: 'success', 'error', 'info'
 */
function showToast(message, type = 'success', title = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    info: 'fa-circle-info'
  };

  const defaultTitles = {
    success: 'Berhasil',
    error: 'Gagal',
    info: 'Informasi'
  };

  toast.innerHTML = `
    <div class="toast-icon">
      <i class="fa-solid ${iconMap[type]}"></i>
    </div>
    <div class="toast-content">
      <div class="toast-title">${title || defaultTitles[type]}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Override global alert for safety (optional but helps)
// window.alert = (msg) => showToast(msg, 'info');

document.addEventListener('DOMContentLoaded', () => {
  // Initialize navigation immediately
  initNavigation();
  
  // Initial load
  loadView(activeView); 
  
  // Fetch settings first, then init stream
  syncSettings().then(() => {
    initChatStream();
  });
});

async function syncSettings() {
  try {
    const res = await wa_api.settings.get();
    const apiKey = res.data.apiKey || res.data.api_key;
    
    // Sync API Key globally
    if (apiKey) {
      CURRENT_API_KEY = apiKey;
      console.log("🔐 API Key synced from server.");
      // Re-init stream with correct key if already open
      if (chatEventSource) initChatStream();
    }
  } catch (err) {
    console.warn("⚠️ Initial sync failed. Dashboard will use bypass for background fetches.");
  }
}

// ─── MODAL UTILITIES ───
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

/**
 * Custom Confirmation Dialog (Returns Promise)
 */
function showConfirm(message, title = 'Konfirmasi', type = 'warning') {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirm');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const iconEl = document.getElementById('confirm-icon');
    const btnOk = document.getElementById('btn-confirm-ok');
    const btnCancel = document.getElementById('btn-confirm-cancel');

    titleEl.innerText = title;
    msgEl.innerText = message;
    
    // Set icon & color based on type
    if (type === 'danger') {
      iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
      iconEl.style.color = 'var(--danger)';
      btnOk.className = 'btn btn-danger';
    } else {
      iconEl.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
      iconEl.style.color = 'var(--warning)';
      btnOk.className = 'btn btn-primary';
    }

    const handleOk = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      closeModal('modal-confirm');
      btnOk.removeEventListener('click', handleOk);
      btnCancel.removeEventListener('click', handleCancel);
    };

    btnOk.addEventListener('click', handleOk);
    btnCancel.addEventListener('click', handleCancel);
    
    openModal('modal-confirm');
  });
}

// ─── NAVIGATION & ROUTING ───
function initNavigation() {
  const links = document.querySelectorAll('.nav-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const viewId = link.getAttribute('data-view');
      
      // Update active class
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      loadView(viewId);
    });
  });
}

function loadView(viewId) {
  activeView = viewId;
  // Hide all sections
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  
  // Show target section
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
  }

  // Load data based on view
  if (viewId === 'dashboard') renderDashboard();
  if (viewId === 'sessions') renderSessions();
  if (viewId === 'contacts') renderContacts();
  if (viewId === 'groups') renderGroups();
  if (viewId === 'logs') renderMessageLogs();
  if (viewId === 'api-settings') {
    fetchApiKey();
  }
}

async function fetchApiKey() {
  try {
    const res = await wa_api.settings.get();
    const apiKey = res.data.apiKey;
    const input = document.getElementById('api-key-input');
    if (input) input.value = apiKey;
    
    // Update global placeholder in tips
    const placeholder = document.querySelector('.api-key-placeholder');
    if (placeholder) placeholder.innerText = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
  } catch (err) {
    console.error("Gagal mengambil API Key:", err);
  }
}

async function handleRegenerateKey() {
  const confirmed = await showConfirm('Kunci lama Anda tidak akan bisa digunakan lagi. Semua integrasi sistem alert akan terputus sampai Anda memperbarui kuncinya. Lanjutkan?', 'Regenerate API Key', 'danger');
  if (!confirmed) return;

  try {
    showToast("Sedang menggenerate kunci baru...");
    const res = await wa_api.fetch('/settings/regenerate-api-key', { method: 'POST' });
    
    // Update local variable so subsequent requests use the new key
    CURRENT_API_KEY = res.data.apiKey;
    
    // Refresh UI
    fetchApiKey();
    showToast("API Key berhasil diupdate!", "success");
  } catch (err) {
    showToast("Gagal regenerate: " + err.message, "error");
  }
}

// ─── MESSAGE LOGS MANAGEMENT ───
let logOffset = 0;
const logLimit = 50;

async function renderMessageLogs() {
  const tbody = document.getElementById('logs-tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.chats.getLogs({ limit: logLimit, offset: logOffset });
    console.log('[DEBUG] Logs Response:', res);
    const logs = res.data || [];
    const total = (res.meta && typeof res.meta.total !== 'undefined') ? res.meta.total : logs.length;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Belum ada riwayat pesan</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map((l, index) => {
      const time = l.created_at ? new Date(l.created_at).toLocaleString() : '-';
      let statusHtml = '';
      
      if (l.status === 'sent') {
        statusHtml = `<span class="status-badge sent" style="background: rgba(16, 185, 129, 0.1); color: #10b981;"><i class="fa-solid fa-check"></i> SENT</span>`;
      } else if (l.status === 'delivered') {
        statusHtml = `<span class="status-badge delivered" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;"><i class="fa-solid fa-check-double"></i> DELIVERED</span>`;
      } else if (l.status === 'read') {
        statusHtml = `<span class="status-badge read" style="background: rgba(52, 183, 241, 0.1); color: #34b7f1;"><i class="fa-solid fa-check-double"></i> READ</span>`;
      } else if (l.status === 'failed') {
        statusHtml = `<span class="status-badge failed" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> FAILED</span>`;
      } else {
        statusHtml = `<span class="status-badge received">${l.status.toUpperCase()}</span>`;
      }

      const phone = l.target_phone ? l.target_phone.split('@')[0] : '';

      return `
        <tr>
          <td>${logOffset + index + 1}</td>
          <td>${phone}</td>
          <td class="cell-message" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.message_content || ''}">${l.message_content || ''}</td>
          <td><span class="badge secondary" style="font-size: 0.7rem; font-weight: 600;">${l.session_name || 'System'}</span></td>
          <td style="font-size: 0.8rem;">${time}</td>
          <td>${statusHtml}</td>
          <td class="actions-cell">
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              ${l.status === 'failed' ? `
              <button class="btn-icon" onclick="resendLogMessage('${l.id}')" title="Kirim Ulang">
                <i class="fa-solid fa-rotate"></i>
              </button>` : ''}
              <button class="btn-icon danger" onclick="deleteMessageLog('${l.id}')" title="Hapus">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Update pagination UI
    document.getElementById('log-pagination-info').innerText = `Menampilkan ${logOffset + 1} - ${Math.min(logOffset + logLimit, total)} dari ${total} pesan`;
    document.getElementById('btn-prev-log').disabled = logOffset === 0;
    document.getElementById('btn-next-log').disabled = (logOffset + logLimit) >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state text-danger">Gagal memuat log: ${err.message}</td></tr>`;
  }
}

async function resendLogMessage(logId) {
  try {
    const res = await wa_api.chats.getLogs({ limit: logLimit, offset: logOffset });
    const log = res.data.find(l => l.id === logId);
    
    if (!log) {
      showToast("Data pesan tidak ditemukan", "error");
      return;
    }

    const confirmed = await showConfirm(`Kirim ulang pesan ke ${log.target_phone}?`, 'Kirim Ulang Pesan');
    if (!confirmed) return;

    showToast("Mencoba kirim ulang...");
    
    await wa_api.fetch(`/chats/${log.target_phone}`, {
      method: 'POST',
      body: JSON.stringify({ 
        message: log.message_content,
        sessionId: log.session_id 
      })
    });

    showToast("Pesan berhasil dikirim ulang!");
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'logs') renderMessageLogs();
  } catch (err) {
    showToast("Gagal kirim ulang: " + err.message, "error");
  }
}

async function deleteMessageLog(id) {
  const confirmed = await showConfirm('Hapus log pesan ini dari riwayat?', 'Hapus Riwayat', 'danger');
  if (!confirmed) return;
  try {
    await wa_api.chats.deleteLog(id);
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'logs') renderMessageLogs();
  } catch (err) {
    showToast("Gagal menghapus log: " + err.message, "error");
  }
}

function changeLogPage(dir) {
  logOffset += (dir * logLimit);
  if (logOffset < 0) logOffset = 0;
  renderMessageLogs();
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const dDisplay = d > 0 ? d + "d " : "";
  const hDisplay = h > 0 ? h + "h " : "";
  const mDisplay = m > 0 ? m + "m " : "";
  const sDisplay = s > 0 ? s + "s" : "";
  return dDisplay + hDisplay + mDisplay + (d === 0 && h === 0 ? sDisplay : "");
}

// ─── DASHBOARD & STATS ───
let dashboardRefreshInterval = null;

async function renderDashboard() {
  // Clear any existing interval to avoid duplicates
  if (dashboardRefreshInterval) {
    clearInterval(dashboardRefreshInterval);
    dashboardRefreshInterval = null;
  }

  try {
    const res = await wa_api.settings.getStats();
    const stats = res.data;
    
    document.getElementById('dash-active-sessions').innerText = stats.activeSessions;
    document.getElementById('dash-total-contacts').innerText = stats.totalContacts;
    document.getElementById('dash-messages-today').innerText = stats.messagesToday;
    document.getElementById('dash-total-broadcast').innerText = stats.totalBroadcasts;

    // Fetch Health / Uptime / Memory / Services
    try {
      const healthRes = await fetch('/health').then(r => r.json());
      const uptimeEl = document.getElementById('dash-server-uptime');
      const memoryEl = document.getElementById('dash-memory-usage');
      const pulseEl = document.getElementById('server-status-pulse');
      
      const dbStatusEl = document.getElementById('dash-db-status');
      const redisStatusEl = document.getElementById('dash-redis-status');
      const platformEl = document.getElementById('dash-platform');
      
      if (uptimeEl) uptimeEl.innerText = formatUptime(healthRes.uptime);
      if (memoryEl) memoryEl.innerText = healthRes.memory.heapUsed + ' MB';
      
      if (pulseEl) {
        pulseEl.style.backgroundColor = healthRes.status === 'ok' ? 'var(--primary)' : 'var(--danger)';
      }

      if (dbStatusEl) {
        dbStatusEl.innerText = `DB: ${healthRes.services.database.toUpperCase()}`;
        dbStatusEl.className = `status-badge ${healthRes.services.database === 'online' ? 'sent' : 'failed'}`;
      }
      if (redisStatusEl) {
        redisStatusEl.innerText = `RD: ${healthRes.services.redis.toUpperCase()}`;
        redisStatusEl.className = `status-badge ${healthRes.services.redis === 'online' ? 'sent' : 'failed'}`;
      }
      if (platformEl) {
        platformEl.innerText = `OS: ${healthRes.platform.toUpperCase()}`;
      }
    } catch (e) {
      console.warn("Gagal mengambil data health:", e);
    }

    // Recent Logs
    const logRes = await wa_api.chats.getLogs({ limit: 5 });
    const tbody = document.getElementById('dash-recent-logs');
    
    if (logRes.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Belum ada aktivitas</td></tr>`;
    } else {
      tbody.innerHTML = logRes.data.map(l => {
        const time = new Date(l.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const statusClass = l.status || 'sent';
        const phone = l.target_phone ? l.target_phone.split('@')[0] : '';
        
        return `
          <tr>
            <td>${phone}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.message_content || ''}">${l.message_content}</td>
            <td>${time}</td>
            <td><span class="status-badge ${statusClass}">${l.status.toUpperCase()}</span></td>
            <td>
              <div style="display: flex; gap: 8px;">
                ${l.status === 'failed' ? `
                <button class="btn-icon" onclick="resendLogMessage('${l.id}')" title="Kirim Ulang">
                  <i class="fa-solid fa-rotate"></i>
                </button>` : ''}
                <button class="btn-icon danger" onclick="deleteMessageLog('${l.id}')" title="Hapus">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error("Gagal memuat dashboard:", err);
    ['dash-active-sessions', 'dash-total-contacts', 'dash-messages-today', 'dash-total-broadcast', 'dash-server-uptime', 'dash-memory-usage'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.innerText === '...') el.innerText = 'Error'; 
    });
  } finally {
    // Always schedule a refresh if still on dashboard
    if (activeView === 'dashboard') {
      dashboardRefreshInterval = setTimeout(renderDashboard, 15000); // Auto refresh every 15s
    }
  }
}

// ─── SESSIONS MANAGEMENT ───
let qrEventSource = null;

async function renderSessions() {
  const grid = document.getElementById('sessions-grid');
  grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px;">
    <i class="fa-solid fa-circle-notch fa-spin fa-2x" style="color: var(--primary); margin-bottom: 10px;"></i>
    <p>Memuat perangkat...</p>
  </div>`;
  
  try {
    const res = await wa_api.sessions.list();
    const sessions = res.data;
    
    if (sessions.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px; background: rgba(255,255,255,0.02); border-radius: 20px; border: 2px dashed var(--glass-border);">
          <i class="fa-solid fa-mobile-screen fa-3x" style="color: var(--text-muted); margin-bottom: 20px; opacity: 0.5;"></i>
          <h3>Belum ada Perangkat</h3>
          <p class="text-muted" style="margin-bottom: 20px;">Hubungkan nomor WhatsApp Anda untuk mulai mengirim pesan.</p>
          <button class="btn btn-primary" onclick="openModal('modal-add-session')">
            <i class="fa-solid fa-plus"></i> Tambah Perangkat Pertama
          </button>
        </div>
      `;
      return;
    }

    grid.innerHTML = sessions.map((s) => {
      const statusText = s.status === 'qr' ? 'SCAN QR' : s.status.charAt(0).toUpperCase() + s.status.slice(1);
      const isActive = s.status === 'active';
      const isWaiting = ['qr', 'connecting'].includes(s.status);
      
      return `
        <div class="session-card ${s.status}">
          <div class="status-indicator"></div>
          <div class="session-card-header">
            <div class="session-info">
              <h3>${s.name}</h3>
              <p>${s.phone_number || (isWaiting ? 'Menunggu Scan...' : 'Terputus')}</p>
            </div>
            <span class="badge ${s.status}">${statusText}</span>
          </div>

          <div class="session-stats">
            <div class="session-stat-item">
              <div class="session-stat-label">Terkirim Hari Ini</div>
              <div class="session-stat-value">${s.daily_sent_count}</div>
            </div>
            <div class="session-stat-item">
              <div class="session-stat-label">Limit Harian</div>
              <div class="session-stat-value">${s.daily_limit}</div>
            </div>
          </div>

          <div class="session-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${isActive ? `
              <button class="btn btn-warning" style="flex: 2" onclick="disconnectSession('${s.id}')" title="Putuskan Koneksi">
                <i class="fa-solid fa-power-off"></i> Putuskan
              </button>
              <button class="btn btn-outline" style="flex: 0" onclick="clearSessionData('${s.id}')" title="Bersihkan Cache Sesi">
                <i class="fa-solid fa-broom"></i>
              </button>
            ` : `
              <button class="btn btn-primary" style="flex: 2" onclick="openQrModal('${s.id}')">
                <i class="fa-solid fa-qrcode"></i> ${isWaiting ? 'Lihat QR' : 'Hubungkan'}
              </button>
              ${isWaiting ? `
                <button class="btn btn-outline-warning" style="flex: 0" onclick="disconnectSession('${s.id}')" title="Batalkan Koneksi">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              ` : ''}
            `}
            <button class="btn btn-outline-secondary" style="flex: 0; padding: 0 12px;" onclick="openEditSessionModal('${s.id}')" title="Edit">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-danger" style="flex: 0; padding: 0 12px;" onclick="deleteSession('${s.id}')" title="Hapus">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    grid.innerHTML = `<div style="grid-column: 1/-1; color: var(--danger); text-align: center; padding: 40px;">
      <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
      <p style="margin-top: 10px;">Gagal memuat perangkat: ${err.message}</p>
    </div>`;
  }
}

async function createSession(e) {
  e.preventDefault();
  const input = document.getElementById('session-name');
  const limitInput = document.getElementById('session-limit');
  const name = input.value.trim();
  const dailyLimit = limitInput ? parseInt(limitInput.value) : 200;

  if (!name) return;
  
  const btn = e.target.querySelector('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Membuat...';
  btn.disabled = true;

  try {
    const res = await wa_api.sessions.create({ name, dailyLimit });
    closeModal('modal-add-session');
    input.value = '';
    renderSessions();
    openQrModal(res.data.id);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function openEditSessionModal(id) {
  try {
    const res = await wa_api.sessions.list();
    const session = res.data.find(s => s.id === id);
    if (!session) return;

    document.getElementById('edit-session-id').value = id;
    document.getElementById('edit-session-name').value = session.name;
    document.getElementById('edit-session-limit').value = session.daily_limit;
    
    openModal('modal-edit-session');
  } catch (err) {
    showToast("Gagal mengambil data sesi: " + err.message, "error");
  }
}

async function saveSessionEdit(e) {
  e.preventDefault();
  const id = document.getElementById('edit-session-id').value;
  const name = document.getElementById('edit-session-name').value;
  const dailyLimit = document.getElementById('edit-session-limit').value;

  const btn = e.target.querySelector('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Menyimpan...';
  btn.disabled = true;

  try {
    await wa_api.sessions.update(id, { name, dailyLimit });
    closeModal('modal-edit-session');
    showToast("Perangkat berhasil diperbarui!");
    renderSessions();
  } catch (err) {
    showToast("Gagal memperbarui perangkat: " + err.message, "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function openQrModal(id) {
  const container = document.getElementById('qr-image-container');
  const msg = document.getElementById('qr-status');
  
  if (container) container.innerHTML = `<div class="qr-placeholder"><i class="fa-solid fa-circle-notch fa-spin"></i> Menyiapkan...</div>`;
  if (msg) msg.innerText = 'Menghubungkan ke WhatsApp...';
  openModal('modal-qr');

  try {
    // 1. Trigger connection on backend
    await wa_api.sessions.connect(id);

    // 2. Start SSE
    if (qrEventSource) qrEventSource.close();
    qrEventSource = new EventSource(`/api/sessions/${id}/qr`);
    
    qrEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const now = new Date().toLocaleTimeString();
      
      if (data.type === 'qr') {
        if (container) container.innerHTML = `
          <img src="${data.qr}" alt="QR Code" style="max-width:100%; height:auto; border-radius:10px; border:1px solid #ddd;">
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 10px;">
            <i class="fa-solid fa-sync fa-spin"></i> Terakhir diperbarui: ${now}
          </div>
        `;
        if (msg) msg.innerText = 'Silakan scan QR Code dengan WhatsApp Anda';
      } else if (data.type === 'connected') {
        if (container) container.innerHTML = `<div class="qr-placeholder" style="color:var(--primary-color); flex-direction:column;">
          <i class="fa-solid fa-circle-check fa-3x" style="margin-bottom:15px"></i>
          <span>Berhasil Terhubung!</span>
        </div>`;
        if (msg) msg.innerText = `Terhubung ke: ${data.phone_number || 'WhatsApp'}`;
        
        // Refresh session list
        renderSessions();
      } else if (data.type === 'sync_progress') {
        if (msg) msg.innerText = `Sinkronisasi: ${data.message}`;
        if (data.status === 'completed') {
          setTimeout(() => {
            closeModal('modal-qr');
            qrEventSource.close();
            renderContacts();
            renderGroups();
          }, 2000);
        }
      }
    };

    qrEventSource.onerror = () => {
      if (msg) msg.innerText = 'Koneksi terganggu, mencoba menyambung kembali...';
      console.warn("SSE connection lost. Browser will auto-reconnect.");
    };

  } catch (err) {
    if (container) container.innerHTML = `<div class="qr-placeholder" style="color:var(--danger-color)">${err.message}</div>`;
    if (msg) msg.innerText = 'Gagal memulai koneksi.';
  }
}

async function disconnectSession(id) {
  const confirmed = await showConfirm('Putuskan koneksi perangkat ini? Browser akan ditutup untuk menghemat memori.', 'Putuskan Koneksi');
  if (!confirmed) return;
  try {
    showToast("Memutuskan koneksi...");
    await wa_api.sessions.disconnect(id);
    showToast("Koneksi diputuskan.");
    renderSessions();
    if (activeView === 'dashboard') renderDashboard();
  } catch (err) {
    showToast("Gagal memutuskan koneksi: " + err.message, "error");
  }
}

async function deleteSession(id) {
  const confirmed = await showConfirm('Hapus sesi ini secara permanen?', 'Hapus Perangkat', 'danger');
  if (!confirmed) return;
  try {
    await wa_api.sessions.delete(id);
    renderSessions();
    if (activeView === 'dashboard') renderDashboard();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function clearSessionData(id) {
  const confirmed = await showConfirm('Hapus semua pesan dan kontak untuk perangkat ini? Tindakan ini tidak dapat dibatalkan.', 'Bersihkan Data', 'danger');
  if (!confirmed) return;
  try {
    const res = await wa_api.sessions.clearData(id);
    showToast(`Berhasil! ${res.details.chats_deleted} pesan dan ${res.details.contacts_deleted} kontak dihapus.`);
    if (activeView === 'contacts') renderContacts();
    if (activeView === 'groups') renderGroups();
    if (activeView === 'live-chat') renderLiveChat();
    if (activeView === 'dashboard') renderDashboard();
  } catch (err) {
    showToast("Gagal menghapus data: " + err.message, "error");
  }
}

async function hardResetAllData() {
  const confirmed1 = await showConfirm('Anda akan menghapus SELURUH chat, kontak, dan pemetaan nomor di database. Lanjutkan?', 'RESET DATABASE TOTAL', 'danger');
  if (!confirmed1) return;
  
  const confirmed2 = await showConfirm('KONFIRMASI TERAKHIR: Semua data pesan akan hilang selamanya. Lanjutkan?', 'KONFIRMASI AKHIR', 'danger');
  if (!confirmed2) return;

  try {
    const res = await wa_api.sessions.resetAllData();
    showToast(res.message);
    setTimeout(() => location.reload(), 1500); // Give time for toast
  } catch (err) {
    showToast("Gagal melakukan reset: " + err.message, "error");
  }
}

// ─── CONTACTS MANAGEMENT ───
let cachedContacts = [];
let cachedGroups = [];
let contactOffset = 0;
const contactLimit = 25;

async function renderContacts() {
  const tbody = document.getElementById('contacts-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.contacts.list({ limit: contactLimit, offset: contactOffset });
    cachedContacts = res.data;
    const total = res.meta.total;
    
    displayContacts(cachedContacts);
    
    // Update pagination UI
    document.getElementById('contact-pagination-info').innerText = `Menampilkan ${contactOffset + 1} - ${Math.min(contactOffset + contactLimit, total)} dari ${total} kontak`;
    document.getElementById('btn-prev-contact').disabled = contactOffset === 0;
    document.getElementById('btn-next-contact').disabled = (contactOffset + contactLimit) >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Gagal memuat: ${err.message}</td></tr>`;
  }
}

function changeContactPage(dir) {
  contactOffset += (dir * contactLimit);
  if (contactOffset < 0) contactOffset = 0;
  renderContacts();
}

function displayContacts(contacts) {
  const tbody = document.getElementById('contacts-tbody');
  if (contacts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Belum ada Kontak Pribadi</td></tr>`;
    return;
  }

  tbody.innerHTML = contacts.map((c, index) => {
    const displayName = c.name && c.name !== '' ? c.name : c.phone_number.split('@')[0];
    const tags = Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? JSON.parse(c.tags || '[]') : []);
    const tagHtml = tags.map(t => `<span class="badge" style="background: rgba(59, 130, 246, 0.1); color: var(--info); font-size: 0.65rem; margin-right: 4px;">${t}</span>`).join('');
    
    return `
      <tr>
        <td>${contactOffset + index + 1}</td>
        <td><input type="checkbox" class="contact-checkbox" value="${c.phone_number}" data-name="${displayName}"></td>
        <td><strong>${displayName}</strong></td>
        <td>${c.phone_number.split('@')[0]}</td>
        <td>${tagHtml || '-'}</td>
        <td><span class="badge" style="font-size:0.7rem">${c.source}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" title="Kirim Pesan" onclick="openDirectMessageModal('${c.phone_number}')"><i class="fa-solid fa-paper-plane"></i></button>
          <button class="btn btn-sm btn-outline" title="Edit" onclick="openEditContactModal('${c.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm btn-outline" title="Hapus" style="color:var(--danger)" onclick="deleteContact('${c.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleSelectAllContacts(source) {
  document.querySelectorAll('.contact-checkbox').forEach(cb => cb.checked = source.checked);
}

function openAddContactModal() {
  document.getElementById('contact-modal-title').innerText = 'Tambah Kontak Baru';
  document.getElementById('contact-id').value = '';
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-phone').value = '';
  document.getElementById('contact-tags').value = '';
  openModal('modal-contact-form');
}

function openEditContactModal(id) {
  const c = cachedContacts.find(x => x.id === id);
  if (!c) return;

  document.getElementById('contact-modal-title').innerText = 'Edit Kontak';
  document.getElementById('contact-id').value = c.id;
  document.getElementById('contact-name').value = c.name || '';
  document.getElementById('contact-phone').value = c.phone_number.split('@')[0];
  
  const tags = Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? JSON.parse(c.tags || '[]') : []);
  document.getElementById('contact-tags').value = tags.join(', ');
  
  openModal('modal-contact-form');
}

async function saveContact(e) {
  e.preventDefault();
  const id = document.getElementById('contact-id').value;
  const name = document.getElementById('contact-name').value;
  const phone = document.getElementById('contact-phone').value;
  const tagsStr = document.getElementById('contact-tags').value;
  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()) : [];

  try {
    await wa_api.fetch('/contacts', {
      method: 'POST',
      body: JSON.stringify({ phone, name, tags })
    });
    closeModal('modal-contact-form');
    renderContacts();
    showToast("Kontak berhasil disimpan!");
  } catch (err) {
    showToast("Gagal menyimpan kontak: " + err.message, "error");
  }
}

async function deleteContact(id) {
  const confirmed = await showConfirm('Hapus kontak ini dari daftar?', 'Hapus Kontak', 'danger');
  if (!confirmed) return;
  try {
    await wa_api.contacts.delete(id);
    renderContacts();
  } catch (err) {
    alert("Gagal: " + err.message);
  }
}

function handleCampaignTargetChange(val) {
  const tagGroup = document.getElementById('tag-filter-group');
  tagGroup.style.display = (val === 'tags') ? 'block' : 'none';
}

function filterContacts() {
  const query = document.getElementById('search-contacts').value.toLowerCase();
  const filtered = cachedContacts.filter(c => 
    (c.name && c.name.toLowerCase().includes(query)) || 
    c.phone_number.includes(query)
  );
  displayContacts(filtered);
}

let groupOffset = 0;
const groupLimit = 25;

async function renderGroups() {
  const tbody = document.getElementById('groups-tbody');
  tbody.innerHTML = `<tr><td colspan="4" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.contacts.listGroups({ limit: groupLimit, offset: groupOffset });
    cachedGroups = res.data;
    const total = res.meta.total;

    displayGroups(cachedGroups);

    // Update pagination UI
    document.getElementById('group-pagination-info').innerText = `Menampilkan ${groupOffset + 1} - ${Math.min(groupOffset + groupLimit, total)} dari ${total} grup`;
    document.getElementById('btn-prev-group').disabled = groupOffset === 0;
    document.getElementById('btn-next-group').disabled = (groupOffset + groupLimit) >= total;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state text-danger">Gagal memuat: ${err.message}</td></tr>`;
  }
}

function changeGroupPage(dir) {
  groupOffset += (dir * groupLimit);
  if (groupOffset < 0) groupOffset = 0;
  renderGroups();
}

function displayGroups(groups) {
  const tbody = document.getElementById('groups-tbody');
  if (groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Belum ada Grup terdeteksi</td></tr>`;
    return;
  }

  tbody.innerHTML = groups.map((g, index) => {
    // Priority: Database name -> Group ID prefix
    const displayName = g.name && g.name !== '' ? g.name : g.phone_number.split('@')[0];
    return `
      <tr>
        <td>${groupOffset + index + 1}</td>
        <td><strong>${displayName}</strong></td>
        <td>${g.phone_number}</td>
        <td><span class="badge active">Active</span></td>
        <td>${g.source}</td>
      </tr>
    `;
  }).join('');
}

function filterGroups() {
  const query = document.getElementById('search-groups').value.toLowerCase();
  const filtered = cachedGroups.filter(g => 
    (g.name && g.name.toLowerCase().includes(query)) || 
    g.phone_number.includes(query)
  );
  displayGroups(filtered);
}



async function syncWhatsApp() {
  const overlay = document.getElementById('sync-overlay');
  const msg = document.getElementById('sync-progress-msg');
  
  overlay.style.display = 'flex';
  msg.innerHTML = `
    Memulai permintaan sinkronisasi ke HP...<br>
    <small style="opacity: 0.7; font-size: 0.8rem; display: block; margin-top: 10px;">
      Jika proses ini memakan waktu lebih dari 1 menit, Anda bisa 
      <a href="#" onclick="document.getElementById('sync-overlay').style.display='none'; return false;" style="color: var(--primary); text-decoration: underline;">Tutup Paksa</a>
    </small>
  `;

  try {
    await wa_api.fetch('/sessions/sync-all-contacts', { method: 'POST' });
    
    // Safety timeout: auto-close after 60 seconds if no 'completed' event received
    setTimeout(() => {
      if (overlay.style.display === 'flex') {
        overlay.style.display = 'none';
        renderContacts();
      }
    }, 60000);
    
  } catch (err) {
    overlay.style.display = 'none';
    showToast("Gagal sinkronisasi WhatsApp: " + err.message, "error");
  }
}

// ─── CAMPAIGNS MANAGEMENT ───
async function renderCampaigns() {
  const tbody = document.getElementById('campaigns-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.campaigns.list();
    const campaigns = res.data;
    
    if (campaigns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Belum ada Campaign</td></tr>`;
      return;
    }

    tbody.innerHTML = campaigns.map((c, index) => {
      const progress = c.total_recipients > 0 ? Math.round((c.sent_count / c.total_recipients) * 100) : 0;
      return `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${c.name}</strong></td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td>${c.total_recipients}</td>
        <td><span class="badge active">${c.sent_count}</span></td>
        <td><span class="badge danger">${c.failed_count || 0}</span></td>
        <td>
          <div style="width: 100%; background: var(--bg-dark); border-radius: 4px; height: 8px; overflow: hidden; margin-top: 5px;">
            <div style="width: ${progress}%; background: var(--primary); height: 100%;"></div>
          </div>
          <small>${progress}%</small>
        </td>
        <td>
          <div style="display: flex; gap: 5px;">
            ${['pending', 'draft', 'paused'].includes(c.status) 
              ? `<button class="btn btn-sm btn-primary" onclick="startCampaign('${c.id}')" title="Mulai"><i class="fa-solid fa-play"></i></button>` 
              : ''}
            ${(c.failed_count > 0) 
              ? `<button class="btn btn-sm btn-warning" onclick="resendCampaignFailed('${c.id}')" title="Resend Failed"><i class="fa-solid fa-rotate-right"></i></button>` 
              : ''}
          </div>
        </td>
      </tr>
    `}).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Gagal memuat: ${err.message}</td></tr>`;
  }
}

async function startCampaign(id) {
  const confirmed = await showConfirm('Mulai kirim broadcast ini?', 'Konfirmasi Broadcast');
  if (!confirmed) return;
  try {
    await wa_api.campaigns.start(id);
    renderCampaigns();
    showToast("Campaign dimulai!");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function resendCampaignFailed(id) {
  const confirmed = await showConfirm('Kirim ulang pesan yang gagal di campaign ini?', 'Resend Failed');
  if (!confirmed) return;
  try {
    const res = await wa_api.campaigns.resendFailed(id);
    showToast(res.message);
    renderCampaigns();
  } catch (err) {
    showToast(err.message, "error");
  }
}

let allContacts = [];

function openCampaignModal() {
  wa_api.contacts.list().then(res => {
    allContacts = res.data.filter(c => !c.is_opted_out);
    openModal('modal-add-campaign');
  }).catch(err => {
    showToast("Gagal memuat kontak: " + err.message, "error");
  });
}

async function createCampaign(e) {
  e.preventDefault();
  const name = document.getElementById('campaign-name').value;
  const message = document.getElementById('campaign-message').value;
  const targetType = document.getElementById('campaign-target').value;
  const greetings = document.getElementById('campaign-greetings').value.split(',').map(s => s.trim());
  const closers = document.getElementById('campaign-closers').value.split(',').map(s => s.trim());

  if (!name || !message) return;

  const btn = e.target.querySelector('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Memproses...';
  btn.disabled = true;

  try {
    let recipients = [];
    if (targetType === 'all') {
      recipients = allContacts.map(c => ({ phone: c.phone_number, name: c.name || '' }));
    } else if (targetType === 'selected') {
      const selected = document.querySelectorAll('.contact-checkbox:checked');
      recipients = Array.from(selected).map(cb => ({ phone: cb.value, name: cb.getAttribute('data-name') }));
    } else if (targetType === 'tags') {
      const tagFilter = document.getElementById('campaign-tag-filter').value.toLowerCase();
      recipients = allContacts.filter(c => {
        const tags = Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? JSON.parse(c.tags || '[]') : []);
        return tags.some(t => t.toLowerCase().includes(tagFilter));
      }).map(c => ({ phone: c.phone_number, name: c.name || '' }));
    } else {
      // Groups
      const res = await wa_api.contacts.listGroups();
      recipients = res.data.map(g => ({ phone: g.phone_number, name: g.name }));
    }

    if (recipients.length === 0) {
      throw new Error("Tidak ada target ditemukan (Pastikan Anda sudah mencentang kontak atau memasukkan tag yang benar).");
    }

    const payload = {
      name,
      template: message,
      recipients,
      variationPool: {
        greetings,
        closers
      }
    };

    const res = await wa_api.campaigns.create(payload);
    
    // Auto-start campaign (Fixed reference to campaignId)
    await wa_api.campaigns.start(res.data.campaignId);
    
    closeModal('modal-add-campaign');
    document.getElementById('campaign-name').value = '';
    document.getElementById('campaign-message').value = '';
    renderCampaigns();
    showToast(`Campaign "${name}" berhasil dibuat dengan ${recipients.length} target!`);
  } catch (err) {
    showToast("Gagal: " + err.message, "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// ─── MODAL UTILS ───
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (id === 'modal-qr' && qrEventSource) {
    qrEventSource.close();
  }
}

// ─── LIVE CHAT (CS) ───
let activeChatPhone = null;
let chatEventSource = null;

function renderLiveChat() {
  document.getElementById('chat-badge').style.display = 'none';

  wa_api.chats.list().then(res => {
    const list = document.getElementById('chat-sidebar-list');
    if (res.data.length === 0) {
      list.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted)">Belum ada obrolan</div>`;
      return;
    }
    
    let html = '';
    res.data.forEach(c => {
      const isSelected = activeChatPhone === c.phone_number ? 'active' : '';
      const icon = c.is_from_me ? '<i class="fa-solid fa-check-double" style="color: var(--primary)"></i>' : '';
      
      // Clean up display name to avoid duplicates like "6098.. (6098..)"
      const cleanPhone = c.display_phone ? c.display_phone.split('@')[0] : c.raw_jid.split('@')[0];
      const displayName = (c.contact_name && c.contact_name !== cleanPhone) ? c.contact_name : cleanPhone;
      
      html += `
        <div class="chat-sidebar-item ${isSelected}" onclick="openChatHistory('${c.raw_jid}', '${c.contact_name || ''}', '${c.display_phone}')">
          <div class="phone">${displayName}</div>
          <div class="preview">${icon} ${c.message_text}</div>
        </div>
      `;
    });
    list.innerHTML = html;
  }).catch(err => {
    console.error("Gagal load chat list", err);
  });
}

function openChatHistory(phone, nameStr, displayPhone) {
  activeChatPhone = phone;
  document.getElementById('empty-chat-area').style.display = 'none';
  document.getElementById('chat-area').style.display = 'flex';
  
  const cleanPhone = (displayPhone || phone).split('@')[0];
  const displayName = (nameStr && nameStr !== cleanPhone) ? nameStr : cleanPhone;
  document.getElementById('active-chat-phone').innerText = displayName;
  
  // Highlight active chat in sidebar
  const items = document.querySelectorAll('.chat-sidebar-item');
  items.forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('onclick').includes(phone)) {
      item.classList.add('active');
    }
  });

  // Mark as read in backend
  wa_api.fetch(`/chats/${phone}/read`, { method: 'POST' }).catch(() => {});
  
  const history = document.getElementById('chat-history');
  history.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted)">Memuat riwayat...</div>';

  wa_api.chats.getHistory(phone).then(res => {
    const messages = res.data;
    if (messages.length === 0) {
      history.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted)">Belum ada riwayat pesan</div>';
      return;
    }

    let html = '';
    messages.forEach(msg => {
      const type = msg.is_from_me ? 'outgoing' : 'incoming';
      const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      html += `
        <div class="chat-bubble ${type}" title="Double click untuk hapus" oncontextmenu="deleteMessage('${msg.id}'); return false;">
          ${msg.message_text}
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
            <span class="chat-time">${time}</span>
            <i class="fa-solid fa-trash-can" style="font-size: 0.7rem; opacity: 0; cursor: pointer;" onclick="deleteMessage('${msg.id}')"></i>
          </div>
        </div>
      `;
    });
    history.innerHTML = html;
    history.scrollTop = history.scrollHeight;
  }).catch(err => {
    console.error("Gagal load history", err);
    history.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger)">Gagal memuat riwayat</div>';
  });
}

async function deleteMessage(messageId) {
  if (!confirm('Hapus pesan ini dari dashboard?')) return;
  try {
    await wa_api.fetch(`/chats/message/${messageId}`, { method: 'DELETE' });
    openChatHistory(activeChatPhone); // Refresh history
  } catch (err) {
    alert("Gagal hapus pesan: " + err.message);
  }
}

async function clearChatHistory() {
  if (!activeChatPhone) return;
  if (!confirm(`Hapus seluruh riwayat chat dengan ${activeChatPhone}?`)) return;
  
  try {
    await wa_api.fetch(`/chats/history/${activeChatPhone}`, { method: 'DELETE' });
    renderLiveChat(); // Refresh sidebar
    document.getElementById('chat-history').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted)">Riwayat telah dihapus</div>';
  } catch (err) {
    alert("Gagal hapus riwayat: " + err.message);
  }
}

async function sendChatReply(e) {
  e.preventDefault();
  if (!activeChatPhone) return;

  const input = document.getElementById('chat-reply-input');
  const message = input.value;
  if (!message) return;

  const btn = document.getElementById('btn-send-reply');
  btn.disabled = true;

  try {
    await wa_api.chats.sendReply(activeChatPhone, message);
    input.value = '';
  } catch (err) {
    alert("Gagal kirim pesan: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function initChatStream() {
  if (chatEventSource) chatEventSource.close();
  chatEventSource = new EventSource(`/api/chats/stream/events?api_key=${CURRENT_API_KEY}`);
  
  chatEventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    
    // Handle sync progress globally
    if (data.type === 'sync_progress') {
      const overlay = document.getElementById('sync-overlay');
      const msg = document.getElementById('sync-progress-msg');
      
      if (data.status === 'completed') {
        setTimeout(() => {
          if (overlay) overlay.style.display = 'none';
          renderContacts();
          renderSessions();
        }, 2000);
      }
      return;
    }

    // Handle message status updates (Checks)
    if (data.type === 'message_ack') {
      if (activeView === 'dashboard') renderDashboard();
      if (activeView === 'logs') renderMessageLogs();
      return;
    }

    // Handle QR Updates
    if (data.type === 'qr') {
      const qrContainer = document.getElementById('qr-image-container');
      const qrStatus = document.getElementById('qr-status');
      if (qrContainer) {
        qrContainer.innerHTML = `<img src="${data.qr}" alt="QR Code" style="width: 256px; height: 256px; border: 10px solid white; border-radius: 10px; margin: 20px auto;">`;
        if (qrStatus) qrStatus.innerText = 'Silakan scan melalui WhatsApp Anda';
      }
      return;
    }

    // Handle Status Updates (Active)
    if (data.type === 'status' && data.status === 'active') {
      showToast(`Perangkat Berhasil Terhubung!`, 'success');
      renderSessions();
      // Tutup modal QR secara otomatis jika sedang terbuka
      const modal = document.getElementById('modal-qr');
      if (modal) modal.style.display = 'none';
      return;
    }

    // Notification badge for messages
    const isDashboard = activeView === 'dashboard';
    const chatTab = document.querySelector('.nav-link[data-view="live-chat"]');
    
    if (isDashboard) {
      renderDashboard(); // Auto refresh dash if on dashboard
    }
    
    if (!chatTab) return; // Exit if Live Chat is hidden
    
    const isLiveChatOn = document.getElementById('live-chat-toggle')?.checked ?? true;
    
    if (activeView !== 'live-chat' && isLiveChatOn) {
      const badge = document.getElementById('chat-badge');
      if (badge) badge.style.display = 'inline-block';
    } else if (activeView === 'live-chat') {
      renderLiveChat(); // update sidebar
    }

    // Append bubble if viewing this chat
    if (activeChatPhone === data.phone_number) {
      const history = document.getElementById('chat-history');
      const type = data.is_from_me ? 'outgoing' : 'incoming';
      const time = new Date(data.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      history.innerHTML += `
        <div class="chat-bubble ${type}">
          ${data.message_text}
          <span class="chat-time">${time}</span>
        </div>
      `;
      history.scrollTop = history.scrollHeight;
    }
  };
}

async function openDirectMessageModal(prefillPhone = '') {
  try {
    const res = await wa_api.sessions.list();
    const activeSessions = res.data.filter(s => s.status === 'active');
    const select = document.getElementById('dm-session-id');
    
    if (activeSessions.length === 0) {
      showToast("Tidak ada perangkat WhatsApp yang aktif. Hubungkan nomor terlebih dahulu.", "error");
      return;
    }

    select.innerHTML = '<option value="auto">Otomatis (Rotasi Perangkat)</option>' + activeSessions.map(s => `
      <option value="${s.id}">${s.name} (${s.phone_number || 'Tanpa Nomor'})</option>
    `).join('');
    
    // Prefill phone if provided
    const phoneInput = document.getElementById('dm-target-phone');
    if (phoneInput) {
      phoneInput.value = prefillPhone ? prefillPhone.split('@')[0] : '';
    }

    openModal('modal-direct-message');
  } catch (err) {
    showToast("Gagal memuat daftar perangkat: " + err.message, "error");
  }
}

async function sendDirectMessage(e) {
  e.preventDefault();
  const sessionId = document.getElementById('dm-session-id').value;
  const phone = document.getElementById('dm-target-phone').value;
  const message = document.getElementById('dm-message').value;
  
  const btn = e.target.querySelector('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Mengirim...';
  btn.disabled = true;

  try {
    // Bersihkan nomor dari spasi, strip, atau simbol lainnya
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    
    if (!cleanPhone) {
      throw new Error("Nomor tujuan tidak valid");
    }

    await wa_api.fetch(`/chats/${cleanPhone}`, {
      method: 'POST',
      body: JSON.stringify({ message, sessionId: sessionId || 'auto' })
    });
    
    closeModal('modal-direct-message');
    showToast("Pesan berhasil dikirim!");
    if (document.getElementById('view-logs').classList.contains('active')) {
      renderMessageLogs();
    }
  } catch (err) {
    showToast("Gagal mengirim pesan: " + err.message, "error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
