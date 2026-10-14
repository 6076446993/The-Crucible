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

test('hosted R8 publication uses current custody, shared ownership and rollback-safe publisher', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/r8-executable-canary-publisher.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /self-hosted|CRUCIBLE_R8_SOURCE_ROOT/);
  assert.match(workflow, /group: bounded-raw-custody-publisher-development/);
  assert.match(workflow, /node src\/rawCustodyPublisher\.js publish-ciphertext/);
  assert.match(workflow, /--prior-manifest-sha256/);
  assert.match(workflow, /ls-remote origin refs\/heads\/main/);
  assert.match(workflow, /node src\/hostedSourceBundle\.js verify[\s\S]*isolated-restore/);
  assert.match(workflow, /pypa\/distlib\/[a-f0-9]{40}\/distlib\/w64\.exe/);
  assert.doesNotMatch(workflow, /Crucible-Vetted-Learning-State|push[^\n]*--force/);
});

test('legacy R8 publication fails closed and preserves all prior ciphertext', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-r8-publisher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const incoming = path.join(root, 'incoming'); const state = path.join(root, 'state');
  bundle(incoming, 'new ciphertext only'); bundle(state, 'old ciphertext only');
  fs.writeFileSync(path.join(state, 'README.md'), 'unrelated state metadata');
  assert.throws(() => publishCiphertext({ ciphertextRoot: incoming, stateRoot: state }), /legacy R8 publisher cannot preserve rollback custody/);
  assert.equal(fs.readFileSync(path.join(state, 'source-bundle.part-0000.enc'), 'utf8'), 'old ciphertext only');
  assert.equal(fs.readFileSync(path.join(state, 'README.md'), 'utf8'), 'unrelated state metadata');
});
