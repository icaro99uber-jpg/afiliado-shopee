# shopee-auto-affiliate-ai

Monorepo com pnpm workspaces e Turborepo para automatizar um pipeline afiliado modular da Shopee com agentes de IA, filas e dashboard.

## Estrutura

- `apps/api`: API Fastify em TypeScript com `GET /health` e `POST /hunter/run`.
- `apps/worker`: worker BullMQ com job de teste `pipeline-product`.
- `apps/dashboard`: Next.js App Router com Tailwind e base shadcn/ui.
- `packages/database`: Prisma Client e schema PostgreSQL para leads de produtos.
- `packages/queue`: conexão Redis, filas e nomes dos jobs.
- `packages/agents`: interfaces e implementações iniciais de Hunter, Score, Copy, Sender e Analytics.
- `packages/providers`: contratos para Hunter/Shopee, OpenAI e Evolution API com mocks.
- `packages/config`: validação das variáveis de ambiente com Zod.
- `packages/shared`: tipos, erros e utilitários comuns.

## Requisitos

- Node.js 20+
- pnpm 9+
- Docker e Docker Compose

## Como executar

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm --filter @shopee-auto-affiliate-ai/database db:generate
pnpm dev
```

A API ficará disponível em `http://localhost:3333/health` e o dashboard em `http://localhost:3000`.

## Hunter Agent

O Hunter Agent pode ser executado manualmente pela API:

```bash
curl -X POST http://localhost:3333/hunter/run \
  -H 'Content-Type: application/json' \
  -d '{"categoria":"Eletrônicos","notaMin":4.5}'
```

A resposta informa quantos produtos foram encontrados, criados e atualizados:

```json
{
  "encontrados": 5,
  "novos": 5,
  "atualizados": 0,
  "tempoExecucao": "20ms"
}
```

Filtros opcionais aceitos: `categoria`, `precoMin`, `precoMax`, `descontoMin`, `notaMin`, `vendidosMin` e `comissaoMin`.

## Scripts

- `pnpm dev`: inicia os apps em modo desenvolvimento via Turborepo.
- `pnpm build`: compila todos os pacotes e aplicações.
- `pnpm lint`: executa ESLint.
- `pnpm typecheck`: executa TypeScript sem emissão.
- `pnpm test`: executa os testes mínimos.

## Desenvolvimento sem integrações reais

Esta primeira versão não implementa scraping nem chamadas externas reais. Os pacotes expõem interfaces e mocks para que provedores reais de Shopee, OpenAI e Evolution API possam ser injetados posteriormente sem alterar os agentes.

## Score Engine

O Score Engine calcula e persiste um score matemático de 0 a 100 para cada produto salvo, sem uso de IA, OpenAI, WhatsApp, Analytics ou ranking.

Pesos utilizados:

- Comissão: 35% (normalizada de 0 a 20%).
- Avaliações: 25% (normalizada de 0 a 5).
- Vendidos: 20% (normalizado de 0 a 10000+).
- Desconto: 10% (normalizado de 0 a 100%).
- Loja oficial: 10% (0 ou 100, quando o nome da loja contém `oficial`).

Execute manualmente pela API:

```bash
curl -X POST http://localhost:3333/score/run
```

Resposta esperada:

```json
{
  "produtosProcessados": 40,
  "maiorScore": 82,
  "menorScore": 21,
  "mediaScore": 48.5,
  "tempoExecucao": "20ms"
}
```

O processamento atualiza os campos `score` e `scoreUpdatedAt` em `ProductLead`.

## Relatório da Sprint - Score Engine

### Arquivos criados

- `apps/api/src/score-service.ts`: serviço de cálculo, execução em lote, persistência, logs estruturados e tratamento de erros.
- `apps/api/test/score.test.ts`: cobertura de cenários de score e endpoint `POST /score/run`.

### Arquivos modificados

- `apps/api/src/app.ts`: registro do endpoint `POST /score/run`.
- `packages/database/prisma/schema.prisma`: adição de `scoreUpdatedAt` ao modelo `ProductLead`.
- `packages/agents/src/index.ts`: alinhamento do cálculo legado de score aos pesos matemáticos desta sprint.
- `packages/agents/src/score.test.ts`: atualização do teste existente para o novo cálculo.
- `README.md`: documentação do Score Engine e relatório da sprint.

### Testes

- Produto excelente.
- Produto médio.
- Produto ruim.
- Produto sem vendas.
- Produto sem comissão.
- Produto nota máxima.
- Produto loja oficial.
- Endpoint `POST /score/run` com persistência de `score` e `scoreUpdatedAt`.

### Decisões

- Comissão aceita valores fracionários (`0.2`) ou percentuais (`20`) e é normalizada para o intervalo 0-20%.
- Loja oficial é identificada matematicamente pelo texto `oficial` no nome da loja, gerando 0 ou 100 no componente.
- Scores são arredondados, limitados entre 0 e 100, e persistidos sem criar ranking nem remover produtos.
- O endpoint retorna estatísticas agregadas apenas da execução atual.

### Problemas

- Não havia migrações Prisma no repositório; o schema foi atualizado diretamente e o client é gerado no build.

### Pendências

- Criar migração Prisma formal quando o fluxo de migrações do projeto for definido.
- Conectar o endpoint a uma base PostgreSQL real nos ambientes de staging/produção.
