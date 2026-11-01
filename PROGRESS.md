# Progress

## Estado atual

- Etapa concluída: checkpoint A com integração PostgreSQL automatizada.
- Concluído: projeto NestJS básico, `Money`, aggregates, migrations aplicadas, persistência PostgreSQL inicial, criação de wallet, operações HTTP, consultas de transação, ledger paginado, reconciliação, outbox persistida e readiness PostgreSQL.
- Em andamento: checkpoint B de mensageria.
- Pendente: múltiplos processos de aplicação automatizados, Inbox/consumer, publisher da outbox, retry/DLQ, worker de referências, recuperação, métricas e documentação final.

## Alterações

- Histórico preservado: este registro foi criado após a auditoria inicial.
- Implementados `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, enums e erros de domínio em `src/domain`.
- Adicionados testes unitários para os três aggregates e ampliada a cobertura de `Money`.
- Corrigida a semântica de `Money.isPositive()` e `Money.isNegative()` para comparações estritas: zero não é uma movimentação positiva.
- Corrigida a factory de `WalletLedgerEntry`: agora rejeita saldo anterior ou posterior negativo, além de manter a validação aritmética e de moeda.
- Corrigida a factory de `WagerTransaction`: referência externa é proibida para `OPENING`, `BET` e `LOSS`; é opcional para `WIN`; e é obrigatória para `REFUND` e `ROLLBACK`.
- Ampliada a validação pura de uma referência já resolvida: ID externo, status `PROCESSED`, provider, player, wallet, round, moeda, valor integral e tipo permitido.
- Decisão: `Wallet` retorna o retrato da movimentação (saldo anterior/posterior, direção e versão) para que o futuro caso de uso persista wallet e ledger na mesma transação SQL.
- Não houve acoplamento com NestJS, MikroORM, migrations, Compose ou SQS.
- Adicionada migration incremental que corrige a regra de referências por tipo sem reescrever a migration inicial.
- Adicionados `DatabaseService`, `WageringService` e controller HTTP inicial. O processamento usa uma transação PostgreSQL, `SELECT ... FOR UPDATE` por wallet, update condicionado para débito e outbox inserida antes do commit.
- Adicionados endpoints para ledger com cursor opaco, consulta por IDs, consulta por provider/external ID e reconciliação pelo ledger.
- Criada suíte `test/integration` que recusa conexão fora de `jungle_test` e limpa exclusivamente as tabelas desse banco entre testes.
- Adicionado bootstrap das filas FIFO LocalStack e readiness que exige PostgreSQL e SQS. Consumer, Inbox e publisher ainda não estão implementados.
- Corrigida a abertura de wallet positiva para persistir `WagerTransactionProcessed` e `WalletBalanceChanged` na Outbox dentro da mesma transação de wallet, OPENING e ledger.
- Corrigido processamento para rejeitar wallet inexistente antes da inserção da transação, impedindo combinação inválida de `result_balance` e `result_currency`.

## Validações

- `bun run typecheck`: aprovado em 31/10/2026 após as correções das ressalvas.
- `bun run test:unit`: aprovado em 31/10/2026; 23 testes, 0 falhas e 78 expectativas.
- Em 01/11/2026, `bun run migration:up` aplicou `Migration20261031000100` e `Migration20261101000100` no PostgreSQL `jungle-wagering` correto.
- Smoke test HTTP em 01/11/2026: criação de wallet BRL 100.00, BET BRL 80.00, saldo final BRL 20.00, replay idempotente e `GET /health/ready` aprovados.
- Concorrência manual real em 01/11/2026, usando dois processos PowerShell contra PostgreSQL: duas BETs BRL 80.00 em wallet BRL 100.00 produziram uma `PROCESSED`, uma `REJECTED`, saldo BRL 20.00, um `DEBIT` e reconciliação consistente.
- Idempotência concorrente manual em 01/11/2026: 50 envios com a mesma idempotency key mantiveram saldo BRL 20.00 e um único `DEBIT`; uma amostra adicional de três envios confirmou uma execução original e dois replays com o mesmo transaction ID.
- `bun run test:integration` em 01/11/2026: 4 testes PostgreSQL reais aprovados, cobrindo abertura/OPENING/ledger, duas BETs concorrentes, 50 entregas idempotentes e refund duplicado.
- Após correções P1, `bun run test:integration` em 01/11/2026: 5 testes PostgreSQL reais aprovados, incluindo Outbox de OPENING, saldo zero sem evento artificial e wallet inexistente.
- `docker compose ps`: PostgreSQL e LocalStack saudáveis em 31/10/2026.
- `bun x mikro-orm migration:list`: a migration `Migration20261031000100` foi listada como executada.
- Não há testes de integração ou concorrência implementados ainda.

## Riscos

- Crítico: o PostgreSQL acessado dentro do container do Compose não possui tabelas, enquanto o CLI do MikroORM lista a migration como executada. A aplicação pode estar acessando outro PostgreSQL local; isso deve ser corrigido antes dos testes de integração.
- Crítico: `docker inspect` informou que as portas declaradas de PostgreSQL e LocalStack não estão publicadas, apesar de o `compose.yaml` as declarar.
- Crítico: não há ainda processamento financeiro transacional, lock por wallet, idempotência, inbox, outbox ou testes distribuídos; portanto essas garantias eliminatórias ainda não estão comprovadas.
- Crítico: os testes de concorrência atuais usam conexões concorrentes no mesmo processo de teste; o cenário com três processos de aplicação independentes continua pendente. SQS/inbox, publisher da outbox e recuperação após falhas não foram implementados.
- Limitação desta etapa: os aggregates preservam invariantes em memória; a atomicidade entre saldo e ledger e a concorrência distribuída serão responsabilidade do futuro caso de uso com PostgreSQL.
- A resolução da referência no repositório, a garantia de que ela existe, a prevenção de reversão duplicada e a atomicidade continuam pendentes para o futuro caso de uso transacional. Quando a referência já estiver disponível, o aggregate valida seus dados de domínio puros.
- Divergência de schema identificada: a migration usa `check ((kind in ('REFUND', 'ROLLBACK')) = (reference_external_transaction_id is not null))`, que proíbe a referência opcional permitida para `WIN`. A correção mínima em migration incremental deverá exigir referência para `REFUND`/`ROLLBACK`, permitir referência nula ou não nula para `WIN`, e exigir referência nula para `OPENING`/`BET`/`LOSS`.
- O primeiro commit e push do projeto foram concluídos anteriormente. As alterações desta etapa permanecem não commitadas para revisão, conforme instrução.

## Auditoria

- Etapa pronta para auditoria: checkpoint A parcial.
- Branch: `main`.
- HEAD: `43d2f6c`.
- Remotes configurados: `origin` para `jameshllsng/jungle-distributed-wagering-processor` e `upstream` para `junglegaming/backend-challenge`.
- Mudanças não commitadas: `PROGRESS.md`, `src/domain/money.ts`, novos arquivos de domínio e os testes unitários correspondentes.
- Última auditoria: auditoria inicial realizada em 31/10/2026; identificou a divergência de banco descrita em Riscos.
- Escopo para auditoria: migrations aplicadas, abertura de wallet, transação HTTP, lock por wallet, débito condicionado, idempotência persistente inicial e outbox atômica.
- Correções pendentes: confirmar e corrigir o destino da conexão para os containers antes de testes de integração. O Work é responsável pelo diagnóstico de infraestrutura nesta etapa.

## Próxima etapa

- Objetivo: implementar consumer SQS, Inbox persistente e publisher da Outbox.
- Pré-condição: nenhuma; infraestrutura PostgreSQL e LocalStack está alcançável em `localhost:5432` e `localhost:4566`.
- Antes de declarar checkpoint B, registrar testes LocalStack reais, retry/DLQ e recuperação.
