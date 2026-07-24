# shopee-auto-affiliate-ai

Monorepo com pnpm workspaces e Turborepo para automatizar um pipeline afiliado modular da Shopee com agentes de IA, filas e dashboard.

## Documentacao

- [CODEX.md](CODEX.md): guia de organizacao, arquitetura, convencoes e fluxo de desenvolvimento.
- [AGENTS.md](AGENTS.md): responsabilidades, entradas, saidas, dependencias e proximos passos dos agentes.

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

Para executar cada parte separadamente:

```bash
pnpm --filter @shopee-auto-affiliate-ai/api dev
pnpm --filter @shopee-auto-affiliate-ai/worker dev
pnpm --filter @shopee-auto-affiliate-ai/dashboard dev
```

O dashboard usa `NEXT_PUBLIC_API_URL` para encontrar a API. Em desenvolvimento,
use:

```env
NEXT_PUBLIC_API_URL=http://localhost:3333
```

Nunca coloque `EVOLUTION_API_KEY` ou outros segredos em variaveis
`NEXT_PUBLIC_*`.

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

O modo padrão não implementa scraping nem chamadas externas reais. Os pacotes expõem interfaces e mocks, e o worker somente seleciona Evolution API quando `WHATSAPP_PROVIDER=evolution` é configurado explicitamente.

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

## WhatsApp Sender

O módulo de envio usa o provider selecionado no bootstrap do worker. `WHATSAPP_PROVIDER=mock` continua sendo o padrão seguro e não faz chamadas HTTP nem envia mensagens reais. O pipeline cria registros `WhatsAppDispatch` pendentes e enfileira jobs `whatsapp-dispatch`; o worker consome esses jobs e chama o `SenderService` com uma única instância do provider injetada.

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

### Scheduler do pipeline

`SchedulerConfig` e `PipelineScheduler` definem o contrato para agendamentos do
pipeline sem depender de BullMQ. O adaptador `BullMqPipelineScheduler` usa a
fila `product-pipeline`, um ID estavel e a API de Job Schedulers para registrar,
consultar ou remover um job recorrente `pipeline-product`. Os filtros opcionais
sao preservados no payload.

```env
SCHEDULER_ENABLED=false
SCHEDULER_CRON=0 8 * * *
SCHEDULER_TIMEZONE=America/Sao_Paulo
```

O Scheduler permanece desativado por padrao. Cron e timezone so sao exigidos
quando `SCHEDULER_ENABLED=true`. O bootstrap do worker cria uma unica instancia
do adaptador usando a conexao e a fila `product-pipeline` compartilhadas. Quando
habilitado, registra o job recorrente com ID estavel; quando desabilitado,
remove somente esse agendamento conhecido para evitar que um cron antigo
permaneca ativo.

O worker so inicia os consumidores depois de confirmar o estado configurado do
Scheduler. Falhas de registro ou remocao interrompem o bootstrap. O shutdown
fecha workers, fila e conexao, mas preserva o agendamento registrado. O endpoint
manual `POST /pipeline/run` continua disponivel, e o Scheduler nunca chama o
`PipelineService` diretamente.

### Provider mock

`MockWhatsAppProvider` valida destino e mensagem não vazios, gera `externalMessageId` fictício, retorna `status: "sent"`, registra chamadas em memória para testes e permite simular falhas.

### Evolution API preparada

