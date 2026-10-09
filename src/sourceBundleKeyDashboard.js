'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect, inspectRunner, RUNNER_INTEGRATION } = require('./sourceBundleKeyManager');

const dashboard = path.join(__dirname, '..', 'templates', 'source-bundle-key-dashboard.html');

function familyStatus(family) {
  try {
    const result = inspect(family);
    return { ok: true, keyId: result.currentKeyId, fingerprint: result.currentFingerprint, reason: 'Validated without exposing the secret.' };
  } catch (error) {
    let keyId = 'registry unavailable';
    try { keyId = require('../governingDocuments/source-bundle-key-registry.json').families[family === 'raw' ? 'raw-intake' : 'oversight-vetted'].current.id; } catch {}
    return { ok: false, keyId, fingerprint: '', reason: error.message };
  }
}

function runnerStatus() {
  try { return { ok: true, ...inspectRunner(process.env), reason: 'OIDC runner contract is available without exposing a credential.' }; }
  catch (error) { return { ok: false, integration: RUNNER_INTEGRATION.id, repository: RUNNER_INTEGRATION.repository, ref: RUNNER_INTEGRATION.ref, audience: RUNNER_INTEGRATION.audience, reason: error.message }; }
}

function status() { return { raw: familyStatus('raw'), vetted: familyStatus('vetted'), runner: runnerStatus() }; }

function authorized(request, username, password) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const separator = decoded.indexOf(':');
  if (separator < 1) return false;
  const suppliedUser = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);
  const userOk = suppliedUser === username;
  const expected = Buffer.from(password, 'utf8');
  const actual = Buffer.from(suppliedPassword, 'utf8');
  const passwordOk = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  return userOk && passwordOk;
}

function serve(port = Number(process.env.CRUCIBLE_KEY_DASHBOARD_PORT || 4321), options = {}) {
  const username = options.username || process.env.CRUCIBLE_KEY_DASHBOARD_USER || 'operator';
  const password = options.password || process.env.CRUCIBLE_KEY_DASHBOARD_PASSWORD;
  if (!password) throw new Error('CRUCIBLE_KEY_DASHBOARD_PASSWORD is required; refusing to start an unprotected dashboard.');
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!authorized(request, username, password)) {
      response.statusCode = 401; response.setHeader('WWW-Authenticate', 'Basic realm="Crucible key custody"'); response.end('Authentication required'); return;
    }
    if (request.method === 'GET' && request.url === '/api/status') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(status())); return;
    }
    if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fs.readFileSync(dashboard)); return;
    }
    response.statusCode = 404; response.end('Not found');
  });
  server.listen(port, '127.0.0.1', () => console.log(`Crucible key custody dashboard: http://127.0.0.1:${port}`));
  return server;
}

if (require.main === module) serve();
module.exports = { authorized, familyStatus, status, serve };
