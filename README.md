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
- `pnpm evolution:init`: cria a configuração local ignorada da Evolution API
  com segredos aleatórios, sem exibi-los.
- `pnpm evolution:up`: sobe Evolution API, PostgreSQL e Redis isolados.
- `pnpm evolution:status`: mostra estado, saúde e porta da stack Evolution.
- `pnpm evolution:logs`: mostra as últimas 200 linhas dos containers, sem
  imprimir o ambiente.
- `pnpm evolution:restart`: reinicia a stack Evolution sem apagar dados.
- `pnpm evolution:down`: para a stack Evolution e preserva os volumes.
- `pnpm build`: compila todos os pacotes e aplicações.
- `pnpm lint`: executa ESLint.
- `pnpm typecheck`: executa TypeScript sem emissão.
- `pnpm test`: executa os testes mínimos.

## Infraestrutura local da Evolution API

A infraestrutura isolada fica em `infra/evolution` e usa três containers:

- `shopee-evolution-api`, com a imagem pública fixada
  `evoapicloud/evolution-api:v2.3.6`;
- `shopee-evolution-postgres`, banco exclusivo sem porta publicada no host;
- `shopee-evolution-redis`, cache exclusivo sem porta publicada no host.

Para preparar e iniciar no Windows/PowerShell:

```powershell
pnpm evolution:init
pnpm evolution:config
pnpm evolution:pull
pnpm evolution:up
pnpm evolution:status
```

A API fica em `http://localhost:8080` e a rota pública `/` funciona como status
oficial da versão 2.3.6. A configuração real fica somente em
`infra/evolution/.env.local`, que está ignorado pelo Git e nunca deve ser enviado
ao GitHub. PostgreSQL, Redis, volumes e rede usam nomes próprios e não colidem
com o compose principal.

A 2.3.6 foi escolhida por ser a última release pública estável da linha 2.3.x,
anterior à ativação remota obrigatória da 2.4.0, e por incorporar a correção da
migração Kafka publicada na 2.3.5. Sua licença é Apache 2.0 com condições
adicionais de preservação da marca/copyright no frontend e aviso visível de uso
da Evolution API; descumprir essas condições pode exigir licença comercial.
Consulte o [guia operacional completo](infra/evolution/README.md).

Esta stack apenas inicia a infraestrutura. Ela não cria instância, não gera QR
Code, não conecta WhatsApp, não executa pipeline ou Scheduler e não envia
mensagens. Um próximo passo deve revisar manualmente ambiente, instância
fictícia, safe mode, allowlist e limite antes de decidir criar e conectar uma
instância em uma task separada e controlada.

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

`GET /scheduler` consulta somente o estado do agendamento conhecido e retorna:

```json
{
  "enabled": true,
  "status": "registered",
  "jobId": "scheduled-pipeline-product",
  "queue": "product-pipeline",
  "jobName": "pipeline-product",
  "cronExpression": "0 8 * * *",
  "timezone": "America/Sao_Paulo",
  "nextRunAt": "2026-07-25T11:00:00.000Z"
}
```

O endpoint e somente leitura: nao registra, edita ou remove cron e nao executa
o pipeline. Quando o estado nao pode ser consultado, responde HTTP 503 com o
codigo `SCHEDULER_STATUS_UNAVAILABLE`, sem detalhes do Redis ou stack.

O dashboard consome `GET /scheduler` pela camada HTTP centralizada. A Visao
geral mostra status e proxima execucao em um resumo independente; Configuracoes
exibe todos os campos publicos e permite apenas atualizar a consulta. Cron,
enabled e timezone continuam configurados exclusivamente no ambiente do worker.
HTTP 503 aparece como indisponibilidade, nunca como Scheduler desativado, e
nenhum segredo ou detalhe interno e renderizado.

### Provider mock

`MockWhatsAppProvider` valida destino e mensagem não vazios, gera `externalMessageId` fictício, retorna `status: "sent"`, registra chamadas em memória para testes e permite simular falhas.

### Evolution API preparada

