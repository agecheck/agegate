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
// This file is intended to be bundled and served via CDN for integration into
// third-party relying parties. It is deliberately defensive:
// - It bounds token decoding work to prevent memory/CPU exhaustion.
// - It verifies message origin/source/session before processing.
// - It can optionally call a relying-party backend for server-side validation.
import * as pako from 'pako';
import { b64urlToBytes, hexToUtf8String } from './internal/token.js';
import { normalizeSession, resolveBackendVerifyUrl, sanitizeInclude } from './internal/policy.js';

/**
 * @typedef {{
 *   include: string[] | undefined,
 *   agegateway_session: string,
 *   authenticationResponse: unknown,
 * }} AgeGatePayload
 */

/**
 * @typedef {(jwt: string, payload: AgeGatePayload, backendResult: unknown) => void} AgeGateSuccessHandler
 */

/**
 * @typedef {(err: Error) => void} AgeGateFailureHandler
 */

/**
 * @typedef {{
 *   onSuccess?: AgeGateSuccessHandler,
 *   onFailure?: AgeGateFailureHandler,
 *   include?: string[],
 *   session?: string,
 *   backendVerifyUrl?: string,
 *   backendVerifyAllowCrossOrigin?: boolean,
 *   backendVerifyAllowedOrigins?: string[],
 *   backendExtraHeaders?: Record<string, string>,
 *   timeoutMs?: number,
 *   requireNoReferrer?: boolean,
 *   allowFullPageFallback?: boolean,
 * }} AgeGateConfig
 */

const CHILD_ORIGIN = 'https://agecheck.me';
const VERIFY_PAGE = 'verify.html';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

function isNoReferrerMetaPresent() {
  /** @type {HTMLMetaElement|null} */
  const meta = document.querySelector('meta[name="referrer"]');
  return !!meta && meta.content.trim().toLowerCase() === 'no-referrer';
}

/**
 * @param {unknown} err
 * @param {string=} context
 * @returns {Error}
 */
function asError(err, context) {
  if (err instanceof Error) return err;
  const msg = (() => {
    try {
      return String(err);
    } catch {
      return 'unknown error';
    }
  })();
  return new Error(context ? `${context}: ${msg}` : msg);
}

/**
 * @param {((...args: any[]) => void) | undefined} cb
 * @param {any[]} args
 */
function safeCallback(cb, args) {
  try {
    cb?.(...args);
  } catch (err) {
    // Never allow callback failures to break cleanup paths.
    console.error('[agegate] callback error', err);
  }
}

/**
 * @param {string} session
 * @param {string[] | undefined} include
 * @returns {string}
 */
function makeVerifyUrl(session, include) {
  const qs = new URLSearchParams();
  qs.set('session', session);
  qs.set('autostart', '1');
  const inc = sanitizeInclude(include);
  if (Array.isArray(inc) && inc.length > 0) {
    qs.set(
      'include',
      inc.join(','),
    );
  }
  return `${CHILD_ORIGIN}/${VERIFY_PAGE}?${qs.toString()}`;
}

/**
 * @param {string} backendVerifyUrl
 * @param {boolean} backendVerifyAllowCrossOrigin
 * @param {string[] | undefined} backendVerifyAllowedOrigins
 * @param {Record<string, string> | undefined} backendExtraHeaders
 * @param {string} jwt
 * @param {AgeGatePayload} payload
 * @param {AbortSignal} signal
 * @returns {Promise<unknown>}
 */
async function verifyWithBackend(
  backendVerifyUrl,
  backendVerifyAllowCrossOrigin,
  backendVerifyAllowedOrigins,
  backendExtraHeaders,
  jwt,
  payload,
  signal,
) {
  const allowedOrigins = Array.isArray(backendVerifyAllowedOrigins) ? backendVerifyAllowedOrigins : [];
  const resolved = resolveBackendVerifyUrl(backendVerifyUrl, {
    pageHref: window.location.href,
    pageOrigin: window.location.origin,
    allowCrossOrigin: backendVerifyAllowCrossOrigin,
    allowedOrigins,
  });

  const res = await fetch(resolved, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(backendExtraHeaders ?? {}) },
    body: JSON.stringify({ jwt, ...payload }),
    credentials: 'omit',
    mode: 'cors',
    cache: 'no-store',
    signal,
  });

  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    throw new Error(`backend verification failed: ${res.status}${text ? ` ${text}` : ''}`);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Launch the age gate flow.
 *
 * The popup posts a compressed token back to the opener; this function verifies
 * origin/source/session, decodes the token, and optionally calls a relying
 * party backend for server-side validation/auditing.
 *
 * @param {AgeGateConfig} [config]
 */
