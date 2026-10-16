# Гайд для агентов

Этот гайд для разработчиков ИИ-агентов, которые бронируют поездки, планируют путешествия или
выполняют поручения. Ваш агент может найти eSIM для поездки в нужную страну, купить её одним
платежом x402 в USDC в сети Base и отдать путешественнику QR-код. Без аккаунта, без API-ключа, без
страницы оплаты.

Каждый продавец на [ките eSIM-оператора](../../README.ru.md) отвечает на одни и те же три вызова по адресу
`https://<домен продавца>/agents/`. Чтобы попробовать прямо сейчас, используйте демо-узел
`https://modelmarket.dev/providers/esim`: он отдаёт живые цены, основанные на оптовых, и отклоняет
заказы с ошибкой `demo_mode`.

Другие документы: [обзор](../../README.ru.md) · [гайд оператора](operator-guide.md) · [онбординг](rails.md) · [интеграции](integrations.md) · [SDK](sdk.md)

## Три возможности

| Возможность | Маршрут | Цена | Что делает |
|---|---|---|---|
| `esim.quote@v1` | `POST /agents/quote` | бесплатно | Предложения, покрывающие страну, от дешёвых к дорогим. Региональные и глобальные тарифы, в которые входит страна, тоже считаются. |
| `esim.order@v1` | `POST /agents/order` | цена предложения, x402 | Покупает одну eSIM. В ответе код активации, ссылка на QR, ссылка установки, ICCID и статус-токен. |
| `esim.status@v1` | `POST /agents/status` | бесплатно | Состояние, расход трафика, срок действия и снова код активации — для владельца статус-токена. |
| возврат | `POST /agents/refund` | бесплатно | Возвращает деньги за неиспользованную eSIM на адрес, с которого платили, владельцу статус-токена. |

`GET /agents/listing.json` описывает все три, вместе с публичным ключом продавца.

## 1. Найдите продавца

- **Продавец известен.** Используйте `https://<домен>/agents/`.
- **Через хаб AIMarket.** Подключите MCP-сервер хаба (`https://modelmarket.dev/mcp`) и вызовите `market_search` с намерением вроде `"travel eSIM data plan for France"`. Совпадения для `esim.quote@v1` дают `product_id` и `source_hub`. Вызовите с ними и входом запроса `market_invoke`: ответ такой же, как ниже, и в нём есть адрес заказа у продавца. Хаб показывает продавцов, чьи узлы он принял. Оплата за eSIM никогда не идёт через хаб: вы платите продавцу напрямую.

## 2. Получите предложения

```bash
curl -s -X POST https://modelmarket.dev/providers/esim/quote \
  -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

| Вход | Тип | |
|---|---|---|
| `country` | строка, обязательно | Код страны назначения по ISO 3166-1 alpha-2: `FR`, `JP`, `US`. |
| `min_gb` | число | Минимальный объём трафика. |
| `min_days` | целое | Минимальный срок действия. |
| `max_usd` | число | Максимальная цена. |
| `limit` | целое, от 1 до 50 | Сколько предложений вернуть. |

Всегда передавайте `min_gb` и `min_days` из параметров поездки. Без них самым дешёвым часто оказывается тариф на 0.5 ГБ на один день.

Ответ (одно предложение, списки сокращены):

```json
{
  "success": true,
  "result": {
    "seller": { "name": "modelmarket.dev demo seller", "product_id": "esim-modelmarket", "demo": true },
    "offers": [
      {
        "offer_id": "EU-33_3_15",
        "name": "Europe (33 areas) 3GB 15Days",
        "coverage": { "kind": "region", "countries": ["NO", "DE", "BE", "FI", "…"] },
        "data_bytes": 3221225472,
        "data_gb": 3,
        "days": 15,
        "speed": "3G/4G/5G",
        "networks": [{ "country": "Austria", "operators": [{ "name": "A1.net", "type": "5G" }] }],
        "top_up": true,
        "unused_valid_days": 180,
        "price": { "usd": "2.03", "currency": "USDC" },
        "usd_per_gb": 0.68
      }
    ],
    "order": { "url": "https://modelmarket.dev/providers/esim/order", "method": "POST", "payment": "x402, USDC on Base" },
    "catalogue_at": "2026-10-14T10:32:44.619Z"
  }
}
```

- `coverage.kind` — `country`, `region` или `global`.
- `unused_valid_days`: eSIM нужно установить и впервые использовать в течение стольких дней после покупки.
- `networks` перечисляет операторов по странам и лучший тип их сети.
- `order.url` — где покупается это предложение.

## 3. Проверьте подпись продавца (необязательно)

Бесплатные ответы несут `X-Provider-Signature`: подпись Ed25519 в base64 над каноническим JSON
`{capability_id, product_id, input_sha256, result}`. В канонической форме ключи отсортированы,
пробелов нет, символы не из ASCII записаны как есть. `input_sha256` — SHA-256 в hex от
канонического входа. Публичный ключ и `product_id` есть в `/agents/listing.json`. Хабы проверяют эту
подпись сами. Когда обращаетесь к продавцу напрямую, проверяйте её сами:

```js
import { createHash, createPublicKey, verify } from "node:crypto";