O `EvolutionApiWhatsAppProvider` usa o contrato confirmado da Evolution API
2.3.6 fixada na infraestrutura local para
`POST /message/sendText/{instanceName}`: payload plano
`{ "number": "<destination>", "text": "<message>" }`, header `apikey`,
`Content-Type: application/json`, timeout, mapeamento de erros e resposta
interna segura. Nao existe fallback automatico para `textMessage` ou outro
formato, pois uma segunda tentativa poderia duplicar a mensagem. A factory
`createWhatsAppProvider` mantem `mock` como padrao e aceita `evolution` apenas
com configuracao completa.

```env
WHATSAPP_PROVIDER=mock
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=replace-with-your-api-key
EVOLUTION_INSTANCE_NAME=affiliate-bot
EVOLUTION_SAFE_MODE=true
EVOLUTION_ALLOWED_DESTINATIONS=
EVOLUTION_MAX_MESSAGES_PER_BOOT=1
```

O worker usa `loadConfig` no bootstrap, cria o provider e o
`EvolutionSendGuard` uma vez por meio de `createWhatsAppProvider` e injeta a
mesma instancia nos jobs. O safe mode fica ativo por padrao, exige que o
destino normalizado esteja na allowlist e limita os requests iniciados durante
a vida do processo. A allowlist vazia bloqueia todos os envios Evolution e o
limite padrao e 1. Requests que chegaram ao cliente HTTP contam mesmo quando
terminam em timeout ou erro HTTP; bloqueios anteriores ao HTTP nao contam.

O provider `mock` ignora essas configuracoes e continua sem HTTP. Desativar o
safe mode exige `EVOLUTION_SAFE_MODE=false` explicito e preserva o comportamento
anterior do provider Evolution; credenciais presentes nunca desativam a
protecao automaticamente. Nenhuma mensagem real ou request externo foi
executado na task que introduziu esse mecanismo. A proxima task devera criar um
fluxo explicito, isolado e auditavel para um unico teste real.

Testes usam mock ou cliente HTTP injetado e nunca usam credenciais reais. Nunca versione um arquivo `.env`, credenciais reais ou números reais de WhatsApp.

### Teste isolado de uma mensagem

O comando abaixo e isolado do bootstrap normal do worker e funciona em dry-run
por padrao:

```bash
corepack pnpm evolution:test-message
```

O dry-run carrega e valida a configuracao, cria uma unica instancia do provider
Evolution com o guard existente, mostra apenas um resumo mascarado e encerra sem
chamar `sendMessage` ou HTTP. Ele nao inicia workers BullMQ, nao acessa Redis,
Prisma ou banco, nao registra Scheduler e nao usa pipeline, dispatch, copy ou
produto.

Um envio controlado exige exclusivamente a flag exata abaixo, sem confirmacao
interativa e sem depender de `pnpm` global no Windows:

```bash
corepack pnpm evolution:test-message -- --confirm-one-real-message
```

Esse modo nunca pode executar em CI e exige simultaneamente:

- `WHATSAPP_PROVIDER=evolution` e credenciais Evolution completas somente no
  `.env` local nao versionado.
- `EVOLUTION_SAFE_MODE=true`.
- Exatamente um destino em `EVOLUTION_ALLOWED_DESTINATIONS`; o destino nao pode
  ser informado por argumento e aparece apenas mascarado.
- `EVOLUTION_MAX_MESSAGES_PER_BOOT=1`.
- `SCHEDULER_ENABLED=false`.

A mensagem e fixa: "Teste controlado do sistema Afiliado Shopee. Nenhuma ação
é necessária." Nao sao aceitos texto personalizado, dados de produto, links,
hashtags ou copies. O comando tambem aceita a flag direta quando invocado no
workspace do worker; qualquer separador, flag parcial ou argumento adicional e
bloqueado. Se houver timeout, erro de rede, HTTP 5xx ou resultado ambiguo, e
proibido repetir manual ou automaticamente o envio.

Na validacao da Task 13.4, a stack 2.3.6 e a instancia foram confirmadas como
saudaveis/conectadas, mas o arquivo local ignorado mantinha o provider `mock` e
a allowlist vazia. O dry-run bloqueou antes do provider e nenhuma mensagem real
foi enviada. Nenhuma credencial ou destino foi registrado neste repositorio.

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
- `GET /scheduler`
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
