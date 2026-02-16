// @ts-nocheck
/*
 * AgeCheck Easy AgeGate
 * Copyright (c) 2026 ReallyMe LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Third-party notices: see THIRD_PARTY_NOTICES.txt (this project bundles pako).
 */
//
// This file is a convenience UI wrapper intended for quick integrations and demos.
// The production-critical flow is implemented in `src/agegate.js`, which is fully
// type-checked (via `checkJs`) and tested. This file remains intentionally
// flexible and DOM-heavy; if it becomes production-critical, we should migrate it
// to TypeScript and remove `@ts-nocheck`.
//
// Design note:
// Historically this file duplicated the popup flow + token decoding. That is
// the wrong architecture for security-sensitive code. This wrapper now delegates
// the entire verification flow to `launchAgeGate()` and only provides UI.
import { launchAgeGate } from './agegate.js';

const DEFAULTS = {
  // These are forwarded to `launchAgeGate` (see `src/agegate.js`).
  include: ['session'],
  backendVerifyUrl: null,
  backendVerifyAllowCrossOrigin: false,
  backendVerifyAllowedOrigins: [],
  backendExtraHeaders: {},
  requireNoReferrer: true,
  allowFullPageFallback: true,

  referrerCheck: true,
  ui: {
    mount: null,                  // selector to mount inline button; if null, modal is used
    autoOpen: true,               // open modal on page load
    buttonText: 'Verify Now',
    cancelButtonText: 'Cancel',
    brand: {
      title: 'Age Verification',
      // if no logoUrl, we render a fallback badge automatically.
      logoUrl: null,
      logoWidthPx: 30,
      logoHeightPx: 30,
      showBadge: true,
      badgeText: '18+',
    },
    copy: {
      subtitleText: 'Verify your age to continue.',
      privacyNoteText: 'No referrer is sent to the issuer.',
      waitingText: 'Waiting for authenticator…',
      successText: 'Verification complete.',
      errorPrefixText: 'Verification failed',
    },
    layout: {
      maxWidthPx: 420,
      borderRadiusPx: 20,
      zIndex: 2147483647,
      cardPaddingPx: 22,
    },
    theme: {
      primary: '#6b46c1',         // main brand color
      bg: '#ffffff',              // card background
      text: '#111827',            // text
      backdrop: 'rgba(0,0,0,.35)' // overlay
    }
  },

  // Optional callbacks in addition to UI updates.
  onSuccess: null,
  onFailure: null,
};

/* -------------------- utils -------------------- */
function asPositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function ensureSessionInclude(input) {
  const base = Array.isArray(input) ? input : [];
  const out = [];
  for (const v of base) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  if (!out.includes('session')) out.unshift('session');
  return out;
}

