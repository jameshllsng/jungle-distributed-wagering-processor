# Progress

## Atualizacao atual (2026-11-01)

- Consumer, Inbox, DLQ, polling e shutdown gracioso foram implementados e validados com PostgreSQL e LocalStack reais.
- O teste de tres instancias Nest independentes foi publicado em `05fb7db` e aprovado.
- `PENDING_REFERENCE` possui worker transacional com `SKIP LOCKED`, backoff exponencial e limite de cinco tentativas.
- O esgotamento da referencia termina em `REJECTED` com `REFERENCE_NOT_FOUND_TIMEOUT` e Outbox `WagerTransactionRejected`; nao usa `FAILED`.
- Ultima execucao: typecheck aprovado, 23 testes unitarios aprovados e 15 testes de integracao aprovados.
- Pendencias reais: ROLLBACK fora de ordem, concorrencia/reinicio do worker, recovery concorrente da Outbox, observabilidade, aderencia efetiva ao ORM e documentacao final.

## Estado atual

- Checkpoint A corrigido e publicado; Checkpoint B em implementação.
- PostgreSQL (`jungle`) e LocalStack estão acessíveis em `localhost:5432` e `localhost:4566`.
- O banco isolado `jungle_test` possui as duas migrations e é o único banco usado pela suíte de integração.

## Funcionalidades implementadas

- Domínio financeiro: `Money`, `Wallet`, `WagerTransaction` e ledger imutável.
- Schema PostgreSQL, constraint de referência opcional para `WIN`, lock por wallet e idempotência persistente.
- API de wallet, wagering, consultas, ledger com cursor e reconciliação.
- Outbox transacional para abertura e processamento financeiro; publisher com `SKIP LOCKED` e retry básico.
- Bootstrap das filas FIFO e readiness de PostgreSQL/SQS.
- Consumer SQS e Inbox transacional implementados: Inbox, wagering e `processed_at` compartilham a mesma transação PostgreSQL, anterior ao ack.
- DLQ e `RedrivePolicy` (`maxReceiveCount=5`) configuradas nas filas FIFO do LocalStack.
- Polling contínuo controlado e shutdown gracioso do Consumer; eventos da Outbox usam fila FIFO própria, separada dos comandos de wagering.

## Testes executados

- `bun run typecheck`: aprovado.
- `bun run test:unit`: 23 testes aprovados.
- `bun run test:integration`: 12 testes aprovados em `jungle_test`; sete combinam PostgreSQL real e filas FIFO isoladas do LocalStack.
- A integração cobre abertura/OPENING/outbox, wallet inexistente, duas BETs concorrentes, 50 replays idempotentes, REFUND duplicado, consumo SQS, rollback pré-commit, conflito de payload, redelivery pós-commit e redrive real para DLQ.

## Garantias comprovadas

- Saldo não negativo para BET concorrente via lock por wallet e update condicionado.
- Idempotência é persistida no PostgreSQL e impede segundo débito sob 50 entregas concorrentes.
- Saldo e ledger reconciliam nos cenários executados.
- Abertura positiva confirma wallet, OPENING, ledger e os dois eventos Outbox na mesma transação.
- Para uma BET enviada ao SQS real, Inbox, saldo, ledger e Outbox estão confirmados antes do `DeleteMessage`; uma redelivery posterior não cria um segundo débito.

## Validação pendente

- Consumer e Inbox foram comprovados com LocalStack e PostgreSQL reais para BET, ack pós-commit, rollback pré-commit, redelivery e payload divergente.
- DLQ/RedrivePolicy foi comprovada no LocalStack: entrega sem ack excede cinco recebimentos e é movida à DLQ isolada.

## Riscos atuais

- Worker de referências e teste de três processos independentes ainda estão pendentes.
- Publisher possui teste real de publicação para a fila de eventos; concorrência e recovery ainda estão pendentes.
- O requisito de três processos independentes ainda não está comprovado.

## Limitações

- SQL explícito é usado nas operações financeiras para locks e updates condicionais; MikroORM permanece responsável pela configuração e migrations. Essa escolha precisa ser documentada como trade-off.
- Métricas estruturadas, logs JSON e documentação final estão pendentes.

## Auditorias

- O Work encontrou a ausência de Outbox no OPENING e tratamento incorreto de wallet inexistente; ambos foram corrigidos e cobertos por integração real.
- A reauditoria do Checkpoint A foi concluída com ressalvas: SQL financeiro explícito e validação de consumidores distribuídos ainda pendente.

## Commits relevantes

- `4e07d4d feat: add transactional wagering checkpoint`
- `32b4a82 chore: ignore local test database snapshot`

## Próximo checkpoint

- Implementar consumer SQS com Inbox transacional, ack pós-commit, retry/DLQ e testes LocalStack reais.

## Histórico resumido

- A auditoria inicial identificou banco incorreto, portas não publicadas e ausência de domínio; esses problemas foram resolvidos antes do checkpoint atual.
