import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isUuid,
  normalizeSession,
  resolveBackendVerifyUrl,
  sanitizeInclude,
} from '../src/internal/policy.js';

test('isUuid recognizes RFC4122-ish UUIDs', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuid('not-a-uuid'), false);
});

test('normalizeSession returns the input when it is a UUID', () => {
  const s = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(normalizeSession(s), s);
});

test('normalizeSession returns a UUID for invalid inputs', () => {
  const out1 = normalizeSession('');
  assert.equal(isUuid(out1), true);
  const out2 = normalizeSession('not-a-uuid');
  assert.equal(isUuid(out2), true);
});

test('sanitizeInclude trims, de-dupes, and bounds', () => {
  const out = sanitizeInclude(['  loa  ', 'loa', '', 'x'.repeat(100), 'session', 123]);
  assert.deepEqual(out, ['loa', 'session']);
});

test('resolveBackendVerifyUrl allows same-origin relative URLs by default', () => {
  const u = resolveBackendVerifyUrl('/api/verify', {
    pageHref: 'https://rp.example/path',
    pageOrigin: 'https://rp.example',
    allowCrossOrigin: false,
    allowedOrigins: [],
  });
  assert.equal(u, 'https://rp.example/api/verify');
});

test('resolveBackendVerifyUrl rejects cross-origin unless explicitly opted-in + allowlisted', () => {
  assert.throws(
    () =>
      resolveBackendVerifyUrl('https://api.example/verify', {
        pageHref: 'https://rp.example/path',
        pageOrigin: 'https://rp.example',
        allowCrossOrigin: false,
        allowedOrigins: [],
      }),
    /same-origin by default/,
  );

  assert.throws(
    () =>
      resolveBackendVerifyUrl('https://api.example/verify', {
        pageHref: 'https://rp.example/path',
        pageOrigin: 'https://rp.example',
        allowCrossOrigin: true,
        allowedOrigins: ['https://other.example'],
      }),
    /not in backendVerifyAllowedOrigins/,
  );

  const ok = resolveBackendVerifyUrl('https://api.example/verify', {
    pageHref: 'https://rp.example/path',
    pageOrigin: 'https://rp.example',
    allowCrossOrigin: true,
    allowedOrigins: ['https://api.example'],
  });
  assert.equal(ok, 'https://api.example/verify');
});

test('resolveBackendVerifyUrl requires https for cross-origin', () => {
  assert.throws(
    () =>
      resolveBackendVerifyUrl('http://api.example/verify', {
        pageHref: 'https://rp.example/path',
        pageOrigin: 'https://rp.example',
        allowCrossOrigin: true,
        allowedOrigins: ['http://api.example'],
      }),
    /must be https/,
  );
});

