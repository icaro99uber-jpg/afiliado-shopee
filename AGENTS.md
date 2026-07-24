# AGENTS.md

## Visao geral

Este documento descreve os agentes e componentes de orquestracao atuais do projeto. O estado atual mantem implementacoes locais e mocks como padrao seguro; Evolution API requer selecao e configuracao explicitas.

## Camadas de aplicacao e persistencia

- Servicos de aplicacao: `HunterService`, `ScoreService`, `CopyService`, `SenderService`, `PipelineService` e `AnalyticsService`.
- Contratos de repositorio: `ProductRepository`, `GeneratedCopyRepository`, `WhatsAppDestinationRepository`, `WhatsAppDispatchRepository` e `AnalyticsRepository`.
- Adaptadores Prisma: `PrismaProductRepository`, `PrismaGeneratedCopyRepository`, `PrismaWhatsAppDestinationRepository`, `PrismaWhatsAppDispatchRepository` e `PrismaAnalyticsRepository`.
- Composicao: `createApplicationServices` e `createPrismaRepositories` em `apps/api/src/application-services.ts`.

Regra: agentes e servicos de aplicacao nao dependem diretamente do Prisma Client. Prisma fica restrito aos adaptadores concretos.

## Hunter

Responsabilidade:

- Buscar produtos a partir de filtros comerciais.
- Persistir novos produtos em `ProductLead`.
- Atualizar produtos existentes pelo `providerProductId`.

Entradas:

- `ProductFilters` com campos opcionais como `categoria`, `precoMin`, `precoMax`, `descontoMin`, `notaMin`, `vendidosMin` e `comissaoMin`.
- Provider compatvel com `HunterProvider`.

Saidas:

- Contagem de produtos encontrados.
- Contagem de produtos novos.
- Contagem de produtos atualizados.
- Tempo de execucao.
- Registros criados ou atualizados em `ProductLead`.

Dependencias:

- `HunterService` em `apps/api/src/hunter-service.ts`.
- `HunterProvider` e `MockShopeeProvider` em `packages/providers`.
- `ProductRepository`.
- Adaptador Prisma apenas na composicao.
- Tipos compartilhados em `packages/shared`.

Proximos passos previstos:

- Substituir ou complementar `MockShopeeProvider` por provider real quando a sprint de integracao for definida.
- Fortalecer validacao de filtros com schemas formais.
- Adicionar observabilidade especifica para origem, categoria e volume de produtos.

## Score

Responsabilidade:

- Calcular score matematico de 0 a 100 para produtos persistidos.
- Atualizar `score` e `scoreUpdatedAt` em `ProductLead`.
- Retornar estatisticas agregadas da execucao atual.

Entradas:

- Produtos salvos em `ProductLead`.
- Campos comerciais usados no calculo: comissao, nota, vendidos, desconto e loja.

Saidas:

- Score persistido por produto.
- Quantidade de produtos processados.
- Maior score, menor score e media.
- Tempo de execucao.

Dependencias:

- `ScoreService` em `apps/api/src/score-service.ts`.
- `ProductRepository`.
- Adaptador Prisma apenas na composicao.
- Pesos matematicos locais.
- Testes de score em `apps/api/test/score.test.ts` e `packages/agents/src/score.test.ts`.

Proximos passos previstos:

- Documentar formalmente qualquer alteracao futura de pesos antes de modificar o calculo.
- Avaliar criterios adicionais somente em sprint especifica.
- Criar migracoes Prisma formais quando o fluxo de migracoes for consolidado.

## Copy

Responsabilidade:

- Gerar textos promocionais para produtos existentes.
- Usar templates locais e placeholders.
- Persistir uma nova linha em `GeneratedCopy` a cada geracao.

Entradas:

- `productId` de um produto existente.
- Dados do produto: nome, categoria, preco, desconto, nota e comissao.
- Templates definidos localmente.

Saidas:

- `titulo`.
- `mensagem`.
- `cta`.
- `hashtags`.
- Registro em `GeneratedCopy`.

Dependencias:

- `CopyService` e `TemplateEngine` em `apps/api/src/copy-service.ts`.
- `ProductRepository`.
- `GeneratedCopyRepository`.
- Modelo `GeneratedCopy`.
- Testes de copy em `apps/api/test/copy.test.ts`.

Proximos passos previstos:

- Adicionar templates apenas por sprint dedicada.
- Avaliar integracao com IA somente quando houver decisao explicita de produto.
- Melhorar selecao de template se houver criterios de categoria, score ou canal.

## Sender

Responsabilidade:

- Montar mensagem publica a partir da copy gerada.
- Processar um `WhatsAppDispatch`.
- Incrementar tentativas, chamar provider de WhatsApp e atualizar status.
- Marcar dispatch como `SENT` ou `FAILED`.

Entradas:

- `dispatchId`.
- Registro `WhatsAppDispatch` com relacoes para copy e destino.
- Provider compatvel com `WhatsAppProvider`.

Saidas:

