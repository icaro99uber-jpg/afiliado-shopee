# CODEX.md

## Visao geral do projeto

`shopee-auto-affiliate-ai` e um monorepo com pnpm workspaces e Turborepo para automatizar um pipeline afiliado modular da Shopee. O projeto reune API, worker, dashboard e pacotes compartilhados para buscar produtos, calcular score, gerar copies promocionais e preparar envios por WhatsApp usando providers mockados no estado atual.

## Objetivo do sistema

O sistema tem como objetivo apoiar um fluxo de afiliados da Shopee:

1. Encontrar produtos por filtros comerciais.
2. Persistir ou atualizar leads de produtos.
3. Calcular score matematico para priorizacao.
4. Gerar copy promocional por templates locais.
5. Criar dispatches para destinos ativos de WhatsApp.
6. Processar os envios via fila usando o provider WhatsApp selecionado no worker.

O estado atual nao executa scraping real nem usa OpenAI real. No modo padrao `mock`, nao envia mensagens reais por WhatsApp.

## Arquitetura atual

- Monorepo: gerenciado por `pnpm-workspace.yaml` e `turbo.json`.
- API: Fastify em `apps/api`, expondo endpoints de health, Analytics, Hunter, Score, Copy, Pipeline e WhatsApp.
- Camada de aplicacao: servicos em `apps/api/src/*-service.ts`, sem dependencia direta do Prisma Client.
- Contratos de repositorio: interfaces pequenas em `apps/api/src/repositories.ts`.
- Adaptadores Prisma: implementacoes concretas em `apps/api/src/prisma-repositories.ts`.
- Composicao: factory em `apps/api/src/application-services.ts`, reutilizada pela API e pelo worker.
- Worker: BullMQ em `apps/worker`, consumindo filas de pipeline e dispatch.
- Dashboard: Next.js App Router em `apps/dashboard`.
- Banco: Prisma Client e schema PostgreSQL em `packages/database`.
- Filas: BullMQ/Redis em `packages/queue`.
- Scheduler: contratos e adaptador BullMQ em `packages/queue`, compostos uma
  unica vez no bootstrap do worker e desativados por padrao. A API expoe apenas
  a consulta segura `GET /scheduler`.
- Agentes: contratos e implementacoes iniciais em `packages/agents`.
- Providers: contratos e mocks para Shopee, OpenAI, Evolution API e WhatsApp em `packages/providers`.
- Evolution API: provider HTTP v2, `EvolutionSendGuard` e factory segura em
  `packages/providers`, conectados uma unica vez ao bootstrap do worker.
- Teste Evolution isolado: CLI em
  `apps/worker/src/evolution-single-message-test.ts`, separado do bootstrap,
  filas, banco, Scheduler e pipeline.
- Analytics: contrato, adaptador Prisma, servico de snapshot e endpoint `GET /analytics` em `apps/api`, consumido pela visao geral do dashboard.
- Configuracao: validacao de variaveis de ambiente com Zod em `packages/config`.
- Shared: tipos, erros e utilitarios comuns em `packages/shared`.

## Dashboard operacional

O dashboard do MVP usa somente endpoints publicos existentes da API e nao acessa
Prisma, Redis, BullMQ ou variaveis privadas diretamente. A URL da API no
frontend e configurada por `NEXT_PUBLIC_API_URL`, com padrao local seguro
`http://localhost:3333`.

Paginas disponiveis:

- `Visao geral`: health da API, metricas reais de Analytics, ultimo job da
  sessao, resumo somente leitura do Scheduler, atalhos e resumo de dispatches.
- `Produtos`: visualizacao derivada de produtos presentes em dispatches, com
  busca, filtros, ordenacao e paginacao local.
- `Pipeline`: dispara `POST /pipeline/run`, consulta `GET /pipeline/jobs/:id`
  e faz polling moderado enquanto o job esta ativo.
- `Copies`: gera copy manual por `POST /copy/generate` e mantem historico
  apenas durante a sessao da tela.
- `WhatsApp`: lista/cria/edita destinos e lista/filtra/abre detalhes de
  dispatches existentes.
- `Configuracoes`: mostra URL publica da API, estado de conexao, detalhes
  somente leitura do Scheduler, orientacoes de mock/evolution e limites atuais.

Limitacoes por contrato atual:

