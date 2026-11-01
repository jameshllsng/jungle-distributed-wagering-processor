import { InconsistentLedgerEntryError } from './errors';
import { Money } from './money';
import { LedgerDirection } from './wager-transaction';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export interface LedgerEntryState extends Omit<CreateLedgerEntryProps, 'createdAt'> {
  createdAt: Date;
}

/** Append-only audit record for exactly one financial balance movement. */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    private readonly _createdAt: Date,
  ) { Object.freeze(this); }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    WalletLedgerEntry.assertBalanced(props.direction, props.money, props.balanceBefore, props.balanceAfter);
    return new WalletLedgerEntry(props.id, props.walletId, props.transactionId, props.direction, props.money,
      props.balanceBefore, props.balanceAfter, WalletLedgerEntry.copyDate(props.createdAt ?? new Date()));
  }

  /** Reconstructs a persisted, previously-validated ledger entry. */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(state.id, state.walletId, state.transactionId, state.direction, state.money,
      state.balanceBefore, state.balanceAfter, WalletLedgerEntry.copyDate(state.createdAt));
  }

  get createdAt(): Date { return WalletLedgerEntry.copyDate(this._createdAt); }

  isBalanced(): boolean {
    try {
      WalletLedgerEntry.assertBalanced(this.direction, this.money, this.balanceBefore, this.balanceAfter);
      return true;
    } catch (error) {
      if (error instanceof InconsistentLedgerEntryError) return false;
      throw error;
    }
  }

  private static assertBalanced(direction: LedgerDirection, money: Money, before: Money, after: Money): void {
    if (!money.isPositive()) throw new InconsistentLedgerEntryError('Ledger money must be positive');
    if (before.isNegative() || after.isNegative()) {
      throw new InconsistentLedgerEntryError('Ledger balances cannot be negative');
    }
    const expected = direction === LedgerDirection.Debit ? before.subtract(money) : before.add(money);
    if (!expected.equals(after)) throw new InconsistentLedgerEntryError('Ledger balances do not match its direction and amount');
  }

  private static copyDate(value: Date): Date { return new Date(value.getTime()); }
}