- `WhatsAppDispatch` atualizado.
- `externalMessageId` mockado quando enviado.
- `sentAt` quando enviado.
- `errorMessage` quando houver falha.

Dependencias:

- `SenderService` em `apps/api/src/sender-service.ts`.
- `MockWhatsAppProvider` em `packages/providers`.
- `EvolutionApiWhatsAppProvider` em `packages/providers`, injetado no sender pelo bootstrap quando selecionado.
- Factory `createWhatsAppProvider`, com `mock` como selecao padrao segura.
- Bootstrap `startWorker` em `apps/worker/src/index.ts`, ponto unico de selecao e injecao do provider.
- `WhatsAppDispatchRepository`.
- Fila `whatsapp-dispatch` em `packages/queue`.
- Worker em `apps/worker`.
- Modelos `WhatsAppDestination` e `WhatsAppDispatch`.

Proximos passos previstos:

- Validar a integracao Evolution em ambiente controlado antes de qualquer ativacao em producao.
- Adicionar autenticacao, autorizacao e controles operacionais antes de producao.
- Criar fluxo de reprocessamento manual para falhas.

## Pipeline

Responsabilidade:

- Orquestrar Hunter, Score, Copy e Sender por filas.
- Selecionar produtos aprovados por score.
- Criar dispatches para destinos ativos.
- Enfileirar jobs de envio.

Entradas:

- `POST /pipeline/run` com filtros opcionais.
- Job `pipeline-product` na fila `product-pipeline`.
- Produtos persistidos e destinos ativos.

Saidas:

- Resultado agregado do pipeline.
- Copies geradas para produtos aprovados.
- Dispatches `PENDING`.
- Jobs `whatsapp-dispatch` enfileirados.

Dependencias:

- `PipelineService` em `apps/api/src/pipeline-service.ts`.
- `HunterService`, `ScoreService` e `CopyService`.
- `ProductRepository`, `GeneratedCopyRepository`, `WhatsAppDestinationRepository` e `WhatsAppDispatchRepository`.
- BullMQ e Redis via `packages/queue`.
- Worker em `apps/worker`.
- Adaptadores Prisma apenas na composicao.

Proximos passos previstos:

- Formalizar configuracao de criterios de aprovacao se o limite de score mudar.
- Adicionar painel operacional para acompanhar jobs e dispatches.
- Melhorar rastreabilidade entre produto, copy, destino e envio.
- Separar integracoes reais em providers sem alterar o contrato publico do pipeline.

## Analytics

Responsabilidade:

- Reunir contagens operacionais ja disponiveis nos modelos atuais.
- Retornar um `AnalyticsSnapshot` sem expor Prisma ao servico de aplicacao.

Entradas:

- `AnalyticsRepository` injetado em `AnalyticsService`.
- Produtos, copies, dispatches e destinos ja persistidos.

Saidas:

- Total de produtos e produtos aprovados com `score >= 70`.
- Total de copies geradas.
- Totais de dispatches `PENDING`, `SENT` e `FAILED`.
- Total de destinos ativos.

Dependencias:

- `AnalyticsService` em `apps/api/src/analytics-service.ts`.
- `AnalyticsRepository` e `AnalyticsSnapshot` em `apps/api/src/repositories.ts`.
- `PrismaAnalyticsRepository` em `apps/api/src/prisma-repositories.ts`.
- Factory de repositorios e servicos em `apps/api/src/application-services.ts`.

Restricoes atuais:

- Nao possui endpoint publico.
- Nao possui cache nem logica de dashboard.
- Nao cria tabelas, migracoes ou novos dados.

Proximos passos previstos:

- Expor o snapshot somente em sprint futura que defina contrato de endpoint.
- Integrar o dashboard apenas depois da existencia desse endpoint publico.

## Dashboard operacional

Responsabilidade:

- Expor uma interface operacional pessoal para consultar a API existente.
- Disparar pipeline, consultar jobs, gerar copies manuais e administrar destinos
  WhatsApp sem alterar regras do backend.
- Mostrar estados indisponiveis quando a API nao possui endpoint para o dado.

Entradas:

- `NEXT_PUBLIC_API_URL`, com padrao local `http://localhost:3333`.
- Endpoints publicos de health, pipeline, copy e WhatsApp.
- Produtos derivados apenas de dispatches quando presentes.

Saidas:

- Paginas de visao geral, produtos, pipeline, copies, WhatsApp e configuracoes.
- Estados de loading, empty, erro, sucesso e retry manual.
- Polling moderado de jobs ativos com cleanup ao desmontar a tela.

Dependencias:

- Next.js App Router em `apps/dashboard`.
- TypeScript e Tailwind.
- `lucide-react` para icones.
- Camada centralizada em `apps/dashboard/lib/api`.
- Testes Vitest/jsdom com fetch e funcoes da API mockados.

Restricoes:

- Nao acessar Prisma, Redis ou BullMQ diretamente pelo dashboard.
- Nao expor `EVOLUTION_API_KEY` ou segredos no frontend.
- Nao criar acoes sem endpoint existente, como envio manual real ou
  reprocessamento manual de dispatch.