- Nao ha endpoint publico de listagem completa de produtos.
- Nao ha metrica de produtos pontuados no contrato `AnalyticsSnapshot`.
- Nao ha endpoint de listagem de historico de copies.
- Nao ha endpoint de reprocessamento manual de dispatches.

## Analytics

O modulo de Analytics prepara agregacoes sobre os dados ja persistidos, sem criar
tabelas ou alterar o comportamento operacional. `AnalyticsRepository` define as
contagens e `PrismaAnalyticsRepository` usa somente `count` nos modelos atuais.
`AnalyticsService` reune os resultados em `AnalyticsSnapshot`.

Metricas disponiveis na arquitetura:

- total de produtos;
- total de produtos aprovados com `score >= 70`;
- total de copies geradas;
- total de dispatches pendentes, enviados e com falha;
- total de destinos ativos.

O endpoint `GET /analytics` retorna o snapshot atual diretamente do servico, sem
cache e sem calculos na rota. As metricas refletem apenas os dados persistidos no
momento da consulta. A visao geral consome esse endpoint pela camada centralizada
de API e exibe as sete metricas do contrato. Loading, erro e retry sao isolados
do restante da pagina. Apos executar o pipeline, o usuario pode fazer uma unica
nova consulta pelo botao `Atualizar metricas`, sem polling permanente ou estado
global entre paginas.

## Scheduler

O modulo de Scheduler oferece o agendamento recorrente do pipeline sem executar
`PipelineService` diretamente. `SchedulerConfig` e `PipelineScheduler` formam o
contrato independente de BullMQ. `BullMqPipelineScheduler` usa a API de Job
Schedulers da fila `product-pipeline` para registrar apenas jobs
`pipeline-product` com ID estavel, consultar o estado e remover o agendamento.

Configuracao opcional:

- `SCHEDULER_ENABLED=false` por padrao;
- `SCHEDULER_CRON`, exigido e validado somente quando habilitado;
- `SCHEDULER_TIMEZONE`, exigido como timezone IANA somente quando habilitado.

O bootstrap do worker cria uma unica instancia do Scheduler com a conexao e a
fila `product-pipeline` compartilhadas. Quando habilitado, registra o job com o
cron e timezone validados; quando desabilitado, remove apenas o ID estavel
conhecido. Os consumidores so iniciam depois que essa operacao termina com
sucesso, e qualquer falha interrompe o bootstrap com log estruturado seguro.

O encerramento fecha workers, fila e conexao sem remover o agendamento. O fluxo
manual por `POST /pipeline/run` permanece disponivel, e tanto o job manual quanto
o recorrente reutilizam o mesmo processor `pipeline-product`.

A API compoe uma instancia de `SchedulerStatusService` por aplicacao sobre a
fila `product-pipeline` compartilhada. `GET /scheduler` retorna configuracao,
estado, ID, fila, nome do job, cron, timezone e proxima execucao informada pelo
BullMQ. A rota depende apenas da facade, nao cria filas por request e nao chama
`register`, `remove` ou `PipelineService`.

Se o estado nao puder ser consultado, a API retorna HTTP 503 com
`SCHEDULER_STATUS_UNAVAILABLE` e mensagem publica segura. O fechamento da API
encerra a fila e a conexao criadas pela aplicacao.

O dashboard consulta `GET /scheduler` somente pela camada centralizada de API.
A Visao geral mostra status e proxima execucao, enquanto Configuracoes apresenta
enabled, status, jobId, fila, nome do job, cron, timezone e proxima execucao. As
consultas possuem loading, erro e retry isolados; HTTP 503 nao e convertido em
estado desativado. A interface nao possui campos para editar cron nem acoes para
ativar ou desativar o Scheduler.

Regras de seguranca do dashboard:

- Nao colocar `EVOLUTION_API_KEY` ou qualquer segredo em `NEXT_PUBLIC_*`.
- Credenciais da Evolution API ficam somente no `.env` local do worker.
- O provider `mock` continua sendo o modo seguro por padrao.
- O dashboard nao armazena credenciais no navegador.

Fluxo operacional atual:

