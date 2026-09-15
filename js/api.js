const API_BASE_KEY = 'dtr_api_base';
const TOKEN_KEY = 'dtr_api_token';

export function getApiBase() {
  const custom = localStorage.getItem(API_BASE_KEY);
  if (custom && !custom.includes('dtrproj.onrender.com')) {
    return custom;
  }
  return '/api';
}

export function setApiBase(url) {
  if (!url) localStorage.removeItem(API_BASE_KEY);
  else localStorage.setItem(API_BASE_KEY, url);
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function setApiToken(token) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export function getApiToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function hasApiToken() {
  return !!localStorage.getItem(TOKEN_KEY);
}

// ─── AUTH APIS ───
export async function apiHealth() {
  return request('/health', { method: 'GET' });
}

export async function apiLogin(identifier, password) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: identifier, password }),
  });
}

export async function apiSignup(userData) {
  return request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}

export async function apiMe() {
  return request('/auth/me', { method: 'GET' });
}

export async function apiForgotPassword(identifier) {
  return request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
}

export async function apiResetPassword(token, newPassword, confirmPassword) {
  return request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword, confirmPassword }),
  });
}

export async function apiVerifyEmail() {
  return request('/auth/verify-email', { method: 'POST' });
}

// ─── USER & SETTINGS APIS ───
export async function apiUpdateProfile(payload) {
  return request('/users/me/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function apiUpdateSettings(payload) {
  return request('/users/me/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function apiChangePassword(currentPassword, newPassword, confirmPassword) {
  return request('/users/me/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
  });
}

// ─── DTR ATTENDANCE APIS ───
export async function apiListDTR(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const path = qs ? `/dtr?${qs}` : '/dtr';
  return request(path, { method: 'GET' });
}

export async function apiCreateDTR(record) {
  return request('/dtr', {
    method: 'POST',
    body: JSON.stringify(record),
  });
}

export async function apiUpdateDTR(id, patch) {
  return request(`/dtr/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteDTR(id) {
  return request(`/dtr/${id}`, {
    method: 'DELETE',
  });
}

export async function apiClearDTR(ojtId) {
  const path = ojtId ? `/dtr?ojtId=${ojtId}` : '/dtr';
  return request(path, { method: 'DELETE' });
}

export async function apiCheckDuplicates(rows) {
  return request('/dtr/check-duplicates', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

export async function apiBulkImportDTR(records, ojtRequirementId, duplicateMode = 'skip') {
  return request('/dtr/bulk', {
    method: 'POST',
    body: JSON.stringify({ records, ojtRequirementId, duplicateMode }),
  });
}

// ─── OJT REQUIREMENTS APIS ───
export async function apiListOJTs() {
  return request('/ojt', { method: 'GET' });
}

export async function apiCreateOJT(data) {
  return request('/ojt', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function apiUpdateOJT(id, data) {
  return request(`/ojt/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function apiActivateOJT(id) {
  return request(`/ojt/${id}/activate`, {
    method: 'POST',
  });
}

export async function apiDeleteOJT(id) {
  return request(`/ojt/${id}`, {
    method: 'DELETE',
  });
}

// ─── HOLIDAYS APIS ───
export async function apiListHolidays(year) {
  const path = year ? `/holidays?year=${year}` : '/holidays';
  return request(path, { method: 'GET' });
}

export async function apiAddHoliday(date, name) {
  return request('/holidays', {
    method: 'POST',
    body: JSON.stringify({ date, name }),
  });
}

export async function apiDeleteHoliday(id) {
  return request(`/holidays/${id}`, {
    method: 'DELETE',
  });
}

// ─── ADMIN APIS ───
export async function apiAdminGetStats() {
  return request('/users/admin/stats', { method: 'GET' });
}

export async function apiAdminListUsers() {
  return request('/users/admin/users', { method: 'GET' });
}

export async function apiAdminCreateUser(payload) {
  return request('/users/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiAdminUpdateUser(id, payload) {
  return request(`/users/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function apiAdminResetUserPassword(idOrUsername, newPassword, confirmPassword) {
  return request(`/users/admin/users/${idOrUsername}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ newPassword, confirmPassword }),
  });
}

export async function apiAdminDeleteUser(id) {
  return request(`/users/admin/users/${id}`, {
    method: 'DELETE',
  });
}

export async function apiAdminGetUserDTR(userId) {
  return request(`/users/admin/users/${userId}/dtr`, { method: 'GET' });
}

export async function apiAdminUpdateUserDTR(userId, entryId, payload) {
  return request(`/users/admin/users/${userId}/dtr/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function apiAdminDeleteUserDTR(userId, entryId) {
  return request(`/users/admin/users/${userId}/dtr/${entryId}`, {
    method: 'DELETE',
  });
}

export async function apiAdminGetAuditLogs() {
  return request('/users/admin/audit-logs', { method: 'GET' });
}

// ─── BACKWARD COMPATIBILITY ALIASES ───
export const apiListSessions = apiListDTR;
export const apiCreateSession = apiCreateDTR;
export const apiUpdateSession = apiUpdateDTR;
export const apiDeleteSession = apiDeleteDTR;
export const apiClearSessions = apiClearDTR;
