// Assesses recorded observations only; it cannot verify revocation or authorize reconciliation.
const allTrue = (input, keys) => !!input && keys.every(key => input[key] === true);
const accessChecks = ['sameCredential', 'preAuthSucceeded', 'preWriteConfirmed', 'revokedOperationCompleted', 'workerStopped', 'requestsEnded', 'roomAccessUnchanged', 'postAuthRejected', 'revocationDistinguished', 'postCountUnchanged'];
const refreshChecks = ['targetSame', 'targetPreValid', 'targetNotConsumed', 'controlSeparate', 'controlRefreshSucceeded', 'rotationUnderstood', 'revokeCompleted', 'targetRefreshRejected', 'refreshRejectionDistinguished'];

export function assessAccessRevocation(input) {
  if (!allTrue(input, accessChecks)) return 'inconclusive';
  const { acquiredAt, preCheckedAt, revokedAt, postCheckedAt, expiresAt } = input;
  if (![acquiredAt, preCheckedAt, revokedAt, postCheckedAt, expiresAt].every(Number.isSafeInteger)
      || acquiredAt < 0 || !(acquiredAt < preCheckedAt && preCheckedAt < revokedAt && revokedAt < postCheckedAt && postCheckedAt < expiresAt)) return 'inconclusive';
  return 'supported';
}

export function assessRefreshRevocation(input) {
  return allTrue(input, refreshChecks) ? 'supported' : 'inconclusive';
}