1. `POST /pipeline/run` ou o Scheduler enfileira um job `pipeline-product`.
2. O worker consome `product-pipeline`.
3. `PipelineService` executa Hunter, Score e Copy.
4. Produtos com `score >= 70` sao considerados aprovados.
5. Para cada copy e destino ativo, o pipeline cria `WhatsAppDispatch` com status `PENDING`.
6. O pipeline enfileira jobs `whatsapp-dispatch`.
7. O bootstrap do worker cria uma unica instancia do provider configurado e a injeta no `SenderService`.
8. `WHATSAPP_PROVIDER=mock` permanece como padrao; `evolution` exige configuracao completa e explicita.
9. Em Evolution, o safe mode ativo por padrao valida uma allowlist normalizada
   e reserva o limite por processo imediatamente antes do request HTTP.

Seguranca do provider Evolution:

- A Evolution API 2.3.6 local recebe texto com o payload plano
  `{ "number": "<destination>", "text": "<message>" }`. O provider nao tenta
  automaticamente `textMessage` ou outro formato para evitar duplicidade.
- `EVOLUTION_SAFE_MODE=true` e o padrao.
- `EVOLUTION_ALLOWED_DESTINATIONS` e uma lista separada por virgulas; vazia
  bloqueia todos os envios reais.
- `EVOLUTION_MAX_MESSAGES_PER_BOOT` aceita apenas inteiro positivo e vale 1 por
  padrao.
- A comparacao remove apenas formatacao comum, exige somente digitos e e exata;
  correspondencias parciais nao sao aceitas.
- Requests iniciados contam mesmo em timeout ou erro HTTP. Bloqueios por
  destino ou limite acontecem antes do HTTP e nao incrementam o contador.
- Safe mode desativado exige valor `false` explicito. Credenciais nao alteram
  esse valor automaticamente.
- O mock nao cria guard e nao e afetado por essas variaveis.
- Logs podem registrar estado, limite, quantidade permitida, contador, codigo
  e destino mascarado, nunca chaves, allowlist ou payload completo.

Teste isolado de uma mensagem Evolution:

1. `corepack pnpm evolution:test-message` executa dry-run por padrao no Windows
   sem exigir `pnpm` global.
2. O comando rejeita CI, flags parecidas e qualquer argumento de destino ou
   mensagem.
3. Exige provider Evolution, safe mode ativo, Scheduler desativado, exatamente
   um destino permitido e limite igual a 1.
4. Reutiliza `createWhatsAppProvider`, `EvolutionSendGuard`, normalizacao,
   mascaramento e tratamento HTTP existentes.
5. O dry-run cria provider e guard, exibe resumo seguro e encerra sem chamar
   `sendMessage`.
6. O caminho de envio exige a flag exata `--confirm-one-real-message`, direta
   ou apos um unico separador `--`, sem prompt ou timeout de confirmacao.
7. A mensagem e fixa e nao usa produto, copy, link, hashtag, dispatch, pipeline
   ou banco.
8. O modulo nao importa bootstrap do worker, BullMQ, Redis, Prisma, filas ou
   servicos da aplicacao.
9. Timeout, erro de rede, HTTP 5xx ou resultado ambiguo proibem retry manual ou
   automatico, pois o request pode ter sido aceito externamente.

Credenciais ficam apenas no `.env` local nao versionado. Na Task 13.4, a stack e
a instancia local foram confirmadas como saudaveis/conectadas, mas o dry-run foi
bloqueado porque a configuracao ignorada ainda selecionava `mock` e mantinha a
allowlist vazia. Nenhuma mensagem real foi enviada e nenhum segredo foi
versionado.

Teste E2E controlado de dispatch:

1. `corepack pnpm whatsapp:e2e-test` carrega o `.env` raiz com precedencia para
   variaveis de processo, valida Evolution 2.3.6, instancia open, banco e Redis
   principais e termina em dry-run sem escrita, job, worker ou envio.
2. O caminho real aceita somente a flag exata
   `--confirm-one-real-dispatch`, permanece bloqueado em CI e exige provider
   Evolution, URL/instancia locais esperadas, safe mode ativo, allowlist com um
   destino, limite 1 e Scheduler desativado.
3. Produto, copy, destino, dispatch e job possuem identidade deterministica. O
   destino tecnico e inativo. Qualquer dispatch/job anterior ou trabalho
   concorrente bloqueia uma nova execucao sem apagar historico.
4. O job `whatsapp-dispatch` usa `attempts: 1`, nao possui backoff e nao e
   removido automaticamente. A politica normal de tres tentativas permanece
   inalterada.
5. O worker E2E instancia somente o consumer de dispatch e cria uma unica
   factory de provider/guard. `SenderService` recebe um message builder fixo
   para entregar exatamente a frase controlada, sem alterar mensagens normais.