const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);

export function signedBySeller({ pubkey, capabilityId, productId, input, result, signature }) {
  const input_sha256 = createHash("sha256").update(canonical(input)).digest("hex");
  const bytes = Buffer.from(canonical({ capability_id: capabilityId, product_id: productId, input_sha256, result }));
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubkey, "base64")]);
  return verify(null, bytes, createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(signature, "base64"));
}
```

## 4. Купите

`POST <order.url>` с `{"offer_id": "<из предложения>"}`. Первый ответ — `402 Payment Required` с
условиями x402 v2: схема `exact`, сеть `eip155:8453` (Base), USDC, цена предложения, получатель —
продавец. Заплатить может любой клиент x402 v2. Ваш кошелёк подписывает авторизацию EIP-3009 и не
платит за газ. На TypeScript с пакетами x402:

```bash
npm i @x402/fetch @x402/evm viem
```

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);   // кошелёк с USDC в Base

// Запоминаем заголовок платежа, который отправляет обёртка: повтор должен нести тот же платёж, а не новый.
let paidHeaders = null;
const keepPayment = (input, init) => {
  const req = new Request(input, init);
  if (req.headers.has("PAYMENT-SIGNATURE")) paidHeaders = new Headers(req.headers);
  return fetch(req);
};
const payingFetch = wrapFetchWithPaymentFromConfig(keepPayment, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
});

export async function buyEsim(orderUrl, offerId) {
  const body = JSON.stringify({ offer_id: offerId });
  let res = await payingFetch(orderUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  // 503 allocation_pending: eSIM заказана, но ещё не готова. Тот же платёж, чуть позже.
  for (let i = 0; i < 6 && res.status === 503 && paidHeaders; i++) {
    await new Promise((r) => setTimeout(r, 1000 * Number(res.headers.get("retry-after") || 20)));
    res = await fetch(orderUrl, { method: "POST", headers: paidHeaders, body });
  }
  if (res.status === 402) {   // a refused payment says why in the x402 header, not in the body
    const terms = res.headers.get("payment-required");
    throw new Error(`402 ${terms ? JSON.parse(Buffer.from(terms, "base64").toString("utf8")).error : "payment required"}`);
  }
  const answer = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${answer.error}: ${answer.message}`);
  return answer.result;
}
```

**За что списываются деньги.** Продавец проверяет платёж, покупает eSIM и проводит платёж только после того, как eSIM создана. Отклонённый заказ ничего не стоит. Заказ, который ещё готовится (`503 allocation_pending`), пока не оплачен; тот же платёж, отправленный снова, забирает ту же eSIM и никогда вторую. При неопределённом результате возвращается `settlement_pending`: не платите повторно, обратитесь к продавцу.

Ответ:

```json
{
  "success": true,
  "result": {
    "order_no": "B26101410460022",
    "esim_tran_no": "26101410460022",
    "iccid": "8985…",
    "activation_code": "LPA:1$…",
    "qr_code_url": "https://…",
    "install_url": "https://…",
    "apn": "internet",
    "expires": "2027-04-12T10:46:24+0000",
    "status_token": "…",
    "offer": { "offer_id": "TR_0.5_1", "name": "Turkey 500MB 1Day", "…": "…" }
  }
}
```

**Код активации — секрет.** Любой, у кого он есть, может установить eSIM. Отдавайте его, ссылку на
QR и ссылку установки только путешественнику. Не пишите их в логи и не кладите в общий чат, тикет
или событие календаря. Сохраните `esim_tran_no` и `status_token`, чтобы проверять eSIM позже.

## 5. Ошибки

| Статус | `error` | Значение | Что делать |
|---|---|---|---|
| 400 | `unknown_offer` | Такого `offer_id` нет в каталоге (уже нет). | Запросите предложения снова. |
| 402 | (условия x402) | Нужна оплата, или платёж отклонён: не та сумма, не хватает USDC, истёк срок. | Заплатите или исправьте кошелёк. |
| 402 | `self_send_not_allowed` | Кошелёк плательщика — это адрес самого продавца: фасилитатор не принимает оплату самому себе. | Платите с другого кошелька. |
| 402 | `invalid_exact_evm_insufficient_balance` | На кошельке плательщика меньше USDC в Base, чем цена. | Пополните кошелёк. |
| 403 | `demo_mode` | Демо-узел. Он ничего не продаёт. | Используйте продавца, который продаёт. |
| 409 | `supplier_<code>` | Оптовик отклонил заказ: тариф снят, цена изменилась. Деньги не списаны. | Запросите предложения снова. |
| 503 | `allocation_pending` | Заказано, ещё не готово. Пока не оплачено. | Тот же платёж через `Retry-After` секунд (пример выше). |
| 503 | `catalogue_unavailable`, `payments_off` | Продавец сейчас не может продавать. | Другой продавец или позже. |
| 500 | `internal_error` | Заказ не удался. Деньги не списаны. | Позже или другой продавец. |

### Настоящая покупка, шаг за шагом

Отклонённый платёж объясняет причину в поле `error` заголовка `PAYMENT-REQUIRED` (base64 JSON), а
не в теле ответа. Первая покупка агентом через кит, 2026-10-14 на закрытом тестовом узле, показывает
оба ответа: оплата с кошелька самого продавца отклонена; оплата с другого кошелька выдана за секунды
и проведена в Base.

```text
$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
offer    TR_0.5_7 — Turkey 500MB 7Days — 0.31 USDC
payer    0x1218…Ad0a          ← кошелёк самого продавца
402 payment refused: self_send_not_allowed (a payment was attached)

