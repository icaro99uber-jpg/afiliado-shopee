# Fundação Shopee Affiliate Open API

Esta fundação prepara ofertas, importação manual, cupons e preview de copy.
Scraping, endpoints privados/mobile e qualquer tentativa de contornar
autenticação são proibidos. A captura documental local da Sprint 18.1 limita a
automação aos dois hosts oficiais, usa perfil efêmero e persiste somente
evidência sanitizada em diretório ignorado pelo Git.

## Evidência oficial pública

Em 28 de julho de 2026, o
[Explorer oficial V2](https://open-api.affiliate.shopee.com.br/explorer/v2) e a
[documentação oficial do programa](https://affiliate.shopee.com.br/open_api/document?type=overview)
foram renderizados nos hosts oficiais. O Explorer confirma a consulta
`productOfferV2` com estes campos:

- `nodes`: `productName`, `itemId`, `commissionRate`, `commission`, `price`,
  `sales`, `imageUrl`, `shopName`, `productLink`, `offerLink`,
  `periodStartTime`, `periodEndTime`, `priceMin`, `priceMax`, `productCatIds`,
  `ratingStar`, `priceDiscountRate`, `shopId`, `shopType`,
  `sellerCommissionRate` e `shopeeCommissionRate`;
- `pageInfo`: `page`, `limit`, `hasNextPage` e `scrollId`.

O contrato de
[requisição e resposta](https://affiliate.shopee.com.br/open_api/document?type=request_response)
confirma `POST https://open-api.affiliate.shopee.com.br/graphql`, body JSON com
`query`, `operationName` opcional e `variables` opcionais, e envelope GraphQL
`data`/`errors`, inclusive quando o HTTP é 200. O content type é
`application/json`.

A página oficial de
[autenticação](https://affiliate.shopee.com.br/open_api/document?type=authentication)
confirma o header:

```text
Authorization: SHA256 Credential=<AppId>, Timestamp=<Unix-seconds>, Signature=<sha256-hex-lowercase>
```

O material assinado, sem separadores adicionais, é `AppId + Timestamp + body
JSON exato + Secret`. O timestamp usa segundos Unix e pode diferir no máximo
dez minutos do servidor. A fixture pública oficial foi reproduzida em teste
determinístico; seus valores demonstrativos não são configuração local.

O limite documentado é 8.000 chamadas por hora. `scrollId` é de uso único,
expira em 30 segundos e deve ser usado na página seguinte; uma nova consulta
sem cursor deve respeitar intervalo superior a 30 segundos. O limite oficial
por página é 500, mas o comando controlado desta sprint fixa uma página e no
máximo cinco produtos, concurrency 1 e nenhum retry.

O Explorer descreve dinheiro como string na moeda local e taxas como razão
decimal (`0.0123` representa `1.23%`). A unidade de `periodStartTime` e
`periodEndTime` ainda precisa ser confirmada pela única resposta real
sanitizada; ela não é deduzida da nomenclatura. A documentação observada não
define restrições adicionais para o formato do App ID além do identificador
fornecido pelo portal, nem confirmou endpoint de cupons nesta sprint.

## Arquitetura

`ShopeeAffiliateOfferProvider` é independente de HTTP e Prisma e expõe
`listProductOffers(input)`. O contrato interno não replica argumentos GraphQL e
usa strings decimais para dinheiro. Percentuais e contagens continuam
numéricos.

Providers disponíveis:

- `MockShopeeAffiliateOfferProvider`: padrão, determinístico, somente dados e
  URLs `example.invalid`, com filtros e paginação local; nunca acessa internet.
- `ManualShopeeAffiliateOfferProvider`: valida JSON/CSV local, exige link
  afiliado explícito e nunca consulta ou completa uma página de produto.
- `OfficialShopeeAffiliateOfferProvider`: signer SHA-256 puro, clock e `fetch`
  injetáveis, timeout/abort, limite de resposta e erros públicos sanitizados.
  Sem configuração retorna `SHOPEE_API_NOT_CONFIGURED`; a URL aceita é apenas o
  endpoint oficial confirmado.

`ShopeeOfferSyncService` consulta no máximo
`SHOPEE_AFFILIATE_SYNC_LIMIT` registros por execução, valida, ignora expirados,
deduplica por `source + providerProductId` e cria ou atualiza o mesmo
`ProductLead`. Ele não chama Copy, Pipeline, BullMQ, Scheduler ou WhatsApp.

## Configuração

```env
SHOPEE_AFFILIATE_PROVIDER=mock
SHOPEE_AFFILIATE_API_ENABLED=false
SHOPEE_AFFILIATE_APP_ID=
SHOPEE_AFFILIATE_SECRET=
SHOPEE_AFFILIATE_API_URL=
SHOPEE_AFFILIATE_SUB_ID_PREFIX=whatsapp
SHOPEE_AFFILIATE_SYNC_LIMIT=20
```

Valores de provider: `mock`, `manual` e `official`. `official` exige enabled,
URL oficial exata, App ID e Secret; nenhum desses valores é aceito por endpoint
público ou renderizado no dashboard. `shopee:official:configure` grava somente
o `.env` raiz ignorado, por entrada local oculta e escrita atômica.

Comandos operacionais da Sprint 18.1:

```powershell
corepack pnpm shopee:official:capture-contract
corepack pnpm shopee:official:configure
corepack pnpm shopee:official:preflight
corepack pnpm shopee:official:sync -- --confirm-one-real-read
```

O capture usa perfil efêmero, não salva screenshots, HAR, storage, cookies ou
headers brutos e bloqueia POST GraphQL antes da rede. O preflight não lista
produtos e exige preview, ambos os Schedulers desligados, automação desabilitada
e pausada, envio em grupo desligado e nenhum worker/job ativo de dispatch. O
sync mantém um marcador local ignorado antes do único request, limita a cinco
itens e compara contagens comerciais antes/depois.

## Importação manual

JSON aceita um objeto ou um array. O exemplo versionado em
`fixtures/shopee-manual-offer.example.json` é totalmente fictício. Campos
obrigatórios:

```json
{
  "providerProductId": "manual-001",
  "productName": "Produto de teste ficticio",
  "shopName": "Loja de teste ficticia",
  "categoryIds": ["categoria-ficticia"],
  "price": "99.90",
  "discountRate": 20,
  "rating": 4.8,
  "sales": 1000,
  "commissionRate": 8,
  "imageUrl": "https://example.invalid/image.jpg",
  "productLink": "https://example.invalid/product/manual-001",
  "affiliateLink": "https://example.invalid/affiliate/manual-001"
}
```

Para CSV, use esses nomes como cabeçalho; `categoryIds` usa `;` para separar
valores. Datas opcionais devem ser ISO 8601. URLs precisam usar HTTP/HTTPS e
`affiliateLink` deve ser obtido manualmente no portal/app. Um link comum nunca é
convertido automaticamente.

Dry-run, padrão e sem banco:

```powershell
corepack pnpm shopee:import -- --file fixtures/shopee-manual-offer.example.json
```

Persistência exige a flag exata:

```powershell
corepack pnpm shopee:import -- --file caminho.json --confirm-import
```

## API local

- `POST /shopee/offers/sync`: sincroniza o provider selecionado sem pipeline.
- `GET /shopee/offers`: paginação e filtros por texto, origem, status e presença
  de link afiliado.
- `GET /shopee/offers/:id`: detalhe público sem segredos.
- `POST /shopee/offers/import/validate`: valida e retorna preview; não grava.
- `POST /shopee/offers/import`: grava somente com
  `confirm: "CONFIRMAR_IMPORTACAO"`.
- `POST /shopee/offers/:id/copy-preview`: gera `PREVIEW — NAO ENVIADO`, sem
  persistir copy ou criar dispatch.
- `GET|POST|PATCH|DELETE /coupons`: CRUD manual; criação/alteração e exclusão
  exigem confirmações explícitas.

O dashboard Produtos consome essas rotas, e a página Cupons gerencia somente
registros locais confirmados.

## Persistência e score

`ProductLead` preserva seu ID e relações com copies/dispatches em atualizações.
Preço, faixas e valor de comissão usam `Decimal`; percentuais permanecem
numéricos. Produtos não são apagados automaticamente. `lastSeenAt` registra a
última observação e `unavailableAt` fica disponível para uma política futura
explícita.

A fórmula de score permanece:

- comissão: 35%, normalizada entre 0 e 20%;
- avaliação: 25%, normalizada entre 0 e 5;
- vendas: 20%, normalizada entre 0 e 10.000;
- desconto: 10%, normalizado entre 0 e 100%;
- loja oficial: 10%, conforme a regra textual preexistente.

Preço não recebeu peso arbitrário. Oferta expirada ou indisponível é
inelegível, e a listagem para score exclui esses registros. Não há métrica de
conversão inventada.

## Links, Sub_ids e cupons

Links manuais são preservados exatamente. Metadados planejados para Sub_ids
mantêm separadamente `channel`, fingerprint do grupo, campanha e data; o
utilitário não concatena parâmetros em URLs.

O modelo `Coupon` aceita origem `MANUAL` ou `OFFICIAL`, mas somente CRUD manual
está ativo. Cupom vencido, inativo ou com compra mínima não atendida é
inelegível. O sistema não calcula preço final quando falta o valor da compra,
não coleta cupons e não inclui cupom automaticamente na copy nesta task.

## Sprint 18.1

Contrato, signer, transporte, mapeamento, configuração e guardas operacionais
foram implementados com fixtures oficiais e HTTP mockado. A única sincronização
real controlada permanece a etapa que confirma tipos opcionais e unidade dos
timestamps; nenhuma segunda chamada pode ser feita por conveniência. Cupons
continuam fora do escopo enquanto não houver endpoint oficial confirmado.

## Pipeline comercial dry-run — Task 16.1

`CommercialPipelineService` prepara uma unica oportunidade comercial sem chamar
o pipeline legado. O fluxo consulta o catalogo persistido, aplica filtros de
origem `MOCK` ou `MANUAL`, valida elegibilidade, reutiliza exclusivamente
`ScoreService.calculate`, ordena os candidatos e escolhe exatamente um grupo
ativo/disponivel da instancia atual. O servico depende somente de contratos e
nao importa Prisma, Fastify, BullMQ, Evolution ou WhatsApp.

Valores padrao: origem `MOCK`, score minimo 70 e no maximo 20 candidatos. O
limite absoluto e 100. Produto sem link afiliado, expirado, indisponivel,
invalido ou abaixo do score minimo recebe motivo estruturado. Links devem ser
HTTP/HTTPS e nunca sao modificados.

O ranking e deterministico, nesta ordem:

1. maior score;
2. maior taxa de comissao;
3. maior numero de vendas;
4. maior desconto;
5. maior avaliacao;
6. `providerProductId` em ordem lexicografica.

Depois do ranking, `CommercialDeliveryHistoryRepository` descarta produtos que
ja tenham `WhatsAppDispatch` `SENT` para o grupo ou execucao futura `CONFIRMED`
concluida. Registros `DRY_RUN` nunca contam como envio e o historico nao e
apagado.

A selecao de destino aceita somente um registro `GROUP`, `active=true`,
`available=true`, da instancia atual e com fingerprint valido. Zero grupos
retorna `NO_AUTHORIZED_GROUP`; mais de um retorna
`MULTIPLE_AUTHORIZED_GROUPS`. O identificador externo nunca aparece no resultado
ou no historico.

A copy comercial usa somente nome, preco formatado em pt-BR, desconto opcional,
loja, CTA e o `affiliateLink` persistido. Ela nao usa cupom, comissao, score,
IDs tecnicos, alegacoes nao verificadas ou urgencia falsa. O limite padrao e
`COMMERCIAL_COPY_MAX_LENGTH=1000`.

Metadados de tracking reutilizam `buildShopeeAffiliateTrackingMetadata` e
`toPlannedShopeeSubIds`. Canal, fingerprint, campanha e data sao retornados em
`plannedSubIds`; nenhum parametro e concatenado ao link.

Cada tentativa valida cria um `CommercialPipelineRun` `DRY_RUN`. Estados
concluidos, bloqueados e falhos guardam apenas produto/grupo sanitizados, score,
contagens, resumo de rejeicoes, copy, Sub_ids planejados e codigo publico. Nao
sao armazenados JID, telefone, credencial, payload Evolution ou participantes.

Rotas:

- `POST /commercial-pipeline/dry-run`;
- `GET /commercial-pipeline/runs`;
- `GET /commercial-pipeline/runs/:id`.

Comando local:

```powershell
corepack pnpm commercial:dry-run
corepack pnpm commercial:dry-run -- --source=mock --minimum-score=70 --campaign=teste-local
```

O CLI carrega o `.env` ignorado, acessa somente PostgreSQL, sincroniza dados
ficticios quando o provider e mock e bloqueia provider official, Scheduler ou
envio para grupos ativos. Flags de envio, confirmacao, grupo, mensagem, destino
ou cupom sao rejeitadas.

O resultado fixa `dispatchWillBeCreated=false`, `jobWillBeCreated=false` e
`messageWillBeSent=false`. Nao ha endpoint confirmado e nenhuma acao desta task
chama Shopee real, Evolution, Redis, worker ou fila.

## Pipeline comercial confirmado — Task 16.2

`POST /commercial-pipeline/runs/:id/confirm` confirma somente um dry-run
`COMPLETED` existente e aceita exclusivamente
`CONFIRMAR_ENVIO_COMERCIAL`. O proprio run muda para `CONFIRMED`; produto,
grupo, copy e Sub_ids permanecem os snapshots aprovados.

Antes do dispatch, o fluxo revalida a oferta `MOCK` ou `MANUAL`, o link, a copy,
o unico grupo autorizado da instancia, o historico de entrega, safe mode,
master switch, Scheduler desligado e limite de uma mensagem. Nenhum ranking e
executado e nenhum outro produto/grupo e escolhido.

Copy tecnica, dispatch e job possuem IDs deterministicos ligados ao `dryRunId`.
A reivindicacao atomica e a existencia de qualquer um desses registros bloqueiam
repeticao. O job `whatsapp-dispatch` tem uma tentativa, sem backoff ou remocao.
O worker existente finaliza o run; timeout, falha e ambiguidade nunca geram
retry e registram investigacao obrigatoria.

Comando controlado:

```powershell
corepack pnpm commercial:confirm -- --run-id=<id> --confirm-one-real-commercial-message
```

O comando carrega o `.env` ignorado sem imprimi-lo, bloqueia CI, provider Shopee
official, Scheduler, safe mode falso, master switch desligado, limites diferentes
de 1 e workers concorrentes. Ele inicia somente o consumer de dispatch. Cupons,
scraping, API oficial da Shopee, Hunter, Score, Copy legado, pipeline-product e
Scheduler continuam fora do fluxo.
