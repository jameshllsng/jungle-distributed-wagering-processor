# Progress

## Estado atual

- Etapa concluída: auditoria inicial do workspace.
- Concluído: projeto NestJS básico, `Money`, liveness, migration inicial e documentação arquitetural inicial.
- Em andamento: nenhuma implementação de domínio nesta versão.
- Pendente: aggregates, persistência transacional, API, idempotência, SQS/inbox, outbox, reconciliação, observabilidade e testes de integração/concurrency.

## Alterações

- Criado este registro de progresso após a auditoria inicial.
- Não houve alteração de código de produção nesta etapa.
- Decisão: o próximo incremento será exclusivamente o domínio puro (`Wallet`, `WagerTransaction` e `WalletLedgerEntry`), sem acoplamento a NestJS ou MikroORM.

## Validações

- `bun run typecheck`: aprovado em 31/10/2026.
- `bun run test:unit`: aprovado em 31/10/2026; 3 testes de `Money`, 0 falhas.
- `docker compose ps`: PostgreSQL e LocalStack saudáveis em 31/10/2026.
- `bun x mikro-orm migration:list`: a migration `Migration20261031000100` foi listada como executada.
- Não há testes de integração ou concorrência implementados ainda.

## Riscos

- Crítico: o PostgreSQL acessado dentro do container do Compose não possui tabelas, enquanto o CLI do MikroORM lista a migration como executada. A aplicação pode estar acessando outro PostgreSQL local; isso deve ser corrigido antes dos testes de integração.
- Crítico: `docker inspect` informou que as portas declaradas de PostgreSQL e LocalStack não estão publicadas, apesar de o `compose.yaml` as declarar.
- Crítico: não há processamento financeiro, lock por wallet, idempotência, inbox, outbox ou testes distribuídos; portanto nenhuma garantia eliminatória está comprovada.
- O worktree contém todos os arquivos de implementação como não rastreados. Nenhum commit foi criado nesta etapa.

## Auditoria

- Etapa pronta para auditoria: auditoria inicial e criação de `PROGRESS.md`.
- Branch: `main`.
- HEAD: `c7143e6`.
- Mudanças não commitadas: arquivos existentes do projeto e este `PROGRESS.md` continuam não rastreados.
- Última auditoria: realizada localmente em 31/10/2026; identificou a divergência de banco descrita em Riscos.
- Correções pendentes: confirmar e corrigir o destino da conexão para os containers antes de testes de integração.

## Próxima etapa

- Objetivo: implementar os aggregates `Wallet`, `WagerTransaction` e `WalletLedgerEntry`, seus enums, erros e testes unitários.
- Critérios de conclusão: construtores encapsulados, factories estáticas, transições explícitas, invariantes financeiras cobertas por testes e `bun run typecheck`/`bun run test:unit` aprovados.
- Não iniciar esta etapa enquanto a versão atual estiver sob auditoria, salvo autorização explícita do candidato.
