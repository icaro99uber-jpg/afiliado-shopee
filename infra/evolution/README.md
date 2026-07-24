# Evolution API local

Esta pasta executa uma Evolution API isolada para desenvolvimento e teste
controlado. A stack nao cria instancia, nao gera QR Code, nao conecta WhatsApp e
nao envia mensagens automaticamente.

## Servicos

- `shopee-evolution-api`: API HTTP v2.3.6, publicada somente em
  `http://localhost:8080` por padrao.
- `shopee-evolution-postgres`: banco persistente exclusivo da Evolution API,
  acessivel apenas pelos containers da rede local.
- `shopee-evolution-redis`: cache persistente exclusivo da Evolution API,
  acessivel apenas pelos containers da rede local.

PostgreSQL e Redis nao possuem portas publicadas no host. A stack usa a rede
`shopee-evolution-local-network` e volumes com prefixo `shopee-evolution-*`, sem
compartilhar dados com o compose principal do projeto.

## Versao e licenca

A imagem fixada e `evoapicloud/evolution-api:v2.3.6`. O namespace e a tag foram
confirmados na [release oficial 2.3.6](https://github.com/EvolutionAPI/evolution-api/releases/tag/2.3.6),
no [compose oficial da tag](https://github.com/EvolutionAPI/evolution-api/blob/2.3.6/docker-compose.yaml)
e na [documentacao oficial da troca de namespace](https://github.com/EvolutionAPI/docs-evolution/pull/19/files).
A 2.3.6 e a ultima release estavel da linha 2.3.x, incorpora a correcao da
migracao Kafka publicada oficialmente na 2.3.5 e nao exige a ativacao remota
obrigatoria introduzida na 2.4.0. A tentativa inicial com 2.3.4 confirmou a
falha de migracao corrigida pela release seguinte; nenhum dado de usuario havia
sido criado e os volumes locais novos foram recriados.

A 2.3.6 declara Apache 2.0 com condicoes adicionais: a marca/copyright do
frontend nao deve ser removida e o uso da Evolution API deve ser informado aos
administradores e na documentacao/configuracoes do sistema. O uso que descumprir
essas condicoes pode exigir licenca comercial. Consulte a
[licenca oficial da tag](https://github.com/EvolutionAPI/evolution-api/blob/2.3.6/LICENSE).

A configuracao usa somente nomes presentes no `.env.example` e no codigo da tag
oficial 2.3.6. Essa versao autentica pela `AUTHENTICATION_API_KEY` e seleciona o
banco com `DATABASE_PROVIDER`; `AUTHENTICATION_TYPE` e `DATABASE_ENABLED` nao
fazem parte desse contrato e foram omitidas intencionalmente.

## Primeiro uso

Requisitos: Docker Engine, Docker Compose, Node.js 20+ e pnpm 9+.

```powershell
pnpm evolution:init
pnpm evolution:config
pnpm evolution:pull
pnpm evolution:up
```

`pnpm evolution:init` cria `infra/evolution/.env.local` uma unica vez, gera uma
API key e uma senha PostgreSQL aleatorias e nao mostra seus valores. O arquivo e
local, esta ignorado pelo Git e nunca pode ser enviado ao GitHub. Para trocar a
porta publica antes do primeiro `up`, edite apenas `EVOLUTION_HOST_PORT` e
`SERVER_URL` nesse arquivo local.

## Operacao

```powershell
pnpm evolution:status
pnpm evolution:logs
pnpm evolution:restart
pnpm evolution:down
```

- `status` mostra containers, saude e porta publica.
- `logs` mostra as ultimas 200 linhas sem imprimir o ambiente dos containers.
- `restart` reinicia os tres servicos sem apagar volumes.
- `down` para e remove containers e rede, preservando os volumes.

Para apagar dados persistentes seria necessario usar uma operacao destrutiva
explicita com volumes; ela nao faz parte dos scripts deste projeto.

## Validacao segura

Na versão 2.3.6 nao existe uma rota dedicada `/health` ou `/server/ok`. A rota
publica `/` e o status oficial dessa versao e retorna HTTP 200, mensagem de
funcionamento, versao e nome do cliente. O healthcheck do container usa essa
rota.

```powershell
Invoke-RestMethod http://localhost:8080/
```

O CLI do projeto pode validar a configuracao em dry-run, mas suas variaveis
devem ser fornecidas somente por ambiente local ignorado:

```powershell
corepack pnpm evolution:test-message
```

O `sendText` da imagem 2.3.6 usa o corpo plano `{ "number", "text" }`. O
provider nao tenta o formato `textMessage` como fallback, pois uma segunda
requisicao poderia duplicar a entrega. O unico caminho confirmado e
`corepack pnpm evolution:test-message -- --confirm-one-real-message`; ele exige
safe mode ativo, exatamente um destino permitido, limite 1 e Scheduler
desativado. Timeout, erro de rede, HTTP 5xx ou resultado ambiguo nunca devem ser
seguidos de retry manual ou automatico.

Na validacao da Task 13.4, a API e a instancia estavam saudaveis/conectadas, mas
o dry-run foi bloqueado porque a configuracao ignorada selecionava `mock` e
mantinha a allowlist vazia. Nenhuma mensagem real foi enviada e nenhum segredo
foi versionado.

## Teste E2E controlado de dispatch

O comando abaixo valida o fluxo real de dispatch em dry-run por padrao:

```powershell
corepack pnpm whatsapp:e2e-test
```

Ele exige a Evolution local em `http://localhost:8080`, versao 2.3.6 e instancia
`afiliado-shopee-local` em estado `open`, alem do PostgreSQL e Redis do compose
principal. O `.env` da raiz e carregado sem alterar o arquivo ou substituir
variaveis de processo. O resumo mascara o unico destino permitido.

O unico modo confirmado e:

```powershell
corepack pnpm whatsapp:e2e-test -- --confirm-one-real-dispatch
```

O comando cria no maximo um conjunto deterministico de registros E2E, um
dispatch e um job `whatsapp-dispatch`. O job usa uma tentativa, sem backoff e
sem remocao automatica; somente o consumer de dispatch e iniciado. Scheduler e
pipeline permanecem desativados. A mensagem e fixa e nenhum destino ou texto
pode ser recebido por argumento.

Qualquer execucao anterior ou resultado ambiguo bloqueia nova tentativa. Nao
repita o comando confirmado apos timeout, erro de rede, HTTP 5xx, `FAILED` ou
duvida sobre o resultado. Consulte o dispatch tecnico pelo endpoint existente;
o detalhe mascara o destino. API key, telefone, token, sessao e external ID
completo nao devem aparecer em documentacao ou relatorios.

Na preparacao da Task 13.5, esta stack e a instancia foram confirmadas como
saudaveis/open. O `.env` raiz continuou selecionando mock, instancia de exemplo
e allowlist vazia, portanto o teste ficou bloqueado antes de criar registros ou
enviar mensagem. Resultado sanitizado: zero mensagens reais.

## Proximo passo manual e controlado

Uma task futura e separada deve revisar a instancia ficticia, o ambiente, a
allowlist exata e o limite de um request antes de qualquer teste. Somente depois
dessa revisao uma pessoa pode criar manualmente uma instancia e decidir se vai
conectar uma conta. Esta infraestrutura nao executa essas acoes, nao acessa
endpoints de instancia ou QR Code e nao chama endpoints de mensagem.
