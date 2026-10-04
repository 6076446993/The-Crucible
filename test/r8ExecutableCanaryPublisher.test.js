'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { publishCiphertext } = require('../src/r8ExecutableCanaryPublisher');

function bundle(root, text) {
  fs.mkdirSync(root, { recursive: true });
  const name = 'source-bundle.part-0000.enc';
  const bytes = Buffer.from(text);
  fs.writeFileSync(path.join(root, name), bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(root, 'encrypted-chunks.json'), JSON.stringify({ schemaVersion: 1, chunks: [{ name, bytes: bytes.length, sha256 }], encryptedBytes: bytes.length, encryptedSha256: sha256 }));
}

test('ciphertext publication replaces only manifest-declared encrypted chunks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-r8-publisher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const incoming = path.join(root, 'incoming'); const state = path.join(root, 'state');
  bundle(incoming, 'new ciphertext only'); bundle(state, 'old ciphertext only');
  fs.writeFileSync(path.join(state, 'README.md'), 'unrelated state metadata');
  const result = publishCiphertext({ ciphertextRoot: incoming, stateRoot: state });
  assert.equal(result.chunks, 1);
  assert.equal(fs.readFileSync(path.join(state, 'source-bundle.part-0000.enc'), 'utf8'), 'new ciphertext only');
  assert.equal(fs.readFileSync(path.join(state, 'README.md'), 'utf8'), 'unrelated state metadata');
});
