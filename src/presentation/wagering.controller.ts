import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WageringService, type MoneyDto, type WagerRequest } from '../application/wagering.service';

class MoneyInput implements MoneyDto {
  @IsString() @Matches(/^(?:0|[1-9]\d*)\.\d{2}$/u) amount!: string;
  @IsString() @Matches(/^[A-Z]{3}$/u) currency!: string;
}
class CreateWalletInput { @IsString() @IsNotEmpty() playerId!: string; @ValidateNested() @Type(() => MoneyInput) initialBalance!: MoneyInput; }
class WagerInput implements WagerRequest {
  @IsString() @IsNotEmpty() providerId!: string; @IsString() @IsNotEmpty() externalTransactionId!: string; @IsString() playerId!: string; @IsString() walletId!: string; @IsString() roundId!: string; @IsString() gameId!: string;
  @IsIn(['BET','WIN','LOSS','REFUND','ROLLBACK']) kind!: WagerRequest['kind']; @ValidateNested() @Type(() => MoneyInput) money!: MoneyInput; @IsOptional() @IsString() referenceExternalTransactionId?: string;
}

@Controller()
export class WageringController {
  constructor(private readonly wagering: WageringService) {}
  @Post('wallets') createWallet(@Body() body: CreateWalletInput): Promise<object> { return this.wagering.createWallet(body.playerId, body.initialBalance); }
  @Get('wallets/:walletId') getWallet(@Param('walletId') walletId: string): Promise<object> { return this.wagering.getWallet(walletId); }
  @Get('wallets/:walletId/ledger') ledger(@Param('walletId') walletId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string): Promise<object> { return this.wagering.getLedger(walletId, cursor, limit ? Number(limit) : 50); }
  @Post('wagering/transactions') process(@Body() body: WagerInput, @Headers('idempotency-key') key: string | undefined, @Headers('x-correlation-id') correlationId: string | undefined): Promise<object> { return this.wagering.process(body, key ?? '', undefined, { correlationId: correlationId || randomUUID() }); }
  @Get('wagering/transactions/:transactionId') transaction(@Param('transactionId') transactionId: string): Promise<object> { return this.wagering.getTransaction(transactionId); }
  @Get('providers/:providerId/wagering/transactions/:externalTransactionId') providerTransaction(@Param('providerId') providerId: string, @Param('externalTransactionId') externalTransactionId: string): Promise<object> { return this.wagering.getProviderTransaction(providerId, externalTransactionId); }
  @Post('wallets/:walletId/reconciliation') reconcile(@Param('walletId') walletId: string): Promise<object> { return this.wagering.reconcile(walletId); }
}