function css(theme, layout, brand) {
  const maxWidthPx = asPositiveNumber(layout.maxWidthPx, DEFAULTS.ui.layout.maxWidthPx);
  const borderRadiusPx = asPositiveNumber(layout.borderRadiusPx, DEFAULTS.ui.layout.borderRadiusPx);
  const zIndex = asPositiveNumber(layout.zIndex, DEFAULTS.ui.layout.zIndex);
  const cardPaddingPx = asPositiveNumber(layout.cardPaddingPx, DEFAULTS.ui.layout.cardPaddingPx);
  const logoWidthPx = clampNumber(brand.logoWidthPx, 16, 128, DEFAULTS.ui.brand.logoWidthPx);
  const logoHeightPx = clampNumber(brand.logoHeightPx, 16, 128, DEFAULTS.ui.brand.logoHeightPx);

  return `
  :root {
    --ag-primary:${theme.primary};
    --ag-bg:${theme.bg};
    --ag-text:${theme.text};
    --ag-backdrop:${theme.backdrop};
    --ag-maxw:${maxWidthPx}px;
    --ag-radius:${borderRadiusPx}px;
    --ag-z:${zIndex};
    --ag-pad:${cardPaddingPx}px;
    --ag-logo-w:${logoWidthPx}px;
    --ag-logo-h:${logoHeightPx}px;
  }
  .ag-backdrop{
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:var(--ag-backdrop); backdrop-filter:saturate(1.2) blur(4px);
    z-index: var(--ag-z); opacity:0; animation:ag-fade .16s ease-out forwards;
    padding: 10px;
  }
  @media (prefers-reduced-motion: reduce){
    .ag-backdrop{ animation:none; opacity:1; }
  }
  .ag-card{
    width:min(96vw, var(--ag-maxw)); color:var(--ag-text); background:var(--ag-bg);
    border-radius:var(--ag-radius); box-shadow:0 20px 45px rgba(0,0,0,.18);
    padding:var(--ag-pad); transform:translateY(8px) scale(.98);
    opacity:0; animation:ag-pop .18s cubic-bezier(.16,1,.3,1) .03s forwards;
  }
  @media (max-width: 480px) {
    .ag-card{
      width: min(96vw, var(--ag-maxw));
      padding: max(16px, calc(var(--ag-pad) - 4px));
      border-radius: max(12px, calc(var(--ag-radius) - 6px));
    }
  }
  .ag-head{ display:flex; align-items:center; gap:12px; margin-bottom:4px;}
  .ag-logo{ width:var(--ag-logo-w); height:var(--ag-logo-h); border-radius:8px; object-fit:cover; box-shadow:0 2px 6px rgba(0,0,0,.15); }
  .ag-badge{ width:var(--ag-logo-w); height:var(--ag-logo-h); border-radius:8px; display:inline-grid; place-items:center; 
    background:var(--ag-primary); color:#fff; font-weight:800; font-size:.9rem; letter-spacing:.5px; }
  .ag-title{ font-weight:800; font-size:1.05rem; }
  .ag-sub{ font-size:.92rem; color:#4b5563; margin:4px 0 10px; }
  .ag-note{ font-size:.78rem; color:#6b7280; margin-top:8px; }
  .ag-status{ font-size:.85rem; margin-top:10px; word-break:break-word; color:#374151; }
  .ag-actions{ margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; }
  .ag-btn{
    appearance:none; border:0; border-radius:12px; padding:.78rem 1.05rem; font-weight:700; cursor:pointer;
    background:var(--ag-primary); color:white; box-shadow: 0 8px 22px rgba(107,70,193,.35);
    transition: transform .06s ease, box-shadow .15s ease, filter .15s ease;
  }
  .ag-btn:hover{ filter:brightness(1.03); box-shadow:0 12px 26px rgba(107,70,193,.45); }
  .ag-btn:active{ transform:translateY(1px); box-shadow:0 6px 18px rgba(107,70,193,.30); }
  .ag-btn.secondary{
    background:#eef2ff; color:#111827; box-shadow:none;
  }
  .ag-inline-btn{
    appearance:none; border:0; border-radius:12px; padding:.72rem 1rem; font-weight:700; cursor:pointer;
    background:var(--ag-primary); color:white; box-shadow:0 8px 22px rgba(0,0,0,.12);
    transition: transform .06s ease, box-shadow .15s ease, filter .15s ease;
  }
  .ag-inline-btn:hover{ filter:brightness(1.03); box-shadow:0 12px 26px rgba(0,0,0,.18); }
  .ag-inline-btn:active{ transform:translateY(1px); box-shadow:0 6px 18px rgba(0,0,0,.12); }

  @keyframes ag-fade { to{ opacity:1; } }
  @keyframes ag-pop { to{ opacity:1; transform:translateY(0) scale(1); } }
  `;
}
function ensureStyle(theme, layout, brand) {
  // Always rewrite so repeated AgeGate.init() calls can update theme/layout.
  // Hostmasters often tweak styling at runtime in CMS builders.
  let s = document.getElementById('ag-style');
  if (!s) {
    s = document.createElement('style');
    s.id = 'ag-style';
    document.head.appendChild(s);
  }
  s.textContent = css(theme, layout, brand);
}
function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function safeText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
function safeLogoUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed, window.location.href);
    const protocol = u.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
