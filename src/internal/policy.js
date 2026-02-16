/*
 * AgeCheck AgeGate
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
// Policy/validation helpers for the AgeGate browser integration.
//
// Why this exists:
// - Keep `src/agegate.js` readable (browser glue + flow control).
// - Centralize bounds checks so they are consistent and testable in Node.
// - Avoid leaking relying-party origin to AgeCheck: these helpers only govern
//   client-side behavior on the relying party page.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_LIMITS = Object.freeze({
  maxSessionLen: 64,
  maxIncludeItems: 8,
  maxIncludeItemLen: 32,
});

/**
 * @param {string} v
 * @returns {boolean}
 */
export function isUuid(v) {
  return UUID_RE.test(v);
}

/**
 * Prefer crypto.randomUUID when available; otherwise generate RFC4122 v4 bytes.
 * @returns {string}
 */
export function randomUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    // Extremely old/unsupported environment; fall back to Math.random with a
    // clear error string rather than silently generating weak IDs.
    throw new Error('crypto.getRandomValues is required for UUID generation');
  }

  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  // RFC4122 version/variant bits.
  // `noUncheckedIndexedAccess` makes typed-array indexing `number | undefined`;
  // we know these indexes exist for a 16-byte UUID buffer, so we defensively
  // coerce via `?? 0`.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param {unknown} v
 * @param {Partial<typeof DEFAULT_LIMITS>=} limits
 * @returns {string}
 */
export function normalizeSession(v, limits = undefined) {
  const lim = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  if (typeof v !== 'string') return randomUuid();
  const s = v.trim();
  if (s.length === 0 || s.length > lim.maxSessionLen) return randomUuid();
  if (!isUuid(s)) return randomUuid();
  return s;
}

/**
 * @param {unknown} v
 * @param {Partial<typeof DEFAULT_LIMITS>=} limits
 * @returns {string[] | undefined}
 */
export function sanitizeInclude(v, limits = undefined) {
  const lim = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  if (!Array.isArray(v)) return undefined;
  /** @type {string[]} */
  const out = [];
  for (const item of v) {
    if (out.length >= lim.maxIncludeItems) break;
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s.length === 0 || s.length > lim.maxIncludeItemLen) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * backendVerifyUrl policy:
 * - Default: same-origin only (relative URLs like `/api/verify-age` are safest).
 * - Cross-origin: allowed only with explicit opt-in + allowlist.
 *
 * @param {string} raw
 * @param {{
 *   pageHref: string,
 *   pageOrigin: string,
 *   allowCrossOrigin: boolean,
 *   allowedOrigins?: string[],
 * }} opts
 * @returns {string}
 */
export function resolveBackendVerifyUrl(raw, opts) {
  if (!opts || typeof opts !== 'object') throw new Error('missing url policy options');
  const { pageHref, pageOrigin, allowCrossOrigin, allowedOrigins } = opts;
  if (typeof pageHref !== 'string' || pageHref.length === 0) throw new Error('pageHref required');
  if (typeof pageOrigin !== 'string' || pageOrigin.length === 0) throw new Error('pageOrigin required');

  /** @type {URL} */
  let u;
  try {
    // Relative URLs resolve against the relying party origin.
    u = new URL(raw, pageHref);
  } catch {
    throw new Error('backendVerifyUrl must be a valid URL or relative path');
  }

  const sameOrigin = u.origin === pageOrigin;
  if (!sameOrigin) {
    if (!allowCrossOrigin) {
      throw new Error(
        'backendVerifyUrl must be same-origin by default; set backendVerifyAllowCrossOrigin=true and backendVerifyAllowedOrigins=[...] to enable cross-origin',
      );
    }
    const allow = Array.isArray(allowedOrigins)
      ? allowedOrigins.some((o) => {
          if (typeof o !== 'string') return false;
          try {
            return new URL(o).origin === u.origin;
          } catch {
            return false;
          }
        })
      : false;
    if (!allow) throw new Error('backendVerifyUrl origin not in backendVerifyAllowedOrigins');
  }

  // Enforce HTTPS for cross-origin; for same-origin we allow http for local dev.
  if (!sameOrigin && u.protocol !== 'https:') throw new Error('backendVerifyUrl must be https');
  if (sameOrigin && u.protocol !== 'https:' && u.protocol !== new URL(pageHref).protocol) {
    throw new Error('backendVerifyUrl protocol mismatch');
  }

  return u.toString();
}
