/**
 * API Wrapper for Backend Calls
 */
const API_BASE = '/api';
const API_KEY = 'dev-wa-gateway-key-2026'; // Hardcoded for demo, in production should be handled securely

const api = {
  async fetch(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(options.headers || {})
    };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'API request failed');
      }
      return data;
    } catch (err) {
      console.error(`API Error (${endpoint}):`, err);
      throw err;
    }
  },

  // Sessions
  sessions: {
    list: () => api.fetch('/sessions'),
    create: (name) => api.fetch('/sessions', { method: 'POST', body: JSON.stringify({ name }) }),
    connect: (id) => api.fetch(`/sessions/${id}/connect`, { method: 'POST' }),
    delete: (id) => api.fetch(`/sessions/${id}`, { method: 'DELETE' }),
    restart: (id) => api.fetch(`/sessions/${id}/restart`, { method: 'POST' })
  },

  // Campaigns
  campaigns: {
    list: () => api.fetch('/campaigns'),
    detail: (id) => api.fetch(`/campaigns/${id}`),
    create: (payload) => api.fetch('/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
    start: (id) => api.fetch(`/campaigns/${id}/start`, { method: 'POST' }),
    pause: (id) => api.fetch(`/campaigns/${id}/pause`, { method: 'POST' })
  },

  // Contacts
  contacts: {
    list: () => api.fetch('/contacts?limit=100'),
    delete: (id) => api.fetch(`/contacts/${id}`, { method: 'DELETE' })
  },

  // System
  dashboard: {
    stats: () => api.fetch('/dashboard/stats')
  },
  chats: {
    list: () => api.fetch('/chats'),
    getHistory: (phone) => api.fetch(`/chats/${phone}`),
    sendReply: (phone, message) => api.fetch(`/chats/${phone}`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
    deleteMessage: (id) => api.fetch(`/chats/message/${id}`, { method: 'DELETE' }),
    clearHistory: (phone) => api.fetch(`/chats/history/${phone}`, { method: 'DELETE' })
  }
};
