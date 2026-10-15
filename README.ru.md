# Кит eSIM-оператора

<!-- aicom-readme-badges -->
<p align="center">
  <a href="https://github.com/alexar76/esim-operator-kit/actions/workflows/ci.yml"><img src="https://github.com/alexar76/esim-operator-kit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/alexar76/esim-operator-kit/actions/workflows/pages.yml"><img src="https://github.com/alexar76/esim-operator-kit/actions/workflows/pages.yml/badge.svg" alt="Pages" /></a>
  <a href="https://github.com/alexar76/esim-operator-kit/actions/workflows/pages.yml"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Falexar76.github.io%2Fesim-operator-kit%2Fbadges%2Ftests.json" alt="Tests (measured by CI)" /></a>
  <a href="https://esim-shop.modelmarket.dev/"><img src="https://img.shields.io/website?url=https%3A%2F%2Fesim-shop.modelmarket.dev%2Frobots.txt&label=example%20shop&up_message=live&down_message=down" alt="Example shop" /></a>
  <a href="https://esim.modelmarket.dev/"><img src="https://img.shields.io/website?url=https%3A%2F%2Fesim.modelmarket.dev%2F&label=landing&up_message=live&down_message=down" alt="Landing" /></a>
  <a href="https://modelmarket.dev/providers/esim/healthz"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmodelmarket.dev%2Fproviders%2Fesim%2Fhealthz&query=%24.offers&label=plans%20(live)&color=2bd69b" alt="Plans in the live catalogue" /></a>
  <img src="https://img.shields.io/badge/agents-x402%20%C2%B7%20USDC%20on%20Base-3b6cff" alt="Agents pay over x402 in USDC on Base" />
  <img src="https://img.shields.io/badge/suppliers-eSIM%20Access%20%C2%B7%20Airalo%20%C2%B7%20eSIM%20Go%20%C2%B7%20HTTP-f3c33c" alt="Suppliers: eSIM Access, Airalo, eSIM Go, your own HTTP" />
  <img src="https://img.shields.io/badge/AIMarket-federation%20node-35e7ff" alt="AIMarket federation node" />
  <img src="https://img.shields.io/badge/payments-10%20networks-ff4d4f" alt="Ten payment networks" />
  <img src="https://img.shields.io/badge/npm-%40aimarket%2Fesim--rails-cb3837" alt="npm @aimarket/esim-rails" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node.js 20 or newer" />
  <img src="https://img.shields.io/badge/Docker-compose-2496ED" alt="Docker compose" />
  <img src="https://img.shields.io/badge/docs-EN%20RU%20ES%20FR%20ZH-9c70ff" alt="Documentation in 5 languages" />
  <a href="https://github.com/alexar76/esim-operator-kit/blob/main/LICENSE"><img src="https://raw.githubusercontent.com/alexar76/esim-operator-kit/refs/heads/main/docs/badges/license.svg" alt="License: MIT" /></a>
</p>
<!-- /aicom-readme-badges -->

<p align="center">
  <strong>Продавайте eSIM ИИ-агентам — на рельсах AIMarket</strong><br/>
  Референсный eSIM-оператор для экономики агентов: ваши предложения находят через федерацию, оплата по x402 — прямо на ваш кошелёк
</p>

<p align="center">
  <a href="https://esim.modelmarket.dev/">
    <img src="docs/landing/screenshots/hero.jpg" alt="Кит eSIM-оператора — глобус покрытия: 205 стран из живого каталога, продажи в десяти сетях, ИИ-агент покупает по x402" width="860">
  </a>
  <br>
  <sub><a href="https://esim.modelmarket.dev/"><b>Лендинг →</b></a> · <a href="https://esim-shop.modelmarket.dev/ru/"><b>Живое демо →</b></a> · <a href="https://esim.modelmarket.dev/ru/kit"><b>Документация →</b></a> · <a href="https://modelmarket.dev/"><b>Хаб AIMarket →</b></a></sub>
</p>

> 🌐 [English](README.md) · **Русский** · [Español](README.es.md) · [Français](README.fr.md) · [中文](README.zh.md)

## Продавайте eSIM ИИ-агентам

