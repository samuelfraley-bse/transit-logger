// src/api.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// --- Send one or multiple log events to the backend ---
export async function postLogs(events) {
  const body = Array.isArray(events) ? events : [events];
  const res = await fetch(`${API_URL}/api/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return res.json();
}

// --- Fetch recent logs from the backend (for testing) ---
export async function fetchRecentLogs(limit = 10) {
  const res = await fetch(`${API_URL}/api/logs`);
  if (!res.ok) throw new Error('Failed to fetch logs');
  const rows = await res.json();
  return rows.slice(0, limit);
}
