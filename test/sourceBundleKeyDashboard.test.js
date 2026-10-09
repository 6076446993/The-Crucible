'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, authorized, serve } = require('../src/sourceBundleKeyDashboard');

test('dashboard exposes custody status without accepting or printing secrets', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'source-bundle-key-dashboard.html'), 'utf8');
  assert.match(html, /R8 excluded/);
  assert.match(html, /Refresh validation/);
  assert.doesNotMatch(html, /CRUCIBLE_SOURCE_BUNDLE_KEY\s*=/);
  assert.equal(typeof status().raw.ok, 'boolean');
  assert.equal(typeof status().vetted.ok, 'boolean');
  assert.equal(typeof status().runner.ok, 'boolean');
  assert.equal(status().runner.integration, 'nexus-coding-gateway');
});

test('dashboard authentication fails closed and compares the password safely', () => {
  assert.equal(authorized({ headers: {} }, 'operator', 'secret'), false);
  assert.equal(authorized({ headers: { authorization: `Basic ${Buffer.from('operator:secret').toString('base64')}` } }, 'operator', 'secret'), true);
  assert.equal(authorized({ headers: { authorization: `Basic ${Buffer.from('operator:wrong').toString('base64')}` } }, 'operator', 'secret'), false);
  assert.throws(() => serve(0, { username: 'operator' }), /PASSWORD is required/);
});
