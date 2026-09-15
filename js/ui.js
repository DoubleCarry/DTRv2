/**
 * DTR — UI Helpers
 * Toast notifications, modal open/close, confirm dialog.
 */

/* ─── TOAST ─── */
const toastContainer = () => document.getElementById('toastContainer');

const TOAST_ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

export function toast(message, type = 'info', duration = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] ?? 'ℹ️'}</span><span>${message}</span>`;
  toastContainer().appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, duration);
}

/* ─── MODAL ─── */
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

/** Close modal when clicking the dark overlay (not the modal box itself) */
export function initModalOverlayClose() {
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.add('hidden');
    }
  });
}

/* ─── CONFIRM DIALOG ─── */
let _confirmResolve = null;

export function initConfirmDialog() {
  document.getElementById('confirmYesBtn').addEventListener('click', () => {
    closeModal('confirmModal');
    if (_confirmResolve) _confirmResolve(true);
  });
  document.getElementById('confirmNoBtn').addEventListener('click', () => {
    closeModal('confirmModal');
    if (_confirmResolve) _confirmResolve(false);
  });
}

/**
 * Show a custom confirm dialog.
 * @returns {Promise<boolean>}
 */
export function confirm(title, body, yesLabel = 'Confirm', yesClass = 'btn-danger') {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  const yesBtn = document.getElementById('confirmYesBtn');
  yesBtn.textContent = yesLabel;
  yesBtn.className = `btn ${yesClass}`;
  openModal('confirmModal');
  return new Promise(resolve => { _confirmResolve = resolve; });
}

/* ─── PROGRESS RING ─── */
const RING_CIRCUMFERENCE = 471.24; // 2π × 75

export function setProgressRing(pct) {
  const fill   = document.getElementById('progressRingFill');
  const pctEl  = document.getElementById('ringPct');
  const clamped = Math.min(100, Math.max(0, pct));
  const offset  = RING_CIRCUMFERENCE - (clamped / 100) * RING_CIRCUMFERENCE;

  fill.style.strokeDashoffset = offset;
  if (clamped >= 100)     fill.style.stroke = 'var(--accent4)';
  else if (clamped >= 75) fill.style.stroke = 'var(--accent2)';
  else                    fill.style.stroke = 'var(--accent)';

  if (pctEl) pctEl.textContent = clamped + '%';
}

/* ─── LIVE CLOCK ─── */
import { fmtClock } from './utils.js';

export function startClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const tick = () => { el.textContent = fmtClock(); };
  tick();
  setInterval(tick, 1000);
}

/* ─── TOPBAR USER ─── */
export function setTopbarUser(user) {
  const avatar = document.getElementById('topbarAvatar');
  const name   = document.getElementById('topbarName');
  const role   = document.getElementById('topbarRole');
  if (avatar) avatar.textContent = (user.name || '?')[0].toUpperCase();
  if (name)   name.textContent   = user.name;
  if (role)   role.textContent   = user.role.toUpperCase();
}

/* ─── VAL / SET helpers ─── */
export function val(id)      { return document.getElementById(id)?.value ?? ''; }
export function setVal(id,v) { const el = document.getElementById(id); if(el) el.value = v; }
export function setText(id,v){ const el = document.getElementById(id); if(el) el.textContent = v; }
export function show(id)     { document.getElementById(id)?.classList.remove('hidden'); }
export function hide(id)     { document.getElementById(id)?.classList.add('hidden'); }
export function toggle(id, force) { document.getElementById(id)?.classList.toggle('hidden', force !== undefined ? !force : undefined); }

/* ─── COLOR THEME TEMPLATES & CONTROLS ─── */
export const COLOR_THEMES = [
  {
    id: 'sky',
    name: 'Classic Sky',
    tag: 'Clean & Professional',
    accent: '#0284c7',
    accent2: '#2563eb',
    previewBg: '#0f172a',
  },
  {
    id: 'emerald',
    name: 'Emerald Sage',
    tag: 'Focused & Balanced',
    accent: '#059669',
    accent2: '#0d9488',
    previewBg: '#064e3b',
  },
  {
    id: 'amethyst',
    name: 'Royal Amethyst',
    tag: 'Creative & Refined',
    accent: '#7c3aed',
    accent2: '#6366f1',
    previewBg: '#3b0764',
  },
  {
    id: 'amber',
    name: 'Sunset Amber',
    tag: 'Warm & Energetic',
    accent: '#d97706',
    accent2: '#ea580c',
    previewBg: '#78350f',
  },
  {
    id: 'rose',
    name: 'Rose Crimson',
    tag: 'Bold & Vibrant',
    accent: '#e11d48',
    accent2: '#db2777',
    previewBg: '#881337',
  },
  {
    id: 'titanium',
    name: 'Titanium Noir',
    tag: 'Architectural & Minimal',
    accent: '#475569',
    accent2: '#334155',
    previewBg: '#18181b',
  },
];

export function getColorTheme() {
  return document.body.getAttribute('data-color-theme') || localStorage.getItem('dtr_color_theme') || 'sky';
}

export function applyColorTheme(themeId, notify = false) {
  const match = COLOR_THEMES.find(t => t.id === themeId) || COLOR_THEMES[0];
  document.body.setAttribute('data-color-theme', match.id);
  localStorage.setItem('dtr_color_theme', match.id);

  // Update settings modal theme cards
  document.querySelectorAll('.theme-card').forEach(card => {
    const active = card.dataset.themeId === match.id;
    card.classList.toggle('active', active);
    const icon = card.querySelector('.theme-check-icon');
    if (icon) icon.textContent = active ? '✓' : '';
  });

  if (notify) {
    toast(`Switched to ${match.name} theme`, 'info');
  }
}

export function renderThemeTemplatesGrid() {
  const container = document.getElementById('themeTemplatesContainer');
  if (!container) return;
  const current = getColorTheme();
  container.innerHTML = COLOR_THEMES.map(t => {
    const active = t.id === current;
    return `
      <div class="theme-card ${active ? 'active' : ''}" data-theme-id="${t.id}" onclick="window.dtr.setColorTheme('${t.id}', true)">
        <div class="theme-card-top">
          <div class="theme-swatch-group">
            <span class="theme-swatch" style="background-color: ${t.accent};"></span>
            <span class="theme-swatch" style="background-color: ${t.accent2};"></span>
            <span class="theme-swatch" style="background-color: ${t.previewBg};"></span>
          </div>
          <span class="theme-check-icon">${active ? '✓' : ''}</span>
        </div>
        <div class="theme-card-name">${t.name}</div>
        <div class="theme-card-tag">${t.tag}</div>
      </div>
    `;
  }).join('');
}

