import { InsufficientBalanceError } from './errors';
import { LedgerDirection } from './wager-transaction';
import { InvalidMoneyError, Money } from './money';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  openedAt?: Date;
}

export interface WalletBalanceChange {
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly walletVersion: number;
}

/** Aggregate root that is the only domain owner of a wallet balance. */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.id.trim().length === 0 || props.playerId.trim().length === 0) {
      throw new InvalidMoneyError('Wallet and player identifiers must not be empty');
    }
    if (props.initialBalance.isNegative()) throw new InvalidMoneyError('Initial balance cannot be negative');
    const openedAt = Wallet.copyDate(props.openedAt ?? new Date());
    return new Wallet(props.id, props.playerId, props.initialBalance.currency, props.initialBalance, 1, openedAt, openedAt);
  }

  /** Reconstructs persisted state without validating past transitions. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state.id, state.playerId, state.currency, state.balance, state.version,
      Wallet.copyDate(state.createdAt), Wallet.copyDate(state.updatedAt));
  }

  get balance(): Money { return this._balance; }
  get version(): number { return this._version; }
  get createdAt(): Date { return Wallet.copyDate(this._createdAt); }
  get updatedAt(): Date { return Wallet.copyDate(this._updatedAt); }

  debit(money: Money, at: Date = new Date()): WalletBalanceChange {
    this.assertMovementMoney(money);
    if (this._balance.isLessThan(money)) throw new InsufficientBalanceError();
    return this.apply(money, LedgerDirection.Debit, at);
  }

  credit(money: Money, at: Date = new Date()): WalletBalanceChange {
    this.assertMovementMoney(money);
    return this.apply(money, LedgerDirection.Credit, at);
  }

  private apply(money: Money, direction: LedgerDirection, at: Date): WalletBalanceChange {
    const before = this._balance;
    const after = direction === LedgerDirection.Debit ? before.subtract(money) : before.add(money);
    this._balance = after;
    this._version += 1;
    this._updatedAt = Wallet.copyDate(at);
    return Object.freeze({ direction, money, balanceBefore: before, balanceAfter: after, walletVersion: this._version });
  }

  private assertMovementMoney(money: Money): void {
    if (money.currency !== this.currency) {
      // Use Money's domain error so currency failures have one stable type.
      this._balance.add(money);
    }
    if (!money.isPositive()) throw new InvalidMoneyError('Wallet movement amount must be positive');
  }

  private static copyDate(value: Date): Date { return new Date(value.getTime()); }
}
