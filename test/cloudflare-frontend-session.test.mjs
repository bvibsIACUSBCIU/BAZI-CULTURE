import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('frontend restores account state from the signed session and sends protected requests without a wallet identity', () => {
  assert.match(appJs, /async function bootstrapAuthenticatedAccount\(\)/);
  assert.match(appJs, /fetchApi\('\/api\/auth\/me'\)/);
  assert.match(appJs, /fetchApi\('\/api\/preferences'/);
  assert.match(appJs, /credentials:\s*'same-origin'/);
  assert.doesNotMatch(appJs, /\/api\/(?:profile|session-history|quota)\?wallet=/);
  assert.doesNotMatch(appJs, /JSON\.stringify\(\{\s*wallet:\s*currentWallet/);
});

test('frontend clears wallet-scoped state after a session failure or account change', () => {
  assert.match(appJs, /async function clearAuthenticatedState\(\)/);
  assert.match(appJs, /res\.status === 401[\s\S]*?clearAuthenticatedState/);
  assert.match(appJs, /accountsChanged[\s\S]*?clearAuthenticatedState/);
});
