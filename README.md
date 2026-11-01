# Jungle distributed wagering processor

Serviço NestJS/Bun para operações financeiras de apostas. Aceita HTTP e SQS `at-least-once`, usa PostgreSQL para idempotência e concorrência, mantém ledger imutável e publica eventos por Outbox transacional.

## Pré-requisitos e execução

Requer Bun 1.x, Docker e Docker Compose, com as portas `5432`, `4566` e `3000` disponíveis.

```bash
bun install
docker compose up -d
bun run migration:up
bun run start
```

O Compose inicia PostgreSQL 16 no banco `jungle` e LocalStack SQS. As filas são criadas pela aplicação. Use `docker compose down` para parar os serviços; o volume de dados é preservado.

Copie `.env.example` para `.env`. As variáveis relevantes são:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | porta HTTP |
| `DATABASE_URL` | `postgresql://jungle:jungle@localhost:5432/jungle` | PostgreSQL |
| `SQS_ENDPOINT` | `http://localhost:4566` | endpoint SQS/LocalStack |
| `AWS_REGION` | `us-east-1` | região SQS |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `test` | credenciais locais |
| `SQS_QUEUE_NAME` | `wager-transactions.fifo` | comandos |
| `SQS_DLQ_NAME` | `wager-transactions-dlq.fifo` | DLQ |
| `SQS_EVENT_QUEUE_NAME` | `wager-events.fifo` | eventos Outbox |
| `SQS_POLL_ENABLED` | `true` | consumidor SQS |
| `PENDING_REFERENCE_WORKER_ENABLED` | `true` | worker de referência fora de ordem |

## Migrations

Migrations versionadas ficam em `src/infrastructure/persistence/migrations` e são executadas por MikroORM:

```bash
bun run migration:up
bun run migration:down
```

Para integração, crie e migre o banco isolado `jungle_test`. Nunca use o banco de desenvolvimento: a suíte recusa executar em qualquer outro banco.

## API e smoke test

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl -X POST http://localhost:3000/wallets -H 'content-type: application/json' \
  -d '{"playerId":"11111111-1111-4111-8111-111111111111","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Processar uma BET (substitua `WALLET_ID`):

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' -H 'idempotency-key: provider-a:bet-001' \
  -H 'x-correlation-id: request-001' \
  -d '{"providerId":"provider-a","externalTransactionId":"bet-001","playerId":"11111111-1111-4111-8111-111111111111","walletId":"WALLET_ID","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"10.00","currency":"BRL"}}'
```

Também há `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger`, `GET /wagering/transactions/:transactionId`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId` e `POST /wallets/:walletId/reconciliation`.

## Mensageria, retry e recuperação

Comandos SQS usam `messageId`, `correlationId` opcional, `type: "WagerTransactionRequested"` e `data`, que inclui `idempotencyKey` e o mesmo corpo da API. Inbox, mudança financeira e Outbox são gravadas na mesma transação antes do ack. Redelivery não repete efeito; mensagem transitória é reprocessada e, depois de cinco recebimentos, SQS a redireciona à DLQ.

Publishers concorrentes reivindicam Outbox com `FOR UPDATE SKIP LOCKED`. Uma falha depois de publicar e antes de confirmar `published_at` pode duplicar o evento; consumidores downstream devem deduplicar por `eventId`. `REFUND` e `ROLLBACK` sem referência ficam em `PENDING_REFERENCE`; o worker usa backoff exponencial e rejeita após cinco tentativas com `REFERENCE_NOT_FOUND_TIMEOUT`.

Para executar três APIs compartilhando banco e filas, mude somente a porta:

```bash
PORT=3001 bun run start
PORT=3002 bun run start
PORT=3003 bun run start
```

Após falha, qualquer instância saudável recupera mensagens visíveis, Outbox pendente e referências vencidas.

## Logs, métricas e reconciliação

Os logs são JSON sem segredos ou payloads financeiros completos e carregam, conforme aplicável, `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`.

`GET /metrics` retorna Prometheus: transações por status, duplicatas, retries, mensagens reais na DLQ, conflitos de lock, lag da Outbox, latência e divergências de reconciliação. `POST /wallets/:walletId/reconciliation` compara o saldo materializado à soma do ledger.

## Testes

```bash
bun run typecheck
bun run test:unit
bun run test:integration
```

As integrações usam somente `jungle_test` e filas FIFO com UUIDs isolados. Elas cobrem Inbox/DLQ, recuperação de Outbox, PostgreSQL/LocalStack e três processos Nest independentes.

Consulte [ARCHITECTURE.md](ARCHITECTURE.md) para as garantias, decisões e limitações.
