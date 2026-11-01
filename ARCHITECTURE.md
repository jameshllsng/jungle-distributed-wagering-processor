# Architecture

## Domínio e precisão

Uma wallet é única por `(player_id, currency)`. Cada operação cria uma `wager_transaction`; cada efeito financeiro gera um lançamento imutável no ledger. `OPENING` representa saldo inicial interno. `Money` usa `decimal.js`, contratos usam strings de duas casas e PostgreSQL usa `numeric(20,2)`; dinheiro nunca é `number` JavaScript.

## PostgreSQL e concorrência

O schema garante unicidade, saldo não negativo, uma entrada de ledger por efeito e regras aritméticas; trigger bloqueia alteração ou exclusão do ledger. O hot path abre uma transação explícita, usa `SELECT ... FOR UPDATE` apenas na wallet, update condicionado para débitos, grava ledger e Outbox e então faz commit. Não existe lock global, portanto wallets distintas permanecem paralelas.

MikroORM atende configuração, migrations e leituras runtime. SQL nativo com `pg` é deliberado para locks, update condicionado e uma única transação para Inbox/ledger/Outbox. É um trade-off: o caminho financeiro não é integralmente gerido pelo Unit of Work.

## Idempotência e operações fora de ordem

`Idempotency-Key` e hash SHA-256 do payload canônico são persistidos. Replay igual retorna o resultado salvo; chave com outro payload é conflito. `REFUND` e `ROLLBACK` exigem referência compatível e única. Sem referência, tornam-se `PENDING_REFERENCE`, e um worker com `SKIP LOCKED` e backoff exponencial tenta cinco vezes antes de rejeitar com `REFERENCE_NOT_FOUND_TIMEOUT`.

## Inbox, Outbox, retry e DLQ

SQS é tratado como `at-least-once`. A Inbox é única por `(consumer_name, message_id)` e, junto da operação, ledger, Outbox e `processed_at`, é escrita antes do ack. Falhas transitórias são reentregues e cinco recebimentos acionam a DLQ.

A Outbox é criada dentro do commit financeiro. Publishers concorrentes usam `FOR UPDATE SKIP LOCKED`. Falha entre envio e confirmação pode duplicar evento: o downstream deve deduplicar por `eventId`; perder evento confirmado seria pior. Após reinício, outra instância retoma Inbox, Outbox e referências pendentes porque não existe estado crítico em memória.

## Observabilidade

Logs JSON omitem segredos e payloads financeiros; incluem os IDs aplicáveis (`correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`). `/metrics` expõe métricas Prometheus de status, duplicatas, retries, profundidade da DLQ, conflitos de lock, lag de Outbox, contagem/soma de latência e divergências. DLQ e lag são coletados das dependências reais; contadores vêm dos caminhos de processamento.

`POST /wallets/:walletId/reconciliation` compara saldo materializado e soma assinada do ledger. Divergências são reportadas, não corrigidas automaticamente, para preservar evidência contábil.

## Limitações e extensão

Autenticação não integra um IdP neste desafio; um guard/`ProviderIdentityPort` é o ponto de extensão na borda HTTP. Health continua público. Conflitos de lock contam erros PostgreSQL de lock; contenção saudável normalmente aparece como latência porque o fluxo aguarda o lock.
