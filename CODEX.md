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
6. Processar os envios via fila usando provider mock.

O estado atual nao executa scraping real, nao usa OpenAI real e nao envia mensagens reais por WhatsApp.

## Arquitetura atual

- Monorepo: gerenciado por `pnpm-workspace.yaml` e `turbo.json`.
- API: Fastify em `apps/api`, expondo endpoints de health, Hunter, Score, Copy, Pipeline e WhatsApp.
- Worker: BullMQ em `apps/worker`, consumindo filas de pipeline e dispatch.
- Dashboard: Next.js App Router em `apps/dashboard`.
- Banco: Prisma Client e schema PostgreSQL em `packages/database`.
- Filas: BullMQ/Redis em `packages/queue`.
- Agentes: contratos e implementacoes iniciais em `packages/agents`.
- Providers: contratos e mocks para Shopee, OpenAI, Evolution API e WhatsApp em `packages/providers`.
- Configuracao: validacao de variaveis de ambiente com Zod em `packages/config`.
- Shared: tipos, erros e utilitarios comuns em `packages/shared`.

Fluxo operacional atual:

1. `POST /pipeline/run` enfileira um job `pipeline-product`.
2. O worker consome `product-pipeline`.
3. `PipelineService` executa Hunter, Score e Copy.
4. Produtos com `score >= 70` sao considerados aprovados.
5. Para cada copy e destino ativo, o pipeline cria `WhatsAppDispatch` com status `PENDING`.
6. O pipeline enfileira jobs `whatsapp-dispatch`.
7. O worker usa `SenderService` e `MockWhatsAppProvider` para marcar dispatches como `SENT` ou `FAILED`.

## Estrutura de pastas

```text
apps/
  api/         API Fastify, servicos de dominio e testes da API.
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
- Registrar eventos relevantes com logs estruturados nos servicos e workers.
- Evitar acoplamento direto entre endpoints e detalhes de infraestrutura quando ja houver servico dedicado.
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