ИИ-агенты бронируют перелёты и отели; следующее, что нужно путешественнику, — мобильный интернет по
прилёте. На рельсах AIMarket агент находит продавца eSIM через хаб, получает подписанное
предложение, платит одним платежом x402 в USDC и получает код активации: без аккаунта, без
API-ключа, без страницы оплаты.

Этот кит делает ваш eSIM-бизнес одним из таких продавцов. Он **референс** в обоих смыслах:

- **Действующий оператор или реселлер** сохраняет свою платформу, своих поставщиков и свою витрину
  и подключает свои системы к рельсам — через пять HTTP-эндпоинтов, SDK или собственную
  реализацию контракта `esim.*@v1`, проверенную тестом соответствия из кита.
- **Новый оператор** запускает весь кит на одном сервере: узел для агентов, узел федерации и
  витрину для людей на пяти языках с оплатой криптой в десяти сетях.

Попробуйте прямо сейчас: демо-узел отвечает агентам по адресу `https://modelmarket.dev/providers/esim`,
а демо-витрина работает на [esim-shop.modelmarket.dev](https://esim-shop.modelmarket.dev/ru/). Ни то, ни
другое ничего не продаёт.

## Место в экосистеме

```mermaid
flowchart LR
  subgraph agents["ИИ-агенты"]
    A1["Агент-турагент<br/>MCP-клиент"]
    A2["Бэкенд вашего приложения"]
  end
  subgraph fed["Федерация AIMarket"]
    HUB["Хаб · modelmarket.dev<br/>market_search · market_invoke"]
    HUB2["Другие хабы"]
  end
  subgraph kit["Ваш eSIM-оператор — этот кит"]
    NODE["Узел продавца /agents<br/>esim.quote · esim.order · esim.status"]
    FED["Узел федерации<br/>/.well-known/ai-market.json"]
    STORE["Витрина /<br/>для людей, 5 языков"]
  end
  subgraph you["Ваш бизнес"]
    SUP["Поставщик<br/>eSIM Access · Airalo · eSIM Go<br/>или ваша система"]
    CRM["CRM · биллинг · учёт<br/>(вебхуки)"]
    W["Ваши кошельки<br/>Base · Tron · TON · Solana · EVM"]
  end
  A1 -->|поиск| HUB
  HUB <-->|федерация| HUB2
  HUB -->|принимает, показывает| FED
  FED --- NODE
  A1 -->|предложение, затем заказ по x402| NODE
  A2 -->|тот же API| NODE
  STORE --> SUP
  NODE --> SUP
  NODE -.->|события| CRM
  STORE -.->|события| CRM
  A1 -.->|USDC| W
  STORE -.->|покупатели платят| W
```

Хаб направляет поиск, но никогда не деньги: агент платит вашему узлу напрямую, и хабы не берут
комиссию с таких прямых продаж.

## Для кого

| Вы | Что используете | С чего начать |
|---|---|---|
| **Действующий eSIM-оператор, MVNO или реселлер** | Ваш аккаунт у поставщика (eSIM Access, Airalo, eSIM Go) или ваши системы за пятью HTTP-эндпоинтами или SDK; вебхуки в вашу CRM и биллинг; ваш прайс-лист в CSV; ваша витрина остаётся | [Онбординг](docs/ru/rails.md) · [Интеграции](docs/ru/integrations.md) · [SDK](docs/ru/sdk.md) |
| **Новый оператор** | Весь кит с оптовым аккаунтом (eSIM Access, Airalo или eSIM Go): узел для агентов, узел федерации, витрина, HTTPS | [Гайд оператора](docs/ru/operator-guide.md) |
| **Разработчик агентов** | API `esim.*@v1` любого продавца: предложения, покупка по x402, проверка расхода | [Гайд для агентов](docs/ru/agent-guide.md) |

## Готовые интеграции

| Откуда берутся eSIM | | Куда уходят новости о каждой продаже | |
|---|---|---|---|
| eSIM Access | ✅ проверено вживую | CRM, биллинг, учёт (подписанные вебхуки) | ✅ |
| Airalo Partner API | 🟡 по опубликованному API | Telegram, Slack (ретранслятор в комплекте) | ✅ |
| eSIM Go API v2.5 | 🟡 по опубликованному API | Google Sheets (Apps Script в комплекте) | 🟡 |
| Ваша система: 5 HTTP-эндпоинтов, любой язык | ✅ | n8n, Make, Zapier, HubSpot, Salesforce | 📘 рецепты |
| Всё остальное: интерфейс поставщика из SDK | ✅ | Ваше приложение или витрина: API для агентов | ✅ |

Пошаговая настройка каждой: [Интеграции](docs/ru/integrations.md).

## Как покупает агент

```mermaid
sequenceDiagram
  autonumber
  participant Ag as ИИ-агент
  participant Hub as Хаб AIMarket
  participant N as Ваш узел продавца
  participant S as Ваш поставщик
  participant B as Base (USDC)
  Ag->>Hub: market_search "eSIM в Японию, 5 ГБ"
  Hub-->>Ag: esim.quote@v1 на вашем узле (и у других продавцов)
  Ag->>N: POST /agents/quote {country: JP, min_gb: 5}
  N-->>Ag: предложения, от дешёвых, с подписью (Ed25519)
  Ag->>N: POST /agents/order {offer_id}
  N-->>Ag: 402 Payment Required (x402: USDC в Base, цена, ваш адрес)
  Ag->>N: тот же запрос с подписанной авторизацией USDC
  N->>S: заказ (идемпотентно по платежу)
  S-->>N: профиль
  N->>B: провести платёж
  N-->>Ag: код активации, QR, ссылка установки, статус-токен
```

Платёж проводится только после того, как eSIM создана. Отклонённый заказ ничего не стоит; тот же
платёж, отправленный дважды, получает ту же eSIM; платёж, который не удалось провести, её отменяет.

## Как подключается действующий оператор

```mermaid
flowchart TB
  Q{"Что у вас есть?"}
  Q -->|"аккаунт в eSIM Access,<br/>Airalo или eSIM Go"| A2["A · Весь кит<br/>SUPPLIER: esimaccess, airalo или esimgo"]
  Q -->|"система выдачи профилей, склад профилей<br/>или поставщик, которого кит не знает"| B["B · HTTP-поставщик<br/>5 эндпоинтов в вашем стеке"]
  Q -->|"платформа на Node.js"| C["C · SDK<br/>@aimarket/esim-rails в вашем коде"]
  Q -->|"уже свой API для агентов,<br/>на любом языке"| D["D · Контракт<br/>esim.*@v1 + проверка соответствия"]
  B --> R["Кит: узел для агентов, узел федерации,<br/>платежи, витрина по желанию"]
  C --> R2["Ваш сервис с createNode()"]
  D --> R3["esim-rails check https://вы/agents"]
  A2 --> R
  R --> F["aimarket node knock → вы в каталоге хабов"]
  R2 --> F
  R3 --> F
```

| Путь | Вы делаете | Кит даёт |
|---|---|---|
| **A** весь кит | ничего: `./onboard.sh` | всё ниже, на eSIM Access, Airalo или eSIM Go |
| **B** HTTP-поставщик | `GET /catalog`, `POST /orders`, `GET /profiles`, `POST /profiles/{id}/cancel`, `GET /balance` ([спецификация](rails/spec/supplier-http.md)) | узел для агентов, x402, десять сетей оплаты, витрину, федерацию, вебхуки |
| **C** SDK | объект поставщика в вашем коде на Node.js | `createNode()` с подписью, x402, идемпотентными заказами, схемами |
| **D** контракт | `esim.quote@v1`, `esim.order@v1`, `esim.status@v1` в вашем стеке | JSON-схемы и `esim-rails check`, затем узел федерации |

Любой путь заканчивается одинаково: ваш узел анонсирует себя хабу AIMarket, проходит его проверку,
и агенты, которые ищут в федерации, видят ваши предложения. События заказов и платежей приходят в
вашу CRM, биллинг или учёт подписанными вебхуками.

## Что в коробке

| Часть | Что делает |
|---|---|
| Узел продавца для агентов (`rails/`) | `esim.quote` и `esim.status` — бесплатные и подписанные; `esim.order` — оплата по x402 в USDC в Base, проводится только после выдачи |
| SDK `@aimarket/esim-rails` (`rails/`) | `createNode`, интерфейс поставщика и адаптеры (eSIM Access, Airalo, eSIM Go, HTTP), вебхуки, схемы, `esim-rails check` |
| Контракт (`rails/spec/`) | JSON-схемы `esim.*@v1`, HTTP-поставщика и событий вебхуков |
| Узел федерации (`node/`) | `aimarket node`: ваши возможности на хабах AIMarket, подписанные ключом вашего узла |
| Витрина (`store/`) | страница на каждую страну на пяти языках; USDC и USDT в Base, Ethereum, Arbitrum, OP, Polygon, BNB Chain и Avalanche; USDT в Tron; USDC в Solana; USDT и TON в TON; карты через Stripe, если подключите |
| Прайс-лист (`config/`) | ваши розничные цены поверх наценки: фиксированные на тариф или на страну и объём, наценка по стране или региону, отключённые тарифы; `esim-rails prices` проверяет список |
| Вебхуки | события `order.*` и `agent_order.*` с HMAC-подписью для ваших систем |
| HTTPS (`Caddyfile`) | Caddy на 80 и 443, Let's Encrypt |

## Быстрый старт

Весь кит (путь A):

```bash
git clone https://github.com/alexar76/esim-operator-kit.git && cd esim-operator-kit
./onboard.sh            # спросит домен, название и ключи; демо-режим; вступит в федерацию
./onboard.sh --hub      # то же со своим хабом
```

SDK в вашем сервисе на Node.js (путь C):

```js
import { createNode, httpSupplier, createWebhooks, ed25519Signer } from "@aimarket/esim-rails";

const node = createNode({
  supplier: httpSupplier({ url: "https://ops.example.com/esim", secret: process.env.SUPPLIER_SECRET }),
  events: createWebhooks({ url: "https://crm.example.com/hooks/esim", secret: process.env.WEBHOOK_SECRET }),
  signer: ed25519Signer(process.env.PROVIDER_KEY_PEM), secret: process.env.STATUS_SECRET,
  store: myOrderStore, publicUrl: "https://esim.example.com/agents", paywall: await myX402Paywall(),
});
node.app.listen(9490);
```

Проверка любого узла продавца на соответствие контракту (путь D):

```bash
node rails/bin/esim-rails.mjs check https://esim.example.com/agents --country JP
```

## Галерея

<table>
  <tr>
    <td width="33%"><img src="docs/landing/screenshots/home.jpg" alt="Витрина: направления и цены"><br/><sub><b>Направления</b> — страница на страну</sub></td>
    <td width="33%"><img src="docs/landing/screenshots/country.jpg" alt="Тарифы страны"><br/><sub><b>Тарифы</b> — фильтр по трафику и дням</sub></td>
    <td width="33%"><img src="docs/landing/screenshots/checkout.jpg" alt="Оплата в десяти сетях"><br/><sub><b>Оплата</b> — десять сетей</sub></td>
  </tr>
  <tr>
    <td><img src="docs/landing/screenshots/pay-tron.jpg" alt="Оплата USDT в Tron"><br/><sub><b>USDT в Tron</b> — точная сумма, QR (заглушки)</sub></td>
    <td><img src="docs/landing/screenshots/esim.jpg" alt="eSIM готова к установке"><br/><sub><b>eSIM</b> — QR, код, ссылка установки (заглушки)</sub></td>
    <td><img src="docs/landing/screenshots/kit-docs.jpg" alt="Гайды на пяти языках"><br/><sub><b>Документация</b> — пять языков, со схемами</sub></td>
  </tr>
</table>

## Документы

| | English | Русский | Español | Français | 中文 |
|---|---|---|---|---|---|
| Онбординг, сценарии и взаимодействие | [rails](docs/en/rails.md) | [rails](docs/ru/rails.md) | [rails](docs/es/rails.md) | [rails](docs/fr/rails.md) | [rails](docs/zh/rails.md) |
| Интеграции | [integrations](docs/en/integrations.md) | [integrations](docs/ru/integrations.md) | [integrations](docs/es/integrations.md) | [integrations](docs/fr/integrations.md) | [integrations](docs/zh/integrations.md) |
| Справочник SDK | [sdk](docs/en/sdk.md) | [sdk](docs/ru/sdk.md) | [sdk](docs/es/sdk.md) | [sdk](docs/fr/sdk.md) | [sdk](docs/zh/sdk.md) |
| Гайд оператора | [operator](docs/en/operator-guide.md) | [operator](docs/ru/operator-guide.md) | [operator](docs/es/operator-guide.md) | [operator](docs/fr/operator-guide.md) | [operator](docs/zh/operator-guide.md) |
| Гайд для агентов | [agents](docs/en/agent-guide.md) | [agents](docs/ru/agent-guide.md) | [agents](docs/es/agent-guide.md) | [agents](docs/fr/agent-guide.md) | [agents](docs/zh/agent-guide.md) |
| Кейсы: агенты покупают и получают возвраты, а хаб засчитывает подтверждённые доставки, с транзакциями | [cases](docs/en/cases.md) | [cases](docs/ru/cases.md) | [cases](docs/es/cases.md) | [cases](docs/fr/cases.md) | [cases](docs/zh/cases.md) |
| Свой хаб: в федерации на своих условиях | [own hub](docs/en/own-hub.md) | [own hub](docs/ru/own-hub.md) | [own hub](docs/es/own-hub.md) | [own hub](docs/fr/own-hub.md) | [own hub](docs/zh/own-hub.md) |

Со схемами: [esim.modelmarket.dev/ru/kit](https://esim.modelmarket.dev/ru/kit). Спецификации:
[HTTP-поставщик](rails/spec/supplier-http.md) · [JSON-схемы](rails/spec/esim-v1/) · [secrets/README.md](secrets/README.md).

## Деньги, ключи и данные

- Покупатели и агенты платят прямо на ваши адреса; кит только читает блокчейны. Нет горячего кошелька и нет ключа, которым можно что-то потратить.
- Код активации отдаётся плательщику и нигде не хранится, не пишется в логи и не уходит в события.
- Один платёж покупает одну eSIM: номер заказа у поставщика выводится из платежа, поэтому повтор не купит вторую.
- Предложения подписаны ключом Ed25519 вашего узла и привязаны к запросу; хабы это проверяют.
- Вебхуки и вызовы поставщика подписаны HMAC с отметкой времени; получатели отклоняют повторы.

Политика безопасности: [SECURITY.md](SECURITY.md). Как участвовать: [CONTRIBUTING.md](CONTRIBUTING.md). Изменения: [CHANGELOG.md](CHANGELOG.md).

## Экосистема

| Проект | Связь с китом |
|---|---|
| [Хаб AIMarket](https://github.com/alexar76/aimarket-hub) · [modelmarket.dev](https://modelmarket.dev/) | Федерация и поиск: агенты ищут в нём, ваш узел анонсирует себя ему (`aimarket node`, PyPI `aimarket-hub`) |
| [x402](https://www.x402.org/) · Coinbase Developer Platform | Оплата агентов: USDC в Base, проводит фасилитатор CDP |
| [eSIM Access](https://esimaccess.com) · [Airalo](https://www.airalo.com/partner-with-us/api-partners) · [eSIM Go](https://www.esim-go.com) | Встроенные поставщики; любой другой — через HTTP-поставщика или SDK |
| [Бесплатные инструменты](https://modelmarket.dev/tools/ru/) | Проверка x402, сканы MCP: те же рельсы для разработчиков |

## Тесты

```bash
cd rails && npm ci && npm test      # узел, SDK, поставщики, прайс-листы, вебхуки, схемы, проверка соответствия
cd ../store && npm ci && npm test   # витрина, десять сетей, страницы, документация /kit
```

Сеть и ключи не нужны. Живой тестовый заказ у eSIM Access (2026-10-14) купил, прочитал и отменил
профиль через этот код; один и тот же платёж, отправленный дважды, нашёл тот же профиль. Настоящая покупка агентом по x402 на закрытом тестовом узле выдана и проведена в Base (0.31 USDC,
транзакция `0xe61f…0982`); оплата с кошелька самого продавца отклонена с `self_send_not_allowed`.

## Лицензия

MIT — см. [LICENSE](LICENSE).
