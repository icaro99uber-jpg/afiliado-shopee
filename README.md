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

## WhatsApp Sender Mock

O módulo de envio usa exclusivamente `MockWhatsAppProvider`. Ele não faz chamadas HTTP, não integra Evolution API real e não envia mensagens reais. O pipeline cria registros `WhatsAppDispatch` pendentes e enfileira jobs `whatsapp-dispatch`; o worker consome esses jobs e chama o `SenderService` com o provider mock injetado.

### Arquitetura de envio

1. `pipeline-product` executa Hunter, persistência, Score e Copy.
2. Após cada `GeneratedCopy`, o pipeline busca `WhatsAppDestination` ativos.
3. Para cada combinação copy + destino ativo, cria um `WhatsAppDispatch` `PENDING`.
4. Cada dispatch é enfileirado em `whatsapp-dispatch`.
5. O worker executa `SenderService`, incrementa `attemptCount`, chama o mock e atualiza para `SENT` ou `FAILED`.
6. O retry é responsabilidade do BullMQ (`attempts: 3`, backoff exponencial); não há retry manual no serviço.

A mensagem pública enviada é formada por título, mensagem, CTA e hashtags. Comissão de afiliado não é adicionada pelo sender ao payload público.

### Destinos

`WhatsAppDestination` representa grupos ou números do provider:

```json
{
  "name": "Grupo de ofertas",
  "destination": "mock-group-01",
  "active": true
}
```

Destinos inativos permanecem cadastrados, mas não recebem dispatch no pipeline.

### Endpoints

- `POST /whatsapp/destinations`: cria destino.
- `GET /whatsapp/destinations`: lista destinos.
- `PATCH /whatsapp/destinations/:id`: altera `name`, `destination` e/ou `active`.
- `GET /whatsapp/dispatches`: lista envios com filtros opcionais `status`, `destinationId` e `productId`.
- `GET /whatsapp/dispatches/:id`: consulta um envio com produto, copy e destino.
- `POST /pipeline/run`: enfileira `pipeline-product`.
- `GET /pipeline/jobs/:id`: consulta status do job de pipeline.

### Filas

- `product-pipeline` / job `pipeline-product`: orquestra Hunter, Score, Copy e criação dos dispatches.
- `whatsapp-dispatch` / job `whatsapp-dispatch`: payload `{ "dispatchId": "..." }`, com `attempts: 3`, backoff exponencial, `removeOnComplete` e `removeOnFail` limitados.

### Provider mock

`MockWhatsAppProvider` valida destino e mensagem não vazios, gera `externalMessageId` fictício, retorna `status: "sent"`, registra chamadas em memória para testes e permite simular falhas.

### Evolution API futura

A Evolution API real deverá ser conectada criando outro implementation de `WhatsAppProvider` e injetando-a no worker/API via configuração. Essa implementação futura deverá concentrar autenticação, URLs, timeouts, mapeamento de erros e observabilidade sem alterar `SenderService` ou o contrato público.

### Débito técnico

- Adicionar autenticação/autorização antes de uso em produção.
- Criar painel operacional para reprocessar dispatches com falha.
- Implementar provider real da Evolution API apenas em sprint futura.
- Adicionar analytics em sprint separada.
- Fortalecer validação de status/filtros com schemas formais.
