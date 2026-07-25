# Fundação Shopee Affiliate Open API

Esta fundação prepara ofertas, importação manual, cupons e preview de copy sem
credenciais e sem chamadas reais à Shopee. Scraping, automação de navegador,
endpoints privados/mobile e qualquer tentativa de contornar autenticação são
proibidos.

## Evidência oficial pública

Em 24 de julho de 2026, o
[Explorer oficial V2](https://open-api.affiliate.shopee.com.br/explorer/v2) e a
[documentação oficial do programa](https://affiliate.shopee.com.br/open_api/document?type=overview)
eram as fontes públicas consultadas. O Explorer permite observar a consulta
`productOfferV2` com estes campos:

- `nodes`: `productName`, `itemId`, `commissionRate`, `commission`, `price`,
  `sales`, `imageUrl`, `shopName`, `productLink`, `offerLink`,
  `periodStartTime`, `periodEndTime`, `priceMin`, `priceMax`, `productCatIds`,
  `ratingStar`, `priceDiscountRate`, `shopId`, `shopType`,
  `sellerCommissionRate` e `shopeeCommissionRate`;
- `pageInfo`: `page`, `limit`, `hasNextPage` e `scrollId`.

Esses nomes observáveis fundamentam somente o mapeamento de domínio. Eles não
confirmam semântica, unidade monetária, comportamento de cursor ou contrato de
transporte.

Não estão confirmados para esta conta: URL GraphQL de transporte, algoritmo de
assinatura, headers de autenticação, formato definitivo de App ID/Secret, rate
limits, paginação real além dos campos visíveis e endpoint oficial de cupons.

**Autenticação e transporte real aguardam credenciais e documentação liberada para a conta.**

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
- `OfficialShopeeAffiliateOfferProvider`: boundary com `transport` e `signer`
  injetáveis. Sem configuração retorna `SHOPEE_API_NOT_CONFIGURED`; mesmo com
  placeholders completos, o transporte permanece bloqueado por
  `SHOPEE_API_TRANSPORT_PENDING` até a Task 15.2.

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
URL, App ID e Secret; nenhum desses valores é aceito por endpoint público ou
renderizado no dashboard. Os nomes são internos e poderão ser mapeados ao
contrato oficial depois da liberação da conta.

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

## Task 15.2

Depois da liberação de credenciais e documentação da conta:

1. confirmar contrato de autenticação, assinatura, headers e transporte;
2. mapear os nomes internos de configuração sem expor segredo;
3. implementar `transport` e `signer` oficiais com testes HTTP injetados;
4. validar paginação, unidades, rate limits e erros documentados;
5. executar uma única sincronização real controlada, sem pipeline ou envio;
6. avaliar cupons somente se existir endpoint oficial documentado.
