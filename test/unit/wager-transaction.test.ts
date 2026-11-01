import { describe, expect, test } from 'bun:test';
import { IncompatibleReferenceError, InvalidTransactionStateError } from '../../src/domain/errors';
import { Money } from '../../src/domain/money';
import {
  FailureCode, LedgerDirection, WagerTransaction, WagerTransactionKind, WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from '../../src/domain/wager-transaction';

const transaction = (overrides: Partial<CreateWagerTransactionProps> = {}): WagerTransaction => WagerTransaction.create({
  id: 'transaction-1', providerId: 'provider-a', externalTransactionId: 'external-1',
  idempotencyKey: 'provider-a:external-1', payloadHash: 'a'.repeat(64), walletId: 'wallet-1',
  playerId: 'player-1', roundId: 'round-1', gameId: 'game-1', kind: WagerTransactionKind.Bet,
  money: Money.from({ amount: '10.00', currency: 'BRL' }), ...overrides,
});

const processedTransaction = (overrides: Partial<CreateWagerTransactionProps> = {}): WagerTransaction => {
  const wager = transaction(overrides);
  wager.markProcessed(undefined, new Date('2026-10-31T10:00:00.000Z'));
  return wager;
};

describe('WagerTransaction', () => {
  test('creates pending transactions and detects an idempotent payload', () => {
    const wager = transaction();
    expect(wager.status).toBe(WagerTransactionStatus.Pending);
    expect(wager.isTerminal()).toBe(false);
    expect(wager.affectsBalance()).toBe(true);
    expect(wager.matchesPayload('a'.repeat(64))).toBe(true);
    expect(wager.matchesPayload('b'.repeat(64))).toBe(false);
    expect(wager.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  test('requires an external reference for refund and rollback', () => {
    expect(() => transaction({ kind: WagerTransactionKind.Refund })).toThrow(IncompatibleReferenceError);
    expect(() => transaction({ kind: WagerTransactionKind.Rollback })).toThrow(IncompatibleReferenceError);
    expect(transaction({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'bet-1' }).requiresReference()).toBe(true);
  });

  test('accepts references only for WIN, REFUND and ROLLBACK', () => {
    expect(() => transaction({ kind: WagerTransactionKind.Bet, referenceExternalTransactionId: 'other' })).toThrow(IncompatibleReferenceError);
    expect(() => transaction({ kind: WagerTransactionKind.Opening, referenceExternalTransactionId: 'other' })).toThrow(IncompatibleReferenceError);
    expect(() => transaction({ kind: WagerTransactionKind.Loss, referenceExternalTransactionId: 'other' })).toThrow(IncompatibleReferenceError);
    expect(transaction({ kind: WagerTransactionKind.Win, referenceExternalTransactionId: 'external-1' }).referenceExternalTransactionId).toBe('external-1');
  });

  test('makes processing terminal and prevents another transition', () => {
    const wager = transaction();
    const processedAt = new Date('2026-10-31T10:00:00.000Z');
    wager.markProcessed(undefined, processedAt);
    expect(wager.status).toBe(WagerTransactionStatus.Processed);
    expect(wager.processedAt).toEqual(processedAt);
    expect(() => wager.reject(FailureCode.InvalidPayload)).toThrow(InvalidTransactionStateError);
  });

  test('rehydrates every terminal state and prevents a further transition', () => {
    for (const status of [WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected, WagerTransactionStatus.Failed]) {
      const wager = WagerTransaction.rehydrate({
        id: `transaction-${status}`, providerId: 'provider-a', externalTransactionId: `external-${status}`,
        idempotencyKey: `provider-a:${status}`, payloadHash: 'a'.repeat(64), walletId: 'wallet-1',
        playerId: 'player-1', roundId: 'round-1', gameId: 'game-1', kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '10.00', currency: 'BRL' }), createdAt: new Date('2026-10-31T10:00:00.000Z'),
        status, processedAt: new Date('2026-10-31T10:01:00.000Z'),
      });
      expect(wager.isTerminal()).toBe(true);
      expect(() => wager.fail(FailureCode.InfrastructureFailure)).toThrow(InvalidTransactionStateError);
    }
  });

  test('moves missing references to pending reference and can reject them later', () => {
    const refund = transaction({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'bet-1' });
    refund.markPendingReference();
    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
    refund.reject(FailureCode.ReferenceNotFound, new Date('2026-10-31T10:00:00.000Z'));
    expect(refund.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(FailureCode.ReferenceNotFound);
  });

  test('calculates directions including rollback from a compatible reference', () => {
    const bet = processedTransaction();
    const rollback = transaction({
      id: 'transaction-2', externalTransactionId: 'external-2', idempotencyKey: 'provider-a:external-2',
      kind: WagerTransactionKind.Rollback, referenceExternalTransactionId: 'external-1',
    });
    expect(transaction({ kind: WagerTransactionKind.Opening }).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(transaction({ kind: WagerTransactionKind.Win }).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(transaction({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'external-1' }).ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    expect(transaction({ kind: WagerTransactionKind.Loss }).affectsBalance()).toBe(false);
    expect(() => transaction({ kind: WagerTransactionKind.Loss }).ledgerDirectionFor()).toThrow(IncompatibleReferenceError);
  });

  test('validates an already-resolved reference with status and amount', () => {
    const refund = transaction({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: 'bet-1' });
    const pendingBet = transaction({ externalTransactionId: 'bet-1' });
    const processedBet = processedTransaction({ externalTransactionId: 'bet-1' });
    expect(() => refund.assertReferenceCompatible(pendingBet)).toThrow(IncompatibleReferenceError);
    expect(() => refund.assertReferenceCompatible(processedTransaction({ externalTransactionId: 'bet-1', money: Money.from({ amount: '9.99', currency: 'BRL' }) }))).toThrow(IncompatibleReferenceError);
    expect(() => refund.assertReferenceCompatible(processedTransaction({ externalTransactionId: 'bet-1', walletId: 'other-wallet' }))).toThrow(IncompatibleReferenceError);
    expect(() => refund.assertReferenceCompatible(processedBet)).not.toThrow();
  });

  test('allows WIN to validate an optional processed BET reference', () => {
    const win = transaction({ kind: WagerTransactionKind.Win, referenceExternalTransactionId: 'bet-1' });
    expect(() => win.assertReferenceCompatible(processedTransaction({ externalTransactionId: 'bet-1' }))).not.toThrow();
  });
});
