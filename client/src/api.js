const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const TOKEN_KEY = 'roster.token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}

// Every request goes through here, so the token is attached in one place and
// a failed response always turns into an Error carrying the server's message
// rather than whatever shape the JSON happened to be.
export async function request(path, { method = 'GET', body, signal } = {}) {
  const token = getToken();

  const response = await fetch(BASE + path, {
    method,
    signal,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try { data = await response.json(); } catch { /* 204, or a crash page */ }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

export const api = {
  login:    (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  register: (body)            => request('/auth/register', { method: 'POST', body }),
  me:       (signal)          => request('/auth/me', { signal }),

  staff:      ()   => request('/staff'),
  addStaff:   (b)  => request('/staff', { method: 'POST', body: b }),
  removeStaff:(id) => request(`/staff/${id}`, { method: 'DELETE' }),

  schedules:      ()        => request('/schedules'),
  schedule:       (id)      => request(`/schedules/${id}`),
  createSchedule: (b)       => request('/schedules', { method: 'POST', body: b }),
  generate:       (id)      => request(`/schedules/${id}/generate`, { method: 'POST' }),
  publish:        (id)      => request(`/schedules/${id}/publish`, { method: 'POST' }),
  deleteSchedule: (id)      => request(`/schedules/${id}`, { method: 'DELETE' }),
  assign:   (shiftId, userId) => request(`/schedules/shifts/${shiftId}/assign`, { method: 'POST', body: { user_id: userId } }),
  unassign: (assignmentId)    => request(`/schedules/assignments/${assignmentId}`, { method: 'DELETE' }),

  availability:    (userId) => request('/availability' + (userId ? `?user_id=${userId}` : '')),
  setAvailability: (b)      => request('/availability', { method: 'PUT', body: b }),
  clearAvailability:(date)  => request(`/availability/${date}`, { method: 'DELETE' }),

  myShifts: ()   => request('/swaps/my-shifts'),
  swaps:    ()   => request('/swaps'),
  openSwap: (b)  => request('/swaps', { method: 'POST', body: b }),
  acceptSwap:(id)=> request(`/swaps/${id}/accept`, { method: 'POST' }),
  declineSwap:(id)=>request(`/swaps/${id}/decline`, { method: 'POST' }),
  cancelSwap:(id)=> request(`/swaps/${id}/cancel`, { method: 'POST' })
};
