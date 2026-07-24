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

## Copy Engine

O Copy Engine gera textos promocionais para produtos já persistidos, usando somente templates locais. Ele não utiliza OpenAI, LLM, IA, WhatsApp ou Analytics.

Execute manualmente pela API:

```bash
curl -X POST http://localhost:3333/copy/generate \
  -H 'Content-Type: application/json' \
  -d '{"productId":"ID_DO_PRODUTO"}'
```

Resposta esperada:

```json
{
  "titulo": "🔥 Oferta Relâmpago: Fone Bluetooth por R$ 99,90",
  "mensagem": "Corre! Fone Bluetooth na categoria Eletrônicos está com 25% de desconto, nota 4,8 e comissão de 12%.",
  "cta": "Garanta agora antes que a oferta acabe!",
  "hashtags": "#OfertaRelampago #Eletronicos #Desconto25"
}
```

A cada chamada, uma nova linha é criada na tabela `GeneratedCopy`; registros antigos não são atualizados.

Templates disponíveis:

- 🔥 Oferta Relâmpago
- 💥 Desconto Imperdível
- 🚚 Frete Grátis
- ⭐ Mais Vendido
- ❤️ Produto Campeão
- 🎁 Achado do Dia
- ⚡ Promoção Limitada
- 🏆 Melhor Custo Benefício

Placeholders suportados pelo `TemplateEngine`: `{{nome}}`, `{{preco}}`, `{{desconto}}`, `{{comissao}}`, `{{categoria}}` e `{{nota}}`.

## Relatório da Sprint - Copy Engine

### Arquivos criados

- `apps/api/src/copy-service.ts`: serviço de geração de copy, `TemplateEngine`, 8 templates, logs estruturados, persistência e tratamento de erros.
- `apps/api/test/copy.test.ts`: testes de substituição de placeholders, cobertura de todos os templates, persistência e endpoint `POST /copy/generate`.

### Arquivos modificados

- `apps/api/src/app.ts`: registro do endpoint `POST /copy/generate` com validação de `productId` e respostas de erro.
- `packages/database/prisma/schema.prisma`: criação do modelo `GeneratedCopy` relacionado a `ProductLead`.
- `README.md`: documentação do Copy Engine e relatório da sprint.

### Testes

- Substituição de placeholders conhecidos e preservação de placeholders desconhecidos.
- Renderização de todos os 8 templates sem placeholders pendentes.
- Persistência de uma nova copy por chamada.
- Erro para produto inexistente.
- Endpoint `POST /copy/generate` com resposta no formato esperado.
- Validação de `productId` obrigatório.

### Decisões

- A escolha do template é aleatória a cada geração para variar as copies sem IA.
- Valores monetários e percentuais são formatados em `pt-BR`.
- Hashtags são normalizadas para remover acentos e caracteres inválidos.
- O histórico é preservado criando sempre novos registros em `GeneratedCopy`.

### Problemas

- Não havia migrações Prisma no repositório; o schema foi atualizado diretamente, mantendo o padrão das sprints anteriores.

### Pendências

- Criar migração Prisma formal quando o fluxo de migrações do projeto for definido.

## Pipeline BullMQ

A execução manual do Pipeline foi migrada para BullMQ. O endpoint `POST /pipeline/run` não executa mais o `PipelineService` diretamente; ele apenas cria um job `pipeline-product` na fila `product-pipeline` com payload opcional de filtros:

```json
{
  "filters": {
    "categoria": "Eletrônicos",
    "notaMin": 4.5
  }
}
```

Execute pela API:

```bash
curl -X POST http://localhost:3333/pipeline/run \
  -H 'Content-Type: application/json' \
  -d '{"filters":{"categoria":"Eletrônicos"}}'
```

Resposta esperada:

```json
{
  "jobId": "123",
  "status": "queued"
}
```

O worker registra o consumer do job `pipeline-product` e, ao receber o job, executa o `PipelineService` com os filtros recebidos. Os logs estruturados cobrem: job recebido, pipeline iniciado, pipeline concluído e pipeline falhou.

Consulte o status de um job:

```bash
curl http://localhost:3333/pipeline/jobs/123
```

Resposta esperada:

```json
{
  "status": "completed",
  "progress": 100,
  "startedAt": "2026-01-01T10:00:00.000Z",
  "finishedAt": "2026-01-01T10:00:01.000Z",
  "result": {
    "hunter": {},
    "score": {},
    "tempoExecucao": "20ms"
  },
  "error": null
}
```

Esta sprint não implementa cron, WhatsApp, OpenAI nem Analytics.

## Relatório da Sprint - Pipeline BullMQ

### Arquivos criados

- `apps/api/src/pipeline-service.ts`: orquestra Hunter e Score como serviço reutilizável pelo worker.
- `apps/api/test/pipeline-queue.test.ts`: cobre criação do job e consulta de status pela API.
- `apps/worker/test/pipeline-product.test.ts`: cobre processamento e falha do consumer `pipeline-product`.

### Arquivos modificados

- `apps/api/src/app.ts`: `POST /pipeline/run` passa a enfileirar o job; `GET /pipeline/jobs/:id` consulta status no BullMQ.
- `apps/worker/src/index.ts`: registra o consumer `pipeline-product`, executa o `PipelineService` e adiciona logs/progresso.
- `packages/queue/src/index.ts`: ajusta payload do job para `{ filters?: ProductFilters }` e mantém nomes de fila/job centralizados.
- `apps/api/package.json`, `apps/worker/package.json`, `packages/queue/package.json`: adicionam dependências workspace necessárias para fila, worker e tipos compartilhados.
- `apps/worker/tsconfig.json`: inclui as fontes necessárias para testar o worker com o `PipelineService`.
- `README.md`: documenta uso da fila, endpoints e relatório da sprint.

### Testes

- Criação do job `pipeline-product` via `POST /pipeline/run`.
- Processamento do job no worker com atualização de progresso.
- Falha do processamento com log `Pipeline falhou`.
- Consulta de status via `GET /pipeline/jobs/:id`.

### Decisões

- O endpoint de disparo retorna HTTP 202 para representar processamento assíncrono enfileirado.
- O payload do job preserva apenas `filters?: ProductFilters`, sem WhatsApp, OpenAI, Analytics ou destino de envio.
- O progresso é atualizado para 10 ao iniciar o processamento e 100 ao concluir.
- A consulta de status usa os metadados nativos do BullMQ (`getState`, `progress`, `processedOn`, `finishedOn`, `returnvalue` e `failedReason`).

### Débito técnico

- O projeto ainda não possui ambiente Redis de teste isolado; os testes usam mocks/invocação direta do processor.
- O worker importa o `PipelineService` da aplicação API para evitar duplicação, mas uma futura extração para um pacote `packages/pipeline` reduziria acoplamento entre apps.

### Pendências

- Criar testes de integração com Redis real em pipeline CI.
- Definir política de retenção, retry e backoff dos jobs em produção.
