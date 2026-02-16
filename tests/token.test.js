import test from 'node:test';
import assert from 'node:assert/strict';
import * as pako from 'pako';

import { b64urlToBytes, hexToUtf8String } from '../src/internal/token.js';

function bytesToB64url(bytes) {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function utf8ToHex(str) {
  return Buffer.from(str, 'utf8').toString('hex');
}

test('b64urlToBytes round-trips gzip payload', () => {
  const jwt = 'header.payload.signature';
  const hex = utf8ToHex(jwt);
  const gz = pako.gzip(hex);
  const token = bytesToB64url(gz);

  const out = b64urlToBytes(token);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual(Buffer.from(out), Buffer.from(gz));
});

test('hexToUtf8String decodes valid hex and rejects invalid hex', () => {
  const jwt = 'a.b.c';
  const hex = utf8ToHex(jwt);
  assert.equal(hexToUtf8String(hex), jwt);

  assert.throws(() => hexToUtf8String(''), /non-empty/);
  assert.throws(() => hexToUtf8String('0'), /invalid hex length/);
  assert.throws(() => hexToUtf8String('zz'), /invalid hex characters/);
});

test('b64urlToBytes rejects invalid base64url', () => {
  assert.throws(() => b64urlToBytes(''), /non-empty/);
  assert.throws(() => b64urlToBytes('*not-base64url*'), /invalid base64url|invalid base64url length/);
});

test('b64urlToBytes enforces size limits', () => {
  assert.throws(() => b64urlToBytes('a'.repeat(64_001)), /token too large/);
});

test('hexToUtf8String enforces inflated size limit', () => {
  // 512_000 is the default limit in token.js; exceed it by 2 chars.
  assert.throws(() => hexToUtf8String('aa'.repeat(256_001)), /inflated token too large/);
});