6. O resultado e relido do banco e por `GET /whatsapp/dispatches/:id` usando
   `app.inject`; o detalhe publico mascara o destino.
7. Timeout, erro de rede, HTTP 5xx, `FAILED`, `PENDING` inesperado ou resultado
   ambiguo exigem investigacao manual. O comando nunca reenfileira ou repete.

Na preparacao da Task 13.5, Evolution e a instancia foram validadas como
saudaveis/open, e o banco/Redis principais ficaram disponiveis. O `.env` raiz
continuou em `mock`, com instancia de exemplo e allowlist vazia, bloqueando o
dry-run antes de qualquer escrita. Nenhuma mensagem real foi enviada.

## Infraestrutura local da Evolution API

`infra/evolution` contem um compose independente do compose principal. Ele fixa
`evoapicloud/evolution-api:v2.3.6`, `postgres:16.4-alpine3.20` e
`redis:7.2.5-alpine3.20`, usa uma rede exclusiva, volumes persistentes com
prefixo proprio e publica somente a API em `127.0.0.1:8080` por padrao.
PostgreSQL e Redis ficam acessiveis apenas na rede Docker da stack.

`pnpm evolution:init` cria uma unica vez `infra/evolution/.env.local`, gera API
key e senha PostgreSQL fortes e nao mostra seus valores. O arquivo local esta
explicitamente ignorado. `evolution:config`, `evolution:pull`, `evolution:up`,
`evolution:down`, `evolution:status`, `evolution:logs` e `evolution:restart`
sempre apontam para esse compose e carregam esse arquivo local.

A Evolution API 2.3.6 nao oferece `/health` ou `/server/ok`; sua rota publica
`GET /` e o status suportado e retorna HTTP 200, mensagem, versao e clientName.
O healthcheck da API usa essa rota. A versao foi escolhida por ser a ultima
release estavel 2.3.x, incorporar a correcao da migracao Kafka da 2.3.5 e nao
ter a ativacao remota obrigatoria introduzida na 2.4.0. A licenca da tag e
Apache 2.0 com condicoes adicionais de marca/copyright e aviso de uso; o
descumprimento pode exigir licenca comercial.

A stack nao automatiza criacao/conexao de instancia, QR Code ou mensagens. Ela
tambem nao inicia worker, pipeline nem Scheduler. Integracoes externas,
telemetria opcional e persistencia de mensagens/contatos/chats ficam
desativadas. O estado seguro desta task nao possui instancia criada, conta
conectada ou mensagem enviada.

O fluxo manual continua disponivel mesmo quando o Scheduler esta habilitado.

Regra de dependencia:

- Servicos de aplicacao recebem contratos por injecao de dependencia.
- Servicos de aplicacao nao importam Prisma Client nem tipos internos do Prisma.
- Operacoes `findUnique`, `findMany`, `create`, `update`, `select`, `include` e tratamento de codigos Prisma ficam nos adaptadores Prisma.
- API e worker devem montar servicos por `createApplicationServices` ou factories equivalentes, sem espalhar novas instanciacoes manuais.
- O worker deve selecionar o provider em `startWorker`, reutilizando a mesma instancia nos jobs de pipeline e dispatch.

## Estrutura de pastas

```text
apps/
  api/         API Fastify, servicos de aplicacao, repositorios e testes da API.
  dashboard/   Aplicacao Next.js.
  worker/      Workers BullMQ para pipeline e envios.
packages/
  agents/      Interfaces e agentes Hunter, Score, Copy, Sender e Analytics.
  config/      Validacao de variaveis de ambiente.
  database/    Prisma Client, schema e migrations.
  providers/   Contratos e mocks de integracoes externas.
  queue/       Nomes de filas, jobs e helpers BullMQ.
  shared/      Tipos, erros e utilitarios compartilhados.
```

Arquivos principais na raiz:

- `package.json`: scripts globais do monorepo.
- `pnpm-workspace.yaml`: definicao dos workspaces.
- `turbo.json`: pipeline de tarefas Turborepo.
- `tsconfig.base.json`: configuracao TypeScript base.
- `eslint.config.mjs`: configuracao ESLint.
- `docker-compose.yml`: servicos locais de infraestrutura.
- `.env.example`: variaveis esperadas para desenvolvimento.

## Convencoes de codigo

