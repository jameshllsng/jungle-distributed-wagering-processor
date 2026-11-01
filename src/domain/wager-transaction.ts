import { IncompatibleReferenceError, InvalidTransactionStateError } from './errors';
import { Money } from './money';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export enum FailureCode {
  InsufficientBalance = 'INSUFFICIENT_BALANCE',
  RollbackWouldCreateNegativeBalance = 'ROLLBACK_WOULD_CREATE_NEGATIVE_BALANCE',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  InvalidReference = 'INVALID_REFERENCE',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',
  InvalidPayload = 'INVALID_PAYLOAD',
  InfrastructureFailure = 'INFRASTRUCTURE_FAILURE',
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState extends Omit<CreateWagerTransactionProps, 'createdAt'> {
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

/** A durable wagering operation and its explicit lifecycle. */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    private readonly _createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId: string | undefined,
    private _failureCode: FailureCode | undefined,
    private _processedAt: Date | undefined,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    WagerTransaction.assertRequiredFields(props);
    if (WagerTransaction.requiresReferenceFor(props.kind) && !props.referenceExternalTransactionId) {
      throw new IncompatibleReferenceError(`${props.kind} requires a referenceExternalTransactionId`);
    }
    if (!WagerTransaction.allowsReferenceFor(props.kind) && props.referenceExternalTransactionId) {
      throw new IncompatibleReferenceError(`${props.kind} cannot have a referenceExternalTransactionId`);
    }
    return new WagerTransaction(
      props.id, props.providerId, props.externalTransactionId, props.idempotencyKey, props.payloadHash,
      props.walletId, props.playerId, props.roundId, props.gameId, props.kind, props.money,
      props.referenceExternalTransactionId, WagerTransaction.copyDate(props.createdAt ?? new Date()),
      WagerTransactionStatus.Pending, undefined, undefined, undefined,
    );
  }

  /** Reconstructs an already-persisted state without replaying transitions. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id, state.providerId, state.externalTransactionId, state.idempotencyKey, state.payloadHash,
      state.walletId, state.playerId, state.roundId, state.gameId, state.kind, state.money,
      state.referenceExternalTransactionId, WagerTransaction.copyDate(state.createdAt), state.status,
      state.referenceTransactionId, state.failureCode,
      state.processedAt ? WagerTransaction.copyDate(state.processedAt) : undefined,
    );
  }

  get createdAt(): Date { return WagerTransaction.copyDate(this._createdAt); }
  get status(): WagerTransactionStatus { return this._status; }
  get referenceTransactionId(): string | undefined { return this._referenceTransactionId; }
  get failureCode(): FailureCode | undefined { return this._failureCode; }
  get processedAt(): Date | undefined { return this._processedAt ? WagerTransaction.copyDate(this._processedAt) : undefined; }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertMutable();
    if (this.requiresReference() && !referenceTransactionId) {
      throw new IncompatibleReferenceError(`${this.kind} requires a resolved reference transaction`);
    }
    this._referenceTransactionId = referenceTransactionId;
    this._status = WagerTransactionStatus.Processed;
    this._processedAt = WagerTransaction.copyDate(at);
  }

  markPendingReference(): void {
    this.assertMutable();
    if (!this.requiresReference()) {
      throw new InvalidTransactionStateError(`${this.kind} cannot wait for a reference`);
    }
    if (this._status !== WagerTransactionStatus.Pending) {
      throw new InvalidTransactionStateError(`Cannot move ${this._status} to PENDING_REFERENCE`);
    }
    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode, at: Date = new Date()): void {
    this.assertMutable();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = WagerTransaction.copyDate(at);
  }

  fail(code: FailureCode, at: Date = new Date()): void {
    this.assertMutable();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = WagerTransaction.copyDate(at);
  }

  isTerminal(): boolean {
    return this._status === WagerTransactionStatus.Processed
      || this._status === WagerTransactionStatus.Rejected
      || this._status === WagerTransactionStatus.Failed;
  }

  affectsBalance(): boolean { return this.kind !== WagerTransactionKind.Loss; }
  requiresReference(): boolean { return WagerTransaction.requiresReferenceFor(this.kind); }
  matchesPayload(payloadHash: string): boolean { return this.payloadHash === payloadHash; }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        throw new IncompatibleReferenceError('LOSS does not produce a ledger entry');
      case WagerTransactionKind.Rollback:
        if (!reference) throw new IncompatibleReferenceError('ROLLBACK requires the referenced transaction');
        this.assertReferenceCompatible(reference);
        const direction = reference.ledgerDirectionFor();
        return direction === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
    }
  }

  /**
   * Validates a reference already resolved by the application layer.
   * Repository lookup, duplicate-reversal checks and the atomic commit remain application concerns.
   */
  assertReferenceCompatible(reference: WagerTransaction): void {
    if (!WagerTransaction.allowsReferenceFor(this.kind)) {
      throw new IncompatibleReferenceError(`${this.kind} cannot reference another transaction`);
    }
    if (!this.referenceExternalTransactionId || reference.externalTransactionId !== this.referenceExternalTransactionId) {
      throw new IncompatibleReferenceError('Reference external transaction id does not match');
    }
    if (reference.status !== WagerTransactionStatus.Processed) {
      throw new IncompatibleReferenceError('Reference transaction must be processed');
    }
    if (reference.providerId !== this.providerId || reference.playerId !== this.playerId
      || reference.walletId !== this.walletId || reference.roundId !== this.roundId
      || reference.money.currency !== this.money.currency) {
      throw new IncompatibleReferenceError('Reference must belong to the same provider, player, wallet, round and currency');
    }
    if (!this.money.equals(reference.money)) {
      throw new IncompatibleReferenceError('Reference amount must match the reversal amount');
    }
    const allowedKinds = this.kind === WagerTransactionKind.Rollback
      ? [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund]
      : [WagerTransactionKind.Bet];
    if (!allowedKinds.includes(reference.kind)) {
      throw new IncompatibleReferenceError(`${this.kind} cannot reference ${reference.kind}`);
    }
  }

  private assertMutable(): void {
    if (this.isTerminal()) throw new InvalidTransactionStateError(`Transaction in ${this._status} is terminal`);
  }

  private static requiresReferenceFor(kind: WagerTransactionKind): boolean {
    return kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback;
  }

  private static allowsReferenceFor(kind: WagerTransactionKind): boolean {
    return kind === WagerTransactionKind.Win || WagerTransaction.requiresReferenceFor(kind);
  }

  private static assertRequiredFields(props: CreateWagerTransactionProps): void {
    const required = [props.id, props.providerId, props.externalTransactionId, props.idempotencyKey,
      props.payloadHash, props.walletId, props.playerId, props.roundId, props.gameId];
    if (required.some((value) => value.trim().length === 0)) {
      throw new InvalidTransactionStateError('Transaction identifiers must not be empty');
    }
  }

  private static copyDate(value: Date): Date { return new Date(value.getTime()); }
}