function warnReferrer() {
  const meta = document.querySelector('meta[name="referrer"]');
  if (!meta || meta.content.trim().toLowerCase() !== 'no-referrer') {
    console.warn('[agegate] Missing or incorrect: <meta name="referrer" content="no-referrer">');
  }
}

function normalizeConfig(config) {
  // deep-ish merge with defaults
  const cfg = JSON.parse(JSON.stringify(DEFAULTS));
  Object.assign(cfg, config ?? {});
  if (config?.ui) {
    cfg.ui = Object.assign({}, DEFAULTS.ui, config.ui);
    if (config.ui.brand) cfg.ui.brand = Object.assign({}, DEFAULTS.ui.brand, config.ui.brand);
    if (config.ui.theme) cfg.ui.theme = Object.assign({}, DEFAULTS.ui.theme, config.ui.theme);
    if (config.ui.copy) cfg.ui.copy = Object.assign({}, DEFAULTS.ui.copy, config.ui.copy);
    if (config.ui.layout) cfg.ui.layout = Object.assign({}, DEFAULTS.ui.layout, config.ui.layout);
  }

  // Enforce required include claim to avoid accidental flow breakage.
  cfg.include = ensureSessionInclude(cfg.include);
  cfg.ui.buttonText = safeText(cfg.ui.buttonText, DEFAULTS.ui.buttonText);
  cfg.ui.cancelButtonText = safeText(cfg.ui.cancelButtonText, DEFAULTS.ui.cancelButtonText);
  cfg.ui.brand.title = safeText(cfg.ui.brand.title, DEFAULTS.ui.brand.title);
  cfg.ui.brand.badgeText = safeText(cfg.ui.brand.badgeText, DEFAULTS.ui.brand.badgeText);
  cfg.ui.brand.logoUrl = safeLogoUrl(cfg.ui.brand.logoUrl);
  cfg.ui.brand.logoWidthPx = clampNumber(
    Number(cfg.ui.brand.logoWidthPx),
    16,
    128,
    DEFAULTS.ui.brand.logoWidthPx,
  );
  cfg.ui.brand.logoHeightPx = clampNumber(
    Number(cfg.ui.brand.logoHeightPx),
    16,
    128,
    DEFAULTS.ui.brand.logoHeightPx,
  );
  cfg.ui.copy.subtitleText = safeText(cfg.ui.copy.subtitleText, DEFAULTS.ui.copy.subtitleText);
  cfg.ui.copy.privacyNoteText = safeText(cfg.ui.copy.privacyNoteText, DEFAULTS.ui.copy.privacyNoteText);
  cfg.ui.copy.waitingText = safeText(cfg.ui.copy.waitingText, DEFAULTS.ui.copy.waitingText);
  cfg.ui.copy.successText = safeText(cfg.ui.copy.successText, DEFAULTS.ui.copy.successText);
  cfg.ui.copy.errorPrefixText = safeText(cfg.ui.copy.errorPrefixText, DEFAULTS.ui.copy.errorPrefixText);

  cfg.ui.layout.maxWidthPx = asPositiveNumber(cfg.ui.layout.maxWidthPx, DEFAULTS.ui.layout.maxWidthPx);
  cfg.ui.layout.borderRadiusPx = asPositiveNumber(cfg.ui.layout.borderRadiusPx, DEFAULTS.ui.layout.borderRadiusPx);
  cfg.ui.layout.zIndex = asPositiveNumber(cfg.ui.layout.zIndex, DEFAULTS.ui.layout.zIndex);
  cfg.ui.layout.cardPaddingPx = asPositiveNumber(cfg.ui.layout.cardPaddingPx, DEFAULTS.ui.layout.cardPaddingPx);
  return cfg;
}

