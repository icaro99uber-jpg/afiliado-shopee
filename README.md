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
