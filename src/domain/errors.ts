export class InsufficientBalanceError extends Error {
  constructor() {
    super('Wallet balance is insufficient for this debit');
    this.name = 'InsufficientBalanceError';
  }
}

export class InvalidTransactionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionStateError';
  }
}

export class IncompatibleReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleReferenceError';
  }
}

export class InconsistentLedgerEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InconsistentLedgerEntryError';
  }
}
