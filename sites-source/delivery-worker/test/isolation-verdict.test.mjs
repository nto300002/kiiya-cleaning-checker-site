import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessAccessRevocation, assessRefreshRevocation } from '../verification/isolation-verdict.mjs';

const access = { sameCredential: true, preAuthSucceeded: true, preWriteConfirmed: true, revokedOperationCompleted: true, workerStopped: true, requestsEnded: true, roomAccessUnchanged: true, postAuthRejected: true, revocationDistinguished: true, postCountUnchanged: true, acquiredAt: 1000, expiresAt: 10000, preCheckedAt: 2000, revokedAt: 3000, postCheckedAt: 4000 };
test('access revocation requires same token, controls and correct temporal order', () => {
  assert.equal(assessAccessRevocation(access), 'supported');
  for (const key of ['sameCredential','preAuthSucceeded','preWriteConfirmed','revokedOperationCompleted','workerStopped','requestsEnded','roomAccessUnchanged','postAuthRejected','revocationDistinguished','postCountUnchanged']) {
    assert.equal(assessAccessRevocation({ ...access, [key]: false }), 'inconclusive', key);
  }
  for (const patch of [{ postCheckedAt: 10000 }, { revokedAt: 1500 }, { preCheckedAt: 1000 }, { postCheckedAt: NaN }, { acquiredAt: '1000' }]) assert.equal(assessAccessRevocation({ ...access, ...patch }), 'inconclusive');
});

test('refresh verdict requires unconsumed target and independent control', () => {
  const input = { targetSame: true, targetPreValid: true, targetNotConsumed: true, controlSeparate: true, controlRefreshSucceeded: true, rotationUnderstood: true, revokeCompleted: true, targetRefreshRejected: true, refreshRejectionDistinguished: true };
  assert.equal(assessRefreshRevocation(input), 'supported');
  for (const key of Object.keys(input)) assert.equal(assessRefreshRevocation({ ...input, [key]: false }), 'inconclusive', key);
});