- Usar TypeScript em apps e pacotes.
- Preferir contratos explicitos entre pacotes, com tipos exportados pelos workspaces.
- Manter regras de negocio dentro dos servicos existentes quando a mudanca pertencer a API.
- Usar providers para isolar integracoes externas.
- Preservar mocks enquanto uma integracao real nao estiver prevista na sprint.
- Manter `WHATSAPP_PROVIDER=mock` como padrao; selecionar `evolution` exige URL, chave e nome da instancia validos.
- Manter o safe mode Evolution ativo por padrao e nunca inserir destinos reais
  em arquivos versionados.
- Manter o comando de teste Evolution isolado e dry-run por padrao; qualquer
  mudanca no caminho confirmado exige revisao de seguranca dedicada.
- Nunca acessar variaveis de ambiente dentro de providers nem registrar credenciais em logs ou erros.
- Registrar eventos relevantes com logs estruturados nos servicos e workers.
- Evitar acoplamento direto entre endpoints e detalhes de infraestrutura quando ja houver servico dedicado.
- Manter contratos de repositorio pequenos e especificos, evitando interfaces genericas grandes.
- Implementacoes Prisma devem permanecer atras dos contratos de repositorio.
- Novos servicos de aplicacao devem receber dependencias por construtor/factory.
- Manter formatacao compativel com Prettier e validacao por ESLint.

## Regras de commits

- Commits devem ser pequenos, objetivos e ligados ao escopo da tarefa.
- Usar mensagens no estilo Conventional Commits quando aplicavel.
- Exemplos:
  - `docs: add project documentation for Codex`
  - `feat: add score endpoint`
  - `fix: handle missing product copy`
  - `test: cover pipeline dispatch creation`
- Nao misturar documentacao, refatoracao e mudanca funcional no mesmo commit quando puderem ser separados.
- Antes de commitar, validar o diff e garantir que nao ha mudancas fora do escopo.

## Padroes para testes

- Usar Vitest para testes automatizados.
- Preferir testes focados em servicos, contratos e endpoints.
- Para regras matematicas, cobrir casos limite e valores representativos.
- Para persistencia, validar criacao, atualizacao e erros esperados.
- Para filas, testar enfileiramento, payloads e processamento sem depender de integracoes reais.
- Para providers externos, usar mocks e contratos locais.
- Antes de concluir uma sprint funcional, rodar:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build` quando o escopo afetar empacotamento ou integracao entre workspaces.

## Definition of Done

Uma tarefa e considerada pronta quando:

- O escopo pedido foi implementado sem mudancas colaterais.
- Regras de negocio existentes foram preservadas, salvo quando a tarefa pedir alteracao explicita.
- Endpoints, filas, banco e testes existentes nao foram alterados fora do escopo.
- O README ou documentacao relevante foi atualizado quando necessario.
- Testes e checks proporcionais ao risco foram executados.
- `git diff --check` passa sem erros.
- O status do Git contem apenas arquivos esperados para a tarefa.
- O commit final possui mensagem clara e aderente as regras do projeto.

## Fluxo de desenvolvimento

1. Confirmar branch atual e estado do Git.
2. Ler README, estrutura de pastas e arquivos diretamente relacionados ao escopo.
3. Planejar a mudanca respeitando os pacotes existentes.
4. Implementar com menor superficie de alteracao possivel.
5. Rodar checks apropriados ao tipo de mudanca.
6. Revisar `git diff` antes de commitar.
7. Fazer commit com mensagem objetiva.
8. Registrar no relatorio final o que mudou e quais validacoes foram feitas.

## Como criar novas Sprints

Cada nova sprint deve ter:

1. Nome curto e objetivo.
2. Objetivo de negocio ou tecnico.
3. Escopo explicito do que entra.
4. Lista explicita do que nao entra.
5. Arquivos ou modulos esperados.
6. Contratos de entrada e saida.
7. Impacto em banco, endpoints, filas e testes.
8. Criterios de aceite.
9. Testes obrigatorios.
10. Pendencias e riscos conhecidos.

Modelo recomendado:

```text
Sprint: <nome>
Objetivo: <resultado esperado>
Entra no escopo:
- <item>
Fora do escopo:
- <item>
Impacto tecnico:
- Banco:
- Endpoints:
- Filas:
- Providers:
Testes:
- <cenario>
Definition of Done:
- <criterio>
```