export function launchAgeGate(config = {}) {
  const {
    onSuccess,
    onFailure,
    include: includeRaw,
    session,
    backendVerifyUrl,
    backendVerifyAllowCrossOrigin = false,
    backendVerifyAllowedOrigins = [],
    backendExtraHeaders = {},
    // Backward-compatible defaults:
    // - Historically we only warned if the integrator forgot `referrer=no-referrer`.
    // - Historically we did not time out or call failure on popup close.
    timeoutMs = null,
    requireNoReferrer = false,
    allowFullPageFallback = true,
  } = config;

  if (!isNoReferrerMetaPresent()) {
    if (requireNoReferrer) {
      safeCallback(onFailure, [new Error('Missing required meta referrer=no-referrer')]);
      return;
    }
    console.warn('[agegate] Missing or incorrect: <meta name="referrer" content="no-referrer">');
  }

  const agegateway_session = normalizeSession(session);
  const include = sanitizeInclude(includeRaw);

  const url = makeVerifyUrl(agegateway_session, include);

  const w = 400;
  const h = 550;
  const lft = (screen.width - w) / 2;
  const top = (screen.height - h) / 2;
  const feat = `width=${w},height=${h},left=${lft},top=${top}`;

  /** @type {Window|null} */
  let popup = null;
  try {
    popup = window.open(url, 'age-verify', feat);
  } catch {
    popup = null;
  }

  if (!popup) {
    if (allowFullPageFallback) {
      window.location.assign(url);
    } else {
      safeCallback(onFailure, [new Error('Popup blocked and fallback disabled')]);
    }
    return;
  }

  let done = false;
  let processing = false;
  const ac = new AbortController();

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollId = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeoutId = null;

  const cleanup = () => {
    window.removeEventListener('message', handler);
    if (pollId) clearInterval(pollId);
    if (timeoutId) clearTimeout(timeoutId);
  };

  /** @param {unknown} err */
  const finishFailure = (err) => {
    if (done) return;
    done = true;
    try {
      ac.abort();
    } catch {
      // ignore
    }
    cleanup();
    try {
      popup?.close();
    } catch {
      // ignore
    }
    safeCallback(onFailure, [asError(err, 'agegate failure')]);
  };

  /**
   * @param {string} jwt
   * @param {AgeGatePayload} payload
   * @param {unknown} backendResult
   */
  const finishSuccess = (jwt, payload, backendResult) => {
    if (done) return;
    done = true;
    try {
      ac.abort();
    } catch {
      // ignore
    }
    cleanup();
    try {
      popup?.close();
    } catch {
      // ignore
    }
    // Backward compatible: integrators expecting (jwt, payload) simply ignore the third argument.
    safeCallback(onSuccess, [jwt, payload, backendResult]);
  };

  /** @param {MessageEvent} e */
  const handler = async (e) => {
    if (done || processing) return;
    if (e.origin !== CHILD_ORIGIN) return;
    if (e.source !== popup) return;
    if (!e.data || typeof e.data !== 'object') return;

    // Defensive unpacking: treat external message data as untrusted.
    const token = e.data.token;
    const msgSession = e.data.session;
    const authenticationResponse = e.data.authenticationResponse;

    if (msgSession !== agegateway_session) return;
    if (typeof token !== 'string' || token.length === 0) return;
    if (!authenticationResponse || typeof authenticationResponse !== 'object') return;

    processing = true;
    try {
      const gz = b64urlToBytes(token);
      const hex = pako.ungzip(gz, { to: 'string' });
      if (typeof hex !== 'string') throw new Error('invalid token payload');
      const jwt = hexToUtf8String(hex);
      if (typeof jwt !== 'string' || jwt.length === 0) throw new Error('invalid jwt');

      const payload = {
        include,
        agegateway_session,
        authenticationResponse,
      };

      if (typeof backendVerifyUrl === 'string' && backendVerifyUrl.length > 0) {
        const backendResult = await verifyWithBackend(
          backendVerifyUrl,
          backendVerifyAllowCrossOrigin,
          backendVerifyAllowedOrigins,
          backendExtraHeaders,
          jwt,
          payload,
          ac.signal,
        );
        finishSuccess(jwt, payload, backendResult);
      } else {
        finishSuccess(jwt, payload, null);
      }
    } catch (err) {
      finishFailure(err);
    } finally {
      processing = false;
    }
  };

  window.addEventListener('message', handler);

  pollId = setInterval(() => {
    if (popup?.closed) {
      // Backward compatible behavior: clean up without surfacing an error.
      try {
        ac.abort();
      } catch {
        // ignore
      }
      cleanup();
    }
  }, 1000);

  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      finishFailure(new Error('Timed out waiting for age verification'));
    }, timeoutMs);
  }
}