O `EvolutionApiWhatsAppProvider` implementa o [contrato HTTP documentado da Evolution API v2](https://docs.evolutionfoundation.com.br/evolution-api/send-text-message) para `POST /message/sendText/{instanceName}`, com payload `{ "number", "textMessage": { "text" } }`, header `apikey`, timeout, mapeamento de erros e resposta interna segura. A factory `createWhatsAppProvider` mantém `mock` como padrão e aceita `evolution` apenas com configuração completa.

```env
WHATSAPP_PROVIDER=mock
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=replace-with-your-api-key
EVOLUTION_INSTANCE_NAME=affiliate-bot
```

O worker usa `loadConfig` no bootstrap, cria o provider uma vez por meio de `createWhatsAppProvider` e injeta a mesma instância nos jobs. Para ativar Evolution futuramente, defina `WHATSAPP_PROVIDER=evolution` e as três variáveis `EVOLUTION_*` somente no `.env` local do ambiente controlado. Configuração incompleta impede a inicialização, e a existência isolada de URL ou chave não altera o modo mock.

Testes usam mock ou cliente HTTP injetado e nunca usam credenciais reais. Nunca versione um arquivo `.env`, credenciais reais ou números reais de WhatsApp.

### Débito técnico

- Adicionar autenticação/autorização antes de uso em produção.
- Criar painel operacional para reprocessar dispatches com falha.
- Validar o envio Evolution em ambiente controlado antes de habilitar produção.
- Produtos pontuados continuam sem metrica agregada no contrato atual.
- Fortalecer validação de status/filtros com schemas formais.

## Analytics

`GET /analytics` retorna um snapshot das metricas calculadas sobre os dados ja
persistidos:

- `totalProducts`
- `totalApprovedProducts`
- `totalGeneratedCopies`
- `totalQueuedDispatches`
- `totalSentDispatches`
- `totalFailedDispatches`
- `totalActiveDestinations`

O endpoint nao usa cache e nao calcula metricas na rota. A visao geral do
dashboard consome esse contrato pela camada centralizada de API e mostra as sete
metricas reais. Os dados refletem o estado persistido no momento da consulta.
Produtos pontuados nao sao exibidos porque esse campo nao existe em
`AnalyticsSnapshot`.

Loading, erro e retry de Analytics ficam isolados do restante da pagina. Depois
que um pipeline concluir, o botao `Atualizar metricas` faz uma nova consulta
explicita, sem polling permanente ou cache.

## Dashboard operacional MVP

O dashboard em `apps/dashboard` foi expandido para uma interface operacional em
Next.js App Router, TypeScript e Tailwind. Ele usa uma camada centralizada em
`apps/dashboard/lib/api` com URL configuravel, timeout, tratamento de respostas
nao JSON, HTTP 400/404/500 e mensagem amigavel quando a API esta indisponivel.

Paginas disponiveis:

- Visao geral: estado da API, ultimo job da sessao, atalhos e resumo de
  dispatches/destinos.
- Produtos: tabela desktop, cards mobile, busca, filtros, ordenacao e paginacao
  local para produtos conhecidos via dispatches.
- Pipeline: formulario com filtros reais, disparo de `POST /pipeline/run`,
  consulta manual de jobId e polling moderado de `GET /pipeline/jobs/:id`.
- Copies: geracao manual por `POST /copy/generate`, botao de copiar e historico
  apenas durante a sessao da tela.
- WhatsApp: criacao/listagem/edicao de destinos e listagem/filtro/detalhes de
  dispatches.
- Configuracoes: URL da API, estado de conexao, orientacoes de mock/evolution e
  lembrete de credenciais fora do navegador.

Endpoints usados pelo dashboard:

- `GET /health`
- `GET /analytics`
- `POST /pipeline/run`
- `GET /pipeline/jobs/:id`
- `POST /copy/generate`
- `POST /whatsapp/destinations`
- `GET /whatsapp/destinations`
- `PATCH /whatsapp/destinations/:id`
- `GET /whatsapp/dispatches`
- `GET /whatsapp/dispatches/:id`

Limitacoes atuais:

- Nao ha endpoint publico para listar todos os produtos; a tela de produtos
  mostra apenas produtos vinculados a dispatches existentes.
- Nao ha campo agregado para produtos pontuados em `AnalyticsSnapshot`; esse
  indicador nao e inventado pelo dashboard.
- Nao ha endpoint de historico de copies; o historico da tela e somente da
  sessao atual.
- Nao ha endpoint de reprocessamento manual de dispatches; o dashboard nao
  inventa essa acao.

Seguranca:

- O dashboard nao armazena credenciais no navegador.
- O provider mock continua seguro por padrao.
- Evolution API so envia mensagens quando configurada explicitamente no ambiente
  do worker.
- Chaves como `EVOLUTION_API_KEY` devem ficar somente no `.env` local do worker.
