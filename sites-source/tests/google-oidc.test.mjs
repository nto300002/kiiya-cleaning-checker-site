import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlEncode,
  buildGoogleAuthUrl,
  clearJwksCache,
  pkceChallenge,
  verifyGoogleIdToken,
  verifyGoogleIdTokenWithAutoRefresh,
} from '../lib/google-oidc-core.mjs';
import {
  consumeOAuthState,
  createOAuthState,
  endSession,
  getActiveSession,
  IDLE_LIMIT_MS,
  resolveMappedUserId,
  revokeUserSessions,
  startSession,
  touchSession,
} from '../lib/idle-session-core.mjs';

async function generateRsaJwkPair(kid) {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, kid, use: 'sig', alg: 'RS256' },
  };
}

async function signJwt(header, payload, privateKey) {
  const enc = new TextEncoder();
  const h = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const p = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${base64UrlEncode(new Uint8Array(sig))}`;
}

function createFakeD1() {
  const sessions = new Map();
  const oauthStates = new Map();
  const identities = new Map();

  function makeStmt(sql, params = []) {
    const stmt = {
      bind(...args) { return makeStmt(sql, args); },
      async first() {
        if (sql.includes('FROM app_sessions WHERE token_hash = ?')) {
          return sessions.get(params[0]) ?? null;
        }
        if (sql.includes('FROM oauth_states')) {
          const row = oauthStates.get(params[0]);
          if (row && row.browser_token_hash === params[1]) return row;
          return null;
        }
        if (sql.includes('FROM staff_identities WHERE google_sub = ?')) {
          return identities.get(params[0]) ?? null;
        }
        throw new Error(`Unexpected first SQL: ${sql}`);
      },
      async run() {
        if (sql.startsWith('INSERT INTO app_sessions')) {
          const [token_hash, user_id, email, display_name, last_activity_ms, created_at_ms] = params;
          sessions.set(token_hash, { token_hash, user_id, email, display_name, last_activity_ms, created_at_ms });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE app_sessions SET last_activity_ms = ?')) {
          const [now, token_hash, threshold] = params;
          const row = sessions.get(token_hash);
          if (row && row.last_activity_ms > threshold) {
            row.last_activity_ms = now;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('DELETE FROM app_sessions WHERE token_hash = ?')) {
          const deleted = sessions.delete(params[0]) ? 1 : 0;
          return { meta: { changes: deleted } };
        }
        if (sql.startsWith('DELETE FROM app_sessions WHERE user_id = ?')) {
          let count = 0;
          for (const [k, v] of sessions.entries()) {
            if (v.user_id === params[0]) {
              sessions.delete(k);
              count++;
            }
          }
          return { meta: { changes: count } };
        }
        if (sql.startsWith('DELETE FROM oauth_states WHERE expires_at_ms <= ?')) {
          let count = 0;
          for (const [k, v] of oauthStates.entries()) {
            if (v.expires_at_ms <= params[0]) {
              oauthStates.delete(k);
              count++;
            }
          }
          return { meta: { changes: count } };
        }
        if (sql.startsWith('INSERT INTO oauth_states')) {
          const [state_hash, browser_token_hash, nonce, code_verifier, return_to, expires_at_ms, created_at_ms] = params;
          oauthStates.set(state_hash, { state_hash, browser_token_hash, nonce, code_verifier, return_to, expires_at_ms, created_at_ms });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('DELETE FROM oauth_states WHERE state_hash = ? AND browser_token_hash = ? AND expires_at_ms > ?')) {
          const [state_hash, browser_token_hash, now] = params;
          const row = oauthStates.get(state_hash);
          if (row && row.browser_token_hash === browser_token_hash && row.expires_at_ms > now) {
            oauthStates.delete(state_hash);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith('DELETE FROM oauth_states WHERE state_hash = ?')) {
          const deleted = oauthStates.delete(params[0]) ? 1 : 0;
          return { meta: { changes: deleted } };
        }
        throw new Error(`Unexpected run SQL: ${sql}`);
      },
    };
    return stmt;
  }

  return {
    identities,
    prepare(sql) { return makeStmt(sql); },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
}

test('Google OIDC auth URL includes PKCE S256, state, nonce and redirect_uri', async () => {
  const challenge = await pkceChallenge('test-verifier-123');
  assert.ok(challenge.length > 30);
  const url = new URL(buildGoogleAuthUrl({
    clientId: 'cid-123.apps.googleusercontent.com',
    redirectUri: 'https://asobe-print-order.workers.dev/auth/google/callback',
    state: 'st-1',
    nonce: 'nc-1',
    codeChallenge: challenge,
  }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('state'), 'st-1');
  assert.equal(url.searchParams.get('nonce'), 'nc-1');
});

test('verifyGoogleIdToken accepts valid RS256 token and rejects tampered or invalid claims', async () => {
  const { privateKey, publicJwk } = await generateRsaJwkPair('kid-1');
  const nowSec = 1_800_000_000;
  const basePayload = {
    iss: 'https://accounts.google.com',
    aud: 'client-abc',
    sub: 'google-sub-999',
    email: 'staff@example.test',
    email_verified: true,
    name: 'テスト職員',
    nonce: 'expected-nonce-1',
    iat: nowSec - 10,
    exp: nowSec + 300,
  };
  const jwks = { keys: [publicJwk] };
  const validToken = await signJwt({ alg: 'RS256', kid: 'kid-1', typ: 'JWT' }, basePayload, privateKey);

  const verified = await verifyGoogleIdToken(validToken, {
    clientId: 'client-abc',
    expectedNonce: 'expected-nonce-1',
    jwks,
    nowSec,
  });
  assert.deepEqual(verified, {
    sub: 'google-sub-999',
    email: 'staff@example.test',
    fullName: 'テスト職員',
    displayName: 'テスト職員',
  });

  // Tampered payload fails signature check
  const parts = validToken.split('.');
  const fakePayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...basePayload, sub: 'attacker' })));
  await assert.rejects(() => verifyGoogleIdToken(`${parts[0]}.${fakePayload}.${parts[2]}`, {
    clientId: 'client-abc', expectedNonce: 'expected-nonce-1', jwks, nowSec,
  }), /Invalid ID token signature/);

  // alg=none rejected
  const noneToken = `${base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'none', kid: 'kid-1' })))}.${parts[1]}.`;
  await assert.rejects(() => verifyGoogleIdToken(noneToken, {
    clientId: 'client-abc', expectedNonce: 'expected-nonce-1', jwks, nowSec,
  }), /Unsupported JWT algorithm/);

  // Wrong nonce, audience, issuer, unverified email, expired token all rejected
  for (const [label, override, expectedErr] of [
    ['nonce', { nonce: 'wrong' }, /Nonce mismatch/],
    ['aud', { aud: 'other-client' }, /Invalid audience/],
    ['iss', { iss: 'https://evil.example' }, /Invalid issuer/],
    ['email_verified', { email_verified: false }, /not verified/],
    ['expired', { exp: nowSec - 120 }, /expired/],
  ]) {
    const bad = await signJwt({ alg: 'RS256', kid: 'kid-1' }, { ...basePayload, ...override }, privateKey);
    await assert.rejects(
      () => verifyGoogleIdToken(bad, { clientId: 'client-abc', expectedNonce: 'expected-nonce-1', jwks, nowSec }),
      expectedErr,
      `case ${label} should fail`,
    );
  }
});

test('verifyGoogleIdTokenWithAutoRefresh refreshes JWKS once on key rotation', async () => {
  clearJwksCache();
  const key1 = await generateRsaJwkPair('old-kid');
  const key2 = await generateRsaJwkPair('new-kid');
  const nowMs = 1_800_000_000_000;
  const token = await signJwt(
    { alg: 'RS256', kid: 'new-kid' },
    {
      iss: 'https://accounts.google.com',
      aud: 'client-rot',
      sub: 'sub-rot',
      email: 'rot@example.test',
      email_verified: true,
      nonce: 'n-rot',
      iat: Math.floor(nowMs / 1000) - 5,
      exp: Math.floor(nowMs / 1000) + 600,
    },
    key2.privateKey,
  );
  let calls = 0;
  const fetcher = async () => {
    calls++;
    const keys = calls === 1 ? [key1.publicJwk] : [key1.publicJwk, key2.publicJwk];
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'cache-control': 'max-age=3600' } });
  };
  const verified = await verifyGoogleIdTokenWithAutoRefresh(token, {
    clientId: 'client-rot',
    expectedNonce: 'n-rot',
    fetcher,
    nowMs,
  });
  assert.equal(calls, 2);
  assert.equal(verified.sub, 'sub-rot');
});

test('OAuth state is bound to browser cookie, expires, and can only be consumed once', async () => {
  const db = createFakeD1();
  const now = 1_000_000;
  await createOAuthState(db, {
    state: 'st-secret',
    browserToken: 'br-secret',
    nonce: 'nonce-1',
    codeVerifier: 'verifier-1',
    returnTo: '/orders',
  }, now);

  // Wrong browser cookie rejected (login CSRF defense)
  assert.equal(await consumeOAuthState(db, { state: 'st-secret', browserToken: 'wrong-br' }, now + 1000), null);

  // First valid consumption succeeds
  const tx = await consumeOAuthState(db, { state: 'st-secret', browserToken: 'br-secret' }, now + 1000);
  assert.deepEqual(tx, { nonce: 'nonce-1', codeVerifier: 'verifier-1', returnTo: '/orders' });

  // Replay attempt fails
  assert.equal(await consumeOAuthState(db, { state: 'st-secret', browserToken: 'br-secret' }, now + 2000), null);
});

test('server session lifecycle supports idle timeout, revocation on staff disable, and identity mapping', async () => {
  const db = createFakeD1();
  const now = 2_000_000;
  const token1 = await startSession(db, { userId: 'u-1', email: 'u1@example.test', displayName: 'User 1' }, now);
  const token2 = await startSession(db, { userId: 'u-1', email: 'u1@example.test', displayName: 'User 1' }, now);

  const active = await getActiveSession(db, token1, now + 1000);
  assert.equal(active.userId, 'u-1');
  assert.equal(active.email, 'u1@example.test');
  assert.equal(active.displayName, 'User 1');

  // Expired after IDLE_LIMIT_MS
  assert.equal(await getActiveSession(db, token1, now + IDLE_LIMIT_MS + 1), null);

  // Touch extends session
  assert.equal(await touchSession(db, token1, now + 30 * 60 * 1000), true);
  assert.ok(await getActiveSession(db, token1, now + IDLE_LIMIT_MS + 1));

  // Single logout ends only token1
  await endSession(db, token1);
  assert.equal(await getActiveSession(db, token1, now + 1000), null);
  assert.ok(await getActiveSession(db, token2, now + 1000));

  // Revoke all sessions on staff deactivation
  await revokeUserSessions(db, 'u-1');
  assert.equal(await getActiveSession(db, token2, now + 1000), null);

  // Legacy Sites user_id mapping via staff_identities
  db.identities.set('google-sub-123', { user_id: 'legacy-sites-user-1' });
  assert.equal(await resolveMappedUserId(db, 'google-sub-123'), 'legacy-sites-user-1');
  assert.equal(await resolveMappedUserId(db, 'new-google-sub-456'), 'new-google-sub-456');
});
