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
// Token decoding utilities used by the AgeGate browser integration.
//
// Why this exists:
// - The opener receives an opaque `token` via postMessage which is:
//   base64url(gzip(hex(jwt))).
// - This module centralizes parsing/validation and applies size limits so a
//   malicious or buggy popup cannot force excessive memory/CPU usage.
// - The code is written to run in both browsers and Node (for tests).

const DEFAULT_LIMITS = Object.freeze({
  // Bound the worst-case memory use for incoming tokens.
  maxTokenB64urlChars: 64_000,
  maxGzipBytes: 64_000,
  maxInflatedChars: 512_000,
});

/**
 * @param {unknown} err
 * @returns {string}
 */
function toErrorMessage(err) {
  if (err instanceof Error && typeof err.message === 'string') return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  if (typeof b64 !== 'string') throw new Error('base64 must be a string');

  // Prefer Web APIs in the browser, Buffer in Node.
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** @type {any} */
  // Casting is deliberate: Buffer is a Node-only global which is absent from DOM lib typings.
  const NodeBuffer = /** @type {any} */ (globalThis).Buffer;
  if (typeof NodeBuffer !== 'undefined') {
    return Uint8Array.from(NodeBuffer.from(b64, 'base64'));
  }

  throw new Error('no base64 decoder available');
}

/**
 * Convert a base64url string into bytes with validation and size limits.
 * @param {string} b64url
 * @param {Partial<typeof DEFAULT_LIMITS>=} limits
 * @returns {Uint8Array}
 */
export function b64urlToBytes(b64url, limits = undefined) {
  const lim = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  if (typeof b64url !== 'string') throw new Error('token must be a string');
  if (b64url.length === 0) throw new Error('token must be non-empty');
  if (b64url.length > lim.maxTokenB64urlChars) throw new Error('token too large');

  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad !== 0) throw new Error('invalid base64url length');

  let out;
  try {
    out = base64ToBytes(b64);
  } catch (err) {
    throw new Error(`invalid base64url: ${toErrorMessage(err)}`);
  }

  if (out.length > lim.maxGzipBytes) throw new Error('compressed token too large');
  return out;
}

/**
 * Decode a hex-encoded string into a UTF-8 string with validation and limits.
 * The token format uses hex of the raw JWT string (ASCII/UTF-8).
 * @param {string} hex
 * @param {Partial<typeof DEFAULT_LIMITS>=} limits
 * @returns {string}
 */
export function hexToUtf8String(hex, limits = undefined) {
  const lim = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  if (typeof hex !== 'string') throw new Error('hex must be a string');
  if (hex.length === 0) throw new Error('hex must be non-empty');
  if (hex.length % 2 !== 0) throw new Error('invalid hex length');
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('invalid hex characters');
  if (hex.length > lim.maxInflatedChars) throw new Error('inflated token too large');

  // Fast path for Node; still works in modern browsers without Buffer.
  /** @type {any} */
  // Casting is deliberate: Buffer is a Node-only global which is absent from DOM lib typings.
  const NodeBuffer = /** @type {any} */ (globalThis).Buffer;
  if (typeof NodeBuffer !== 'undefined') {
    return NodeBuffer.from(hex, 'hex').toString('utf8');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}