$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
payer    0x9d24…66eF          ← другой кошелёк
delivered  esim_tran_no 26101413070046 · iccid 8997… · apn internet
activation LPA:1$rsp-eu.s… (the traveller's secret)
settled    0xe61f194b44148c5aba91bde2dbe106d2b7e5317233881a8bd245b994cc280982
```

`rails/examples/agent-buy.mjs` — этот покупатель, готовый к запуску. Он запрашивает предложения,
показывает цену и платит только с `--yes`:

```bash
cd rails
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json         # цены у всех продавцов, которых знает хаб
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json --yes   # покупка у самого дешёвого продавца, который продаёт
node examples/agent-buy.mjs https://<seller>/agents TR --key-file ~/agent-wallet.json --yes        # один продавец, без хаба
```

| Параметр | Что делает |
|---|---|
| `--hub <url>` | Ищет продавцов через этот хаб и пропускает тех, кто в демо-режиме. |
| `--key-file <file>` | Кошелёк агента, `{"private_key": "0x…"}`. Никогда не печатается. `AGENT_PRIVATE_KEY` тоже работает. |
| `--min-gb`, `--days` | Что нужно для поездки. |
| `--max-usd` | Сколько может стоить один платёж, по умолчанию 1. Больше клиент x402 не подпишет. |
| `--refund` | Сразу после доставки просит деньги назад: для теста. |
| `--no-share` | Не сообщает хабу о покупке: квитанции туда не уходят. |

Держите ключ агента в отдельном кошельке с небольшим балансом, в файле, который можете читать только
вы (`chmod 600`), и никогда не вставляйте приватный ключ в чат, тикет или документ. Покупка этой
командой из терминала агента для разработки, с возвратом и всеми транзакциями, — это
[кейс 3](cases.md).

### Квитанция: покажите хабу, что вы получили eSIM

В каждой доставке есть `receipt` и `receipt_signature`: то, что продавец подписывает в подтверждение
доставки, без каких-либо секретов eSIM (поля — в [кейсах](cases.md), раздел 11.4). Если вы нашли
продавца через хаб, принесите в этот хаб и то и другое вместе с транзакцией платежа. Хаб проверит
подпись и перевод ончейн и засчитает продавцу одну подтверждённую доставку:

```bash
curl -s -X POST https://modelmarket.dev/ai-market/v2/reputation/deliveries -H 'content-type: application/json' \
  -d '{"receipt": {…}, "signature": "<receipt_signature>", "transaction": "0x<транзакция платежа>"}'
```

```json
{"recorded": true, "seller": {"source_hub": "https://esim.modelmarket.dev", "product_id": "esim-modelmarket"},
 "kind": "delivery", "deliveries_30d": {"confirmed": 2, "distinct_buyers": 2, "refunded": 1}}
```

Свежему переводу нужно несколько секунд на подтверждения: до этого ответ — `422`, повторите через
десять секунд. Та же транзакция второй раз получает `recorded: false`, квитанции старше 30 дней хаб не
принимает. В результатах поиска тот же `deliveries_30d` есть у каждого листинга продавца: сколько
доставок и возвратов покупатели подтвердили за 30 дней и сколько разных кошельков их подтвердили.
Приносить квитанции или нет — решаете вы: хаб узнаёт, что этот продавец доставил, но никогда не видит
сумму или ваш адрес в открытом виде.

## 6. Помогите путешественнику установить eSIM

- **QR-код показан на другом экране** (`qr_code_url`), телефон его сканирует. iPhone: Настройки → Сотовая связь → Добавить eSIM. Android: обычно Настройки → Сеть и интернет → SIM-карты → Добавить eSIM.
- **На самом телефоне**: `install_url` открывает страницу с QR-кодом и инструкцией по установке. Или код активации вводится вручную: «ввести данные вручную» в том же меню.
- Телефон должен поддерживать eSIM и не быть привязан к оператору.
- Устанавливайте до вылета, по Wi-Fi. По прилёте переключите мобильные данные на линию eSIM и включите для неё роуминг данных. `apn` — имя точки доступа, если телефон его спросит.
- Для большинства тарифов срок считается с первого подключения в зоне покрытия. `unused_valid_days` ограничивает, сколько eSIM может ждать.

## 7. Проверьте расход

```bash
curl -s -X POST https://<seller>/agents/status -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101410460022","status_token":"…"}'
```

В ответе `state` (значение оптовика: `GOT_RESOURCE` значит ещё не установлена; среди других — `IN_USE`, `USED_UP` и `CANCEL`), `installed`, `data_used_bytes`, `data_total_bytes`, `activated`, `expires` и снова поля выдачи. Неверный токен получает `404 not_found`, так же как неизвестная eSIM.

## 8. Получите возврат

Пока eSIM не установлена и не потратила данные, плательщик может её отменить и получить цену назад — с теми же двумя значениями:

```bash
curl -s -X POST https://<seller>/agents/refund -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101505200012","status_token":"…"}'
```

`status` — это `refunded` с транзакцией USDC, возвращённых на адрес плательщика, или `due`, когда продавец платит вручную. Установленная или использованная eSIM получает `409 in_use`. Продавец возвращает один раз за заказ и не больше цены. В ответе о возврате есть квитанция о возврате (`receipt`, `receipt_signature`): принесите её в хаб с транзакцией возврата так же, как квитанцию о доставке. На странице [кейсов](cases.md) — реальные примеры: от покупки агентом до возврата, со всеми транзакциями.

## 9. Хорошие манеры

- Запрашивайте предложения под реальные нужды поездки и показывайте путешественнику цену, трафик и срок до оплаты.
- Один `offer_id`, один платёж, один заказ. Чтобы купить две eSIM, сделайте два платежа.
- Продавец обновляет каталог каждые 15 минут. Если цена изменилась после вашего запроса, 402 попросит новую сумму, или оптовик отклонит заказ (`409`, ничего не списано). Сумма указана в 402: клиент x402 может отказаться платить больше, чем в предложении.

Для восстановления после потери ответа отправляйте приватный случайный заголовок `X-Esim-Recovery` (32+ символа base64url) с первого запроса заказа. Сохраните его вместе с подписью платежа и повторяйте оба значения. Одних публичных данных блокчейна для получения eSIM недостаточно. Пример создаёт и сохраняет этот секрет автоматически.