// Popup opening is handled by `launchAgeGate()`.
function renderInlineButton(cfg, onClick) {
  const mount = cfg.ui.mount && document.querySelector(cfg.ui.mount);
  if (!mount) return null;
  const btn = document.createElement('button');
  btn.className = 'ag-inline-btn';
  btn.textContent = cfg.ui.buttonText;
  btn.style.setProperty('--ag-primary', cfg.ui.theme.primary);
  btn.onclick = onClick;
  mount.appendChild(btn);
  return btn;
}
function renderBadgeOrLogo(brand) {
  if (brand.logoUrl) {
    return `<img class="ag-logo" src="${htmlEscape(brand.logoUrl)}" alt="brand">`;
  }
  if (brand.showBadge !== false) {
    return `<div class="ag-badge" aria-hidden="true">${htmlEscape(brand.badgeText)}</div>`;
  }
  return '';
}
function renderModal(cfg, handlers) {
  const root = document.createElement('div');
  root.className = 'ag-backdrop';
  root.innerHTML = `
    <div class="ag-card">
      <div class="ag-head">
        ${renderBadgeOrLogo(cfg.ui.brand)}
        <div class="ag-title">${htmlEscape(cfg.ui.brand.title)}</div>
      </div>
      <div class="ag-sub">${htmlEscape(cfg.ui.copy.subtitleText)}</div>
      <div class="ag-note">${htmlEscape(cfg.ui.copy.privacyNoteText)}</div>
      <div class="ag-status" id="ag-status"></div>
      <div class="ag-actions">
        <button class="ag-btn" id="ag-open">${htmlEscape(cfg.ui.buttonText)}</button>
        <button class="ag-btn secondary" id="ag-cancel">${htmlEscape(cfg.ui.cancelButtonText)}</button>
      </div>
    </div>
  `;
  root.querySelector('#ag-open').onclick = handlers.onPrimary;
  root.querySelector('#ag-cancel').onclick = () => { root.remove(); handlers.onCancel?.(); };
  document.body.appendChild(root);
  return {
    el: root,
    setStatus: (t) => { const s = root.querySelector('#ag-status'); if (s) s.textContent = t; },
    close: () => root.remove(),
  };
}

/* -------------------- public API -------------------- */
export const AgeGate = {
  init(config = {}) {
    const cfg = normalizeConfig(config);

    ensureStyle(cfg.ui.theme, cfg.ui.layout, cfg.ui.brand);
    if (cfg.referrerCheck) warnReferrer();

    const launch = async () => {
      const modal = renderModal(cfg, {
        onPrimary: () => {
          modal.setStatus(cfg.ui.copy.waitingText);
          // Delegate the security-critical flow to `launchAgeGate`.
          try {
            launchAgeGate({
              include: cfg.include,
              backendVerifyUrl: cfg.backendVerifyUrl,
              backendVerifyAllowCrossOrigin: cfg.backendVerifyAllowCrossOrigin,
              backendVerifyAllowedOrigins: cfg.backendVerifyAllowedOrigins,
              backendExtraHeaders: cfg.backendExtraHeaders,
              requireNoReferrer: cfg.requireNoReferrer,
              allowFullPageFallback: cfg.allowFullPageFallback,
              onSuccess: (jwt, payload, backendResult) => {
                modal.setStatus(cfg.ui.copy.successText);
                // Hostmasters usually want seamless completion with no lingering overlay.
                // Close immediately after success and return the result via callback.
                modal.close();

                try {
                  cfg.onSuccess?.(jwt, payload, backendResult);
                } catch {
                  // ignore
                }
              },
              onFailure: (err) => {
                modal.setStatus(`${cfg.ui.copy.errorPrefixText}: ${err?.message || err}`);
                try {
                  cfg.onFailure?.(err);
                } catch {
                  // ignore
                }
              },
            });
          } catch (err) {
            modal.setStatus(`${cfg.ui.copy.errorPrefixText}: ${err?.message || err}`);
          }
        },
        onCancel: () => {}
      });
    };

    // inline button (optional)
    const btn = renderInlineButton(cfg, launch);

    // auto open modal on page load (unless disabled)
    if (!cfg.ui.mount && cfg.ui.autoOpen !== false) {
      // allow DOM to settle
      queueMicrotask(() => launch());
    }

    this.open = launch;
    this.config = cfg;
    return { open: launch, button: btn };
  },

  open() {
    throw new Error('Call AgeGate.init() first');
  },
};
