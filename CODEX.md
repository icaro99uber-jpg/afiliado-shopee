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
- Evolution API: provider HTTP v2 e factory segura em `packages/providers`, conectada ao bootstrap do worker.
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
