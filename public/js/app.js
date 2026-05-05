/**
 * Main Application Logic (Vanilla JS SPA)
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initChatStream();
  loadView('sessions'); // Default view
});

// ─── MODAL UTILITIES ───
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
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
  // Hide all sections
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  
  // Show target section
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
  }

  // Load data based on view
  if (viewId === 'sessions') renderSessions();
  if (viewId === 'contacts') renderContacts();
  if (viewId === 'groups') renderGroups();
  if (viewId === 'campaigns') renderCampaigns();
  if (viewId === 'live-chat') {
    renderLiveChat();
    document.getElementById('chat-badge').style.display = 'none';
  }
}

// ─── SESSIONS MANAGEMENT ───
let qrEventSource = null;

async function renderSessions() {
  const tbody = document.getElementById('sessions-tbody');
  tbody.innerHTML = `<tr><td colspan="5" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.sessions.list();
    const sessions = res.data;
    
    if (sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Belum ada Sesi WhatsApp</td></tr>`;
      return;
    }

    tbody.innerHTML = sessions.map(s => `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.phone_number || '-'}</td>
        <td><span class="badge ${s.status}">${s.status}</span></td>
        <td>${s.daily_sent_count} / ${s.daily_limit}</td>
        <td>
          ${s.status !== 'active' ? `<button class="btn btn-sm btn-primary" onclick="openQrModal('${s.id}')">Scan QR</button>` : ''}
          <button class="btn btn-sm btn-secondary" onclick="clearSessionData('${s.id}')" title="Hapus pesan & kontak perangkat ini">Kosongkan Data</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSession('${s.id}')">Hapus</button>
        </td>
      </tr>
    `).join('');

    // Update stats
    const activeCount = sessions.filter(s => s.status === 'active').length;
    const totalSent = sessions.reduce((sum, s) => sum + (s.daily_sent_count || 0), 0);
    
    document.getElementById('stat-sessions-active').innerText = activeCount;
    document.getElementById('stat-messages-today').innerText = totalSent;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-danger">Gagal memuat sesi: ${err.message}</td></tr>`;
  }
}

async function createSession(e) {
  e.preventDefault();
  const input = document.getElementById('session-name');
  const name = input.value.trim();
  if (!name) return;
  
  const btn = e.target.querySelector('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Membuat...';
  btn.disabled = true;

  try {
    const res = await wa_api.sessions.create(name);
    closeModal('modal-add-session');
    input.value = '';
    renderSessions();
    openQrModal(res.data.id);
  } catch (err) {
    alert(err.message);
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
      
      if (data.type === 'qr') {
        if (container) container.innerHTML = `<img src="${data.qr}" alt="QR Code" style="max-width:100%; height:auto;">`;
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
      if (container) container.innerHTML = `<div class="qr-placeholder" style="color:var(--danger-color)">
        <i class="fa-solid fa-triangle-exclamation fa-2x" style="margin-bottom:10px"></i>
        <span>Koneksi ke server terputus</span>
      </div>`;
      if (msg) msg.innerText = 'Gagal memuat QR. Silakan coba lagi.';
      qrEventSource.close();
    };

  } catch (err) {
    if (container) container.innerHTML = `<div class="qr-placeholder" style="color:var(--danger-color)">${err.message}</div>`;
    if (msg) msg.innerText = 'Gagal memulai koneksi.';
  }
}

async function deleteSession(id) {
  if (!confirm('Hapus sesi ini?')) return;
  try {
    await wa_api.sessions.delete(id);
    renderSessions();
  } catch (err) {
    alert(err.message);
  }
}

async function clearSessionData(id) {
  if (!confirm('⚠️ PERINGATAN: Hapus semua pesan dan kontak untuk perangkat ini? Tindakan ini tidak dapat dibatalkan.')) return;
  try {
    const res = await wa_api.sessions.clearData(id);
    alert(`Berhasil! ${res.details.chats_deleted} pesan dan ${res.details.contacts_deleted} kontak dihapus.`);
    if (activeView === 'contacts') renderContacts();
    if (activeView === 'groups') renderGroups();
    if (activeView === 'live-chat') renderLiveChat();
  } catch (err) {
    alert("Gagal menghapus data: " + err.message);
  }
}

async function hardResetAllData() {
  const confirm1 = confirm('🚨 PERINGATAN KERAS: Anda akan menghapus SELURUH chat, kontak, dan pemetaan nomor di database. Tindakan ini tidak dapat dibatalkan.\n\nApakah Anda yakin?');
  if (!confirm1) return;
  
  const confirm2 = confirm('KONFIRMASI TERAKHIR: Semua data pesan akan hilang selamanya (Sesi tetap aman). Lanjutkan?');
  if (!confirm2) return;

  try {
    const res = await wa_api.sessions.resetAllData();
    alert("✅ " + res.message);
    location.reload(); // Force reload to clear everything
  } catch (err) {
    alert("❌ Gagal melakukan reset: " + err.message);
  }
}

// ─── CONTACTS MANAGEMENT ───
let cachedContacts = [];
let cachedGroups = [];

async function renderContacts() {
  const tbody = document.getElementById('contacts-tbody');
  tbody.innerHTML = `<tr><td colspan="4" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.contacts.list({ limit: 500 });
    cachedContacts = res.data;
    displayContacts(cachedContacts);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state text-danger">Gagal memuat: ${err.message}</td></tr>`;
  }
}

function displayContacts(contacts) {
  const tbody = document.getElementById('contacts-tbody');
  if (contacts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Belum ada Kontak Pribadi</td></tr>`;
    return;
  }

  tbody.innerHTML = contacts.map(c => {
    // Priority: Database name -> Phone number prefix
    const displayName = c.name && c.name !== '' ? c.name : c.phone_number.split('@')[0];
    return `
      <tr>
        <td><strong>${displayName}</strong></td>
        <td>${c.phone_number}</td>
        <td><span class="badge active">Active</span></td>
        <td>${c.source}</td>
      </tr>
    `;
  }).join('');
}

function filterContacts() {
  const query = document.getElementById('search-contacts').value.toLowerCase();
  const filtered = cachedContacts.filter(c => 
    (c.name && c.name.toLowerCase().includes(query)) || 
    c.phone_number.includes(query)
  );
  displayContacts(filtered);
}

async function renderGroups() {
  const tbody = document.getElementById('groups-tbody');
  tbody.innerHTML = `<tr><td colspan="4" class="text-center">Loading...</td></tr>`;
  
  try {
    const res = await wa_api.contacts.listGroups();
    cachedGroups = res.data;
    displayGroups(cachedGroups);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state text-danger">Gagal memuat: ${err.message}</td></tr>`;
  }
}

function displayGroups(groups) {
  const tbody = document.getElementById('groups-tbody');
  if (groups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Belum ada Grup terdeteksi</td></tr>`;
    return;
  }

  tbody.innerHTML = groups.map(g => {
    // Priority: Database name -> Group ID prefix
    const displayName = g.name && g.name !== '' ? g.name : g.phone_number.split('@')[0];
    return `
      <tr>
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

async function syncLaravel() {
  const overlay = document.getElementById('sync-overlay');
  overlay.style.display = 'flex';

  try {
    const res = await wa_api.fetch('/contacts/sync-laravel', { method: 'POST' });
    alert(`Sinkronisasi selesai! Ditambahkan: ${res.data.added}, Diperbarui: ${res.data.updated}`);
    renderContacts();
  } catch (err) {
    alert("Gagal sinkronisasi: " + err.message);
  } finally {
    overlay.style.display = 'none';
  }
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
    alert("Gagal sinkronisasi WhatsApp: " + err.message);
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

    tbody.innerHTML = campaigns.map(c => {
      const progress = c.total_recipients > 0 ? Math.round((c.sent_count / c.total_recipients) * 100) : 0;
      return `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td>${c.total_recipients}</td>
        <td>${c.sent_count}</td>
        <td>
          <div style="width: 100%; background: var(--bg-dark); border-radius: 4px; height: 8px; overflow: hidden; margin-top: 5px;">
            <div style="width: ${progress}%; background: var(--primary); height: 100%;"></div>
          </div>
        </td>
        <td>
          ${['pending', 'draft', 'paused'].includes(c.status) 
            ? `<button class="btn btn-sm btn-primary" onclick="startCampaign('${c.id}')">Mulai</button>` 
            : ''}
        </td>
      </tr>
    `}).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Gagal memuat: ${err.message}</td></tr>`;
  }
}

async function startCampaign(id) {
  if (!confirm('Mulai kirim broadcast ini?')) return;
  try {
    await wa_api.campaigns.start(id);
    renderCampaigns();
  } catch (err) {
    alert(err.message);
  }
}

let allContacts = [];

function openCampaignModal() {
  if (allContacts.length === 0) {
    wa_api.contacts.list().then(res => {
      allContacts = res.data.filter(c => !c.is_opted_out);
      const sel = document.getElementById('campaign-target');
      sel.innerHTML = `<option value="all">Semua Kontak Aktif (${allContacts.length})</option>`;
      openModal('modal-add-campaign');
    }).catch(err => {
      alert("Gagal memuat kontak: " + err.message);
    });
  } else {
    openModal('modal-add-campaign');
  }
}

async function createCampaign(e) {
  e.preventDefault();
  const name = document.getElementById('campaign-name').value;
  const message = document.getElementById('campaign-message').value;

  if (!name || !message) return;
  if (allContacts.length === 0) {
    alert("Tidak ada kontak tersedia untuk dikirim.");
    return;
  }

  const btn = e.target.querySelector('button');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Membuat...';
  btn.disabled = true;

  try {
    const recipients = allContacts.map(c => ({ phone: c.phone_number, name: c.name || '' }));
    await wa_api.campaigns.create({
      name,
      template: message,
      recipients
    });
    
    closeModal('modal-add-campaign');
    document.getElementById('campaign-name').value = '';
    document.getElementById('campaign-message').value = '';
    renderCampaigns();
  } catch (err) {
    alert("Gagal membuat campaign: " + err.message);
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
      
      // Use resolved display_phone from backend if available
      const cleanPhone = c.display_phone.split('@')[0];
      const displayName = c.contact_name ? `${c.contact_name} (${cleanPhone})` : cleanPhone;
      
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
  const displayName = nameStr ? `${nameStr} (${cleanPhone})` : cleanPhone;
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
  chatEventSource = new EventSource(`/api/chats/stream/events?api_key=${API_KEY}`);
  
  chatEventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    
    // Handle sync progress globally
    if (data.type === 'sync_progress') {
      const overlay = document.getElementById('sync-overlay');
      const msg = document.getElementById('sync-progress-msg');
      
      if (overlay) overlay.style.display = 'flex';
      if (msg) msg.innerText = data.message;

      if (data.status === 'completed') {
        setTimeout(() => {
          if (overlay) overlay.style.display = 'none';
          renderContacts();
          renderSessions();
        }, 2000);
      }
      return;
    }

    // Notification badge for messages
    const chatTab = document.querySelector('.nav-link[data-view="live-chat"]');
    if (!chatTab.classList.contains('active')) {
      document.getElementById('chat-badge').style.display = 'inline-block';
    } else {
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
