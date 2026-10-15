# 运营者指南

本指南带你从一台空服务器走到第一笔销售，然后介绍日常工作：订单、退款、余额、备份、更新。安装请预留一小时，
其中大部分时间是在等待批发账户开通和 DNS 记录生效。

其他文档：[概览](../../README.zh.md) · [智能体指南](agent-guide.md) · [接入指南](rails.md) · [集成](integrations.md) · [SDK](sdk.md)

## 快捷方式

服务器、域名和批发账户准备好之后（第 2 至 4 节），剩下的设置由一条命令在演示模式下完成：

```bash
git clone https://github.com/alexar76/esim-operator-kit.git && cd esim-operator-kit
./onboard.sh            # 店铺、面向智能体的卖家节点、联邦节点；只询问缺少的内容
./onboard.sh --hub      # 同上，但使用你自己的枢纽：own-hub.md
```

它会询问你的域名、店铺名称、你的报价 ID 以及批发商密钥（隐藏输入，写入 `secrets/`，从不打印）。然后以演示模式启动所有服务，等待 HTTPS 就绪，检查卖家节点，写入 `node.toml`，运行其他枢纽会对你做的同一项准入检查，并在加入联邦前征求你的确认。之后还剩：付款地址和密钥（第 8 节）、`DEMO_MODE=0`，以及测试订单（第 10 节）。任何改动之后都可以再次运行：它只做缺少的部分。`./onboard.sh --check` 不做任何改动，只报告哪些已就绪。下面各节就是它所做的事，供想手动操作的人参考。

**80 和 443 端口上已经运行着 nginx 或其他 Web 服务器？** 命令会发现并询问你。对 nginx，它会把套件放在 nginx 后面：把套件的服务发布在 `127.0.0.1`（`docker-compose.override.yml`，套件自带的 Caddy 不启动），为你的域名写好站点配置，并用 certbot 获取证书，每一步都先征求同意。对其他 Web 服务器，它会打印需要添加的路由。这个选择记录在 `.env` 的 `PROXY` 中。

## 1. 你要搭建什么

```text
            https://esim.example.com
                      │
                   Caddy (80, 443, Let's Encrypt)
      ┌───────────────┼──────────────────────────────┐
      │               │                              │
   store          rails (/agents/*)              node (/.well-known/ai-market.json, /ai-market/*)
  用户购买        智能体通过 x402 购买            枢纽发现你的套餐
      │               │
      └──── 你的 eSIM Access 余额 ────┘        付款进入你自己的钱包
```

- **store** 是网站：国家页面、付款、带二维码的订单页面。
- **rails** 是面向 AI 智能体的卖家节点：免费报价，付费订单走 x402。
- **node** 是 `aimarket node`。它告诉 AIMarket 枢纽你在卖什么，让智能体能找到你。等其他部分都正常后再最后启动它。
- **Caddy** 申请并续期 HTTPS 证书，并把请求分发给三个服务。

store 和 rails 从同一个批发账户购买。两者都不持有资金：买家付款到你的地址，套件只读取链上数据来确认款项到账。

## 2. 开始之前

| 你需要 | 说明 |
|---|---|
| 一个 eSIM Access 账户 | 在 [esimaccess.com](https://esimaccess.com) 注册。见第 3 步。 |
| 至少 50 美元余额 | 首次充值至少 50 美元（银行卡、PayPal 或支付宝；3,000 美元起可银行转账）。 |
| 一台 Linux 服务器 | 装有 Docker Engine 和 compose 插件，有公网 IPv4，开放 80 和 443 端口。1 个 vCPU 和 1 GB 内存就够了。 |
| 一个域名或子域名 | 例如 `esim.example.com`，A 记录指向服务器。 |
| 钱包地址 | EVM（一个地址用于全部七条 EVM 链）、Tron、Solana、TON。任意组合都可以。 |
| 销售条款和隐私政策 | 两个公开页面。eSIM Access 要求每个经销商的网站都链接它们。 |
| 可选：Coinbase Developer Platform 密钥 | 为用户开启 Base 上免 gas 的 USDC 付款，并开启智能体的 x402 订单。见第 8 步。 |
| 可选：Stripe | 开启银行卡付款。见第 8 步。 |

## 3. 批发账户

1. 在 [esimaccess.com](https://esimaccess.com) 注册并验证邮箱。
2. 充值余额（在控制台中：余额，然后充值）。最低 50 美元。你卖出的每张 eSIM 都按批发价从这笔余额中扣除，所以它是你的库存，不是手续费。
3. 打开控制台的开发者（API）部分。那里有两个值：**AccessCode** 和 **SecretKey**。像对待密码一样对待 SecretKey。

没有沙盒：每一笔 API 订单都是真实的。两种低成本的测试方法：

- 订购最便宜的套餐（几十美分），然后取消未使用的配置文件。未使用的配置文件会退回余额。
- 首次充值之前，向客服申请少量测试额度：Customer Support，然后 Submit ticket，类型选 “Top Up”。说明你正在对接 API，需要几美元做测试订单。

## 4. 服务器和域名

1. 为你的域名创建 A 记录，指向服务器的 IPv4 地址。在你的电脑上检查：

```bash
dig +short esim.example.com
```

2. 在服务器上安装 Docker（[docs.docker.com/engine/install](https://docs.docker.com/engine/install/)），并确认 compose 可用：

```bash
docker compose version
```

3. 在服务器防火墙和云服务商面板中开放 80 和 443 端口。Let's Encrypt 在签发证书前会检查 80 端口。

## 5. 获取套件并配置

```bash
git clone https://github.com/alexar76/esim-operator-kit.git
cd esim-operator-kit
cp .env.example .env
nano .env
```

| 设置 | 填写什么 |
|---|---|
| `DOMAIN` | 你的域名，不带 `https://`。 |
| `STORE_NAME` | 买家在页头、标题和钱包弹窗中看到的店名。 |
| `PRODUCT_ID` | 你的套餐在联邦中的简短标识，例如 `esim-mytravel`。字母、数字、短横线。 |
| `STORE_CONTACT` | 买家联系你的邮箱，显示在页脚。 |
| `STORE_TERMS_URL`、`STORE_PRIVACY_URL` | 你的销售条款和隐私政策，链接显示在页脚。 |
| `MARGIN_PCT` | 在批发价基础上的加价百分比。`100` 表示翻倍。 |
| `MIN_MARGIN_USD` | 每张 eSIM 的最低利润（美元）。便宜的套餐至少加这么多。 |
| `PRICES_FILE` | 可选：覆盖公式的价目表，`/config/prices.csv`。见下文。 |
| `DEMO_MODE` | `1` 显示横幅且不收款。`0` 正式销售。在第 10 步之前保持 `1`。 |
| `PAY_TO_EVM`、`PAY_TO_TON`、`PAY_TO_TRON`、`PAY_TO_SOLANA` | 你的收款地址。留空即关闭该网络。 |
| `EVM_CHAINS` | 提供哪些 EVM 链，用 chain id 表示：`8453` Base、`1` Ethereum、`42161` Arbitrum、`10` OP、`137` Polygon、`56` BNB Chain、`43114` Avalanche。 |
| `EVM_RPC_<chain id>`、`SOLANA_RPC` | 可选：你自己的 RPC 端点。公共端点有频率限制。 |
| `SUPPLIER` | eSIM 的来源：`esimaccess`（默认）、`airalo`、`esimgo`，或用 `http` 接入你自己的系统。见[集成](integrations.md)。 |
| `WEBHOOK_URL`、`WEBHOOK_SECRET_FILE` | 可选：把每个订单的状态签名后发送到你的 CRM、计费系统、Telegram 或表格。见[集成](integrations.md)。 |
| `REFUND_KEY_FILE`、`REFUND_MAX_USD`、`REFUND_DAILY_MAX_USD` | 可选：从你选定的钱包，自动向智能体退还未使用 eSIM 的价款。见[案例](cases.md)。 |

**价格怎么算。** 价格 = 批发价 × (1 + `MARGIN_PCT`/100)，但不低于批发价 + `MIN_MARGIN_USD`，向上取整到美分。按默认值（100% 和 1.00 美元），法国 1 GB 7 天的批发价是 0.70 美元，售价 1.70 美元。批发价 9.00 美元的 20 GB 套餐售价 18.00 美元。零售 eSIM 商店的小套餐通常要价 4 到 8 美元，所以你有空间。

**你自己的价目表。** 如果你已有零售价，或想给某些国家设不同的加价，把它们写进价目表。价目表没有选中的套餐，按上面的公式定价。

```bash
cp config/prices.example.csv config/prices.csv
nano config/prices.csv                   # 然后在 .env 中取消注释 PRICES_FILE=/config/prices.csv
docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv
```

示例：

```csv
match,gb,days,price_usd,margin_pct,min_margin_usd
TR,1,7,4.50,,
TR,,,,80,
JP,,,,,2.00
global,,,,60,
US_0.1_7,,,off,,
```

| 列 | 含义 |
|---|---|
| `match` | 选哪些套餐：报价中显示的套餐 id（`TR_1_7`）、国家（`TR`：该国自己的套餐）、`region` 或 `global`（多国套餐），或 `*`（所有套餐）。 |
| `gb`、`days` | 可选，与国家、`region`、`global` 或 `*` 一起用：只选这个流量和天数的套餐。`gb` 允许 ±10% 误差，因为供应商把 1 GB 算作 1000 或 1024 MB。 |
| `price_usd` | 固定价格，例如 `4.50`；或 `off`：不出售该套餐。 |
| `margin_pct`、`min_margin_usd` | 或者对选中的套餐用这些数字套用公式。留空的一项沿用 `.env` 的值。 |

最具体的一行生效：套餐 id 优先于国家，国家优先于 `region` 和 `global`，它们优先于 `*`，然后是 `gb`、`days` 填得更多的一行；两行同样具体时，取靠上的一行。固定价格永远不会亏本出售：如果批发价涨到它之上，该套餐按公式定价，直到你修改价目表，第 7 步的价格检查会提示。文件在启动时读取；有错误的价目表会让启动失败并指出行号，所以笔误绝不会让你以意料之外的价格出售。电子表格导出的文件也能用：分号和小数逗号都能识别。如果价格保存在你的计费系统里，可以定时导出到这个文件。用 `docker compose restart store rails` 让修改生效。

**只要地址。** 每个 `PAY_TO_*` 都是你的收款地址。套件从不需要私钥或助记词。如果某份指南或某个人让你把它们放进 `.env`，那一定是错的。

## 6. 放置密钥

密钥存放在 `secrets/`，每个文件一个值。该目录不进 git，以只读方式挂载到容器中。用下面的方式输入，避免它们进入 shell 历史记录：

```bash
cd ~/esim-operator-kit
umask 077
printf 'AccessCode: '; read -rs v; printf %s "$v" > secrets/esimaccess_access_code; echo
printf 'SecretKey: '; read -rs v; printf %s "$v" > secrets/esimaccess_secret_key; echo
unset v
```

容器以用户 1000 运行，所以要把密钥文件和数据目录交给该用户：

```bash
mkdir -p data/store data/rails data/node data/caddy
sudo chown 1000:1000 secrets/*
sudo chown -R 1000:1000 data/store data/rails data/node
ls -l secrets
```

目录本身仍属于你，之后可以继续添加文件。每个新的密钥文件都需要同样的 `sudo chown 1000:1000` 和 `chmod 600`。

[secrets/README.md](../../secrets/README.md) 列出了所有可选文件：CDP 密钥、tonapi 和 TronGrid 密钥、Stripe 密钥。

## 7. 以演示模式启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail 30 store rails
```

首次构建需要几分钟。然后检查三件事：

```bash
curl -s https://esim.example.com/agents/healthz
curl -s -X POST https://esim.example.com/agents/quote -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

- 健康检查返回 `"ok":true` 和套餐数量，eSIM Access 约有 1,700 个。目前出现 `"demo":true` 是正常的。
- 报价请求按你的价格列出真实套餐。
- `https://esim.example.com/` 显示带演示横幅的店铺。打开一个国家，走一遍付款流程：每个付款步骤都会回答“演示模式：支付已关闭”。

如果健康检查返回 `"ok":false`，说明批发密钥错误或无法读取。见第 14 节。

**检查你的价格。** 下面的命令打印余额，以及任意国家按你的价格计算的最佳套餐，旁边附批发价。有价目表时，还会显示每一行定了哪些价，以及哪些行没有选中任何套餐：

```bash
docker compose exec -T rails node scripts/catalog.mjs FR ES IT US JP TH
```

在 `.env` 中修改 `MARGIN_PCT` 或 `MIN_MARGIN_USD`，然后用 `docker compose up -d` 生效。修改价目表后，用 `docker compose restart store rails`。

## 8. 付款

每种方式在设置好地址（以及所需的密钥）后开启。开启你的买家常用的方式。Tron 上的 USDT 是最常见的加密货币付款方式，其次是 EVM 链上的 USDT 和 USDC，以及 TON 上的 USDT。

| 方式 | 需要设置 | 买家如何付款 | 店铺如何确认 |
|---|---|---|---|
| Base 上免 gas 的 USDC | `PAY_TO_EVM` + `secrets/cdp_api_key.json` | 在浏览器钱包中签名一条消息，不付 gas。 | 由 CDP facilitator 结算签名。先交付 eSIM，再结算付款；如果结算失败，eSIM 会被取消。 |
| 7 条 EVM 链上的 USDC / USDT | `PAY_TO_EVM`（+ `EVM_CHAINS`） | 从浏览器钱包发起转账，或从任意钱包或交易所转账后粘贴交易哈希。 | 读取交易回执：该代币转给你、金额不低于价格、时间晚于订单。等待确认数：Ethereum 和 BNB Chain 3 个，Polygon 10 个，其他 1 个。一笔交易只支付一个订单。 |
| Tron 上的 USDT | `PAY_TO_TRON`（+ `secrets/trongrid_key`） | 用页面上的 TronLink 或任意钱包，发送页面显示的精确金额。 | 每个订单要求的金额是价格加上几百万分之一美元（最多多出 0.0099 美元）。这个精确金额在你已确认的 USDT 转账中标识出该订单。 |
| Solana 上的 USDC | `PAY_TO_SOLANA`（+ `SOLANA_RPC`） | 打开 Solana Pay 链接或扫描其二维码（Phantom、Solflare、Backpack）。 | 每个订单有自己的引用密钥，钱包会把它加入转账。店铺据此找到交易。 |
| TON 上的 USDT 或 TON | `PAY_TO_TON`（+ `secrets/tonapi_key`） | 通过 TON Connect 连接 Tonkeeper 或其他钱包，或手动转账并填写显示的备注。 | 通过 tonapi.io 按订单备注找到转账。 |
| 银行卡 | `secrets/stripe_secret_key` + `secrets/stripe_webhook_secret` | Stripe Checkout。 | Stripe webhook。 |

主动转账类付款（除免 gas 的 Base 和银行卡外的所有方式）在订单创建后的 24 小时内都会被查找。

**Coinbase Developer Platform 密钥。** 它为用户开启 Base 上免 gas 的 USDC，也开启智能体的 x402 订单。没有它，店铺仍可以普通转账的方式接收 Base 上的 USDC，但面向智能体的节点不接受订单。

1. 登录 [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com) 并创建项目。
2. API Keys：创建一个 secret API key，下载它的 JSON 文件。
3. 把文件复制为 `secrets/cdp_api_key.json`（其中包含 `id` 和 `privateKey`），然后运行 `sudo chown 1000:1000 secrets/cdp_api_key.json && sudo chmod 600 secrets/cdp_api_key.json` 和 `docker compose up -d`。

**Stripe。** 在 Stripe 控制台添加 webhook 端点 `https://<你的域名>/api/stripe/webhook`，事件选 `checkout.session.completed` 和 `checkout.session.async_payment_succeeded`。把私钥（`sk_live_…`）放进 `secrets/stripe_secret_key`，把端点的签名密钥（`whsec_…`）放进 `secrets/stripe_webhook_secret`。

**频率限制。** 公共的 TronGrid、tonapi 和 RPC 端点足够小店使用。销售稳定后，添加免费的 TronGrid 密钥和 tonapi 密钥，并把 `EVM_RPC_<id>` 和 `SOLANA_RPC` 指向你自己的服务商。

## 9. 智能体与联邦

rails 节点已经在 `https://<你的域名>/agents/` 为智能体提供服务。要让智能体在枢纽上搜索时找到你，需要向联邦描述你的节点并发布公告。

1. 根据实时目录生成 `node.toml`。填入你自己的名称、域名和 `PRODUCT_ID`：

```bash
docker compose exec -T rails node scripts/node-toml.mjs \
  --name "My Travel eSIM" --url https://esim.example.com \
  --product esim-mytravel --upstream http://rails:9490 > node.toml
head -20 node.toml
```

2. 启动节点：

```bash
docker compose --profile federation up -d --build node
curl -s https://esim.example.com/.well-known/ai-market.json | head -c 400; echo
```

3. 用枢纽的方式检查它，然后发布公告：

```bash
docker compose exec node aimarket doctor --url https://esim.example.com
docker compose exec node aimarket node knock --config /node/node.toml --hub https://modelmarket.dev
```

在收录你之前，枢纽会用一个真实国家调用 `esim.quote`。收录后，在枢纽上搜索 “eSIM France” 的智能体就会得到你的套餐。付款从不经过枢纽：智能体通过 x402 直接付款到你节点对应的钱包。

`data/node/` 存放节点的签名密钥，也就是它在联邦中的身份。请备份。目录新增国家后，重新执行第 1 步。

**已确认交付。** 你的节点回答的每个订单和每次退款都带有一张收据，用节点的卖家密钥签名（`data/rails/provider_ed25519.pem`，也就是签署每个免费回答的密钥），第 1 步生成的 `node.toml` 会把它的公钥部分作为 `provider_pubkey` 公布出去。通过枢纽找到你的买家，可以把收据和对应交易交给该枢纽；枢纽在链上核对两者，并记一次已确认交付。之后你的上架条目会显示 `deliveries_30d`（30 天内买家确认的交付和退款次数，以及其中有多少个不同买家），枢纽给你的信任分对每个不同买家计一次成功。除第 1 步外无需任何操作；2026 年 10 月 15 日之前生成的 `node.toml` 没有这个密钥，请重新执行第 1 步。请把卖家密钥连同 `data/rails/` 的其他内容一起备份：用丢失的密钥签名的收据将无法再与你的上架条目对应。[案例](cases.md)中的案例 3 用真实买家演示了这一点。

检查密钥是否已公布：

```bash
curl -s https://esim.example.com/ai-market/v2/manifest | grep -o provider_pubkey | head -1    # provider_pubkey
```

这需要 `node/` 镜像中的 `aimarket-hub` 为 3.15.27 或更高版本，套件安装的就是这个版本。更早的节点会丢掉这个密钥，此时枢纽对你的买家收据返回 `404`。

**用你自己的枢纽代替节点。** `./onboard.sh --hub` 会在你的域名上运行一个完整的枢纽：它自己上架你的报价，给智能体一个属于你的搜索和 MCP 地址，并与其他枢纽联邦。如果之前运行的是节点，域名的身份会保留。详见[你自己的枢纽](own-hub.md)。

## 10. 测试订单，然后正式上线

1. 在 `.env` 中设置 `DEMO_MODE=0`，并逐字符再次核对 `PAY_TO_*` 地址。
2. 生效：

```bash
docker compose up -d
curl -s https://esim.example.com/agents/healthz
```

应显示 `"demo":false`。设置了 CDP 密钥和 `PAY_TO_EVM` 后会显示 `"paid_orders":true`。

3. 在你自己的店铺，用你自己的、但不是店铺收款地址的钱包，在你预计买家最常用的网络上，购买某个国家最便宜的套餐。订单页面应在一分钟内显示二维码。不要从 `PAY_TO_EVM` 钱包本身付款：x402 facilitator 拒绝从一个地址付款给它自己（`self_send_not_allowed`）。
4. 在钱包中核对付款，在 eSIM Access 控制台中核对订单。
5. 如果你不想保留这张 eSIM，在 eSIM Access 控制台取消未使用的配置文件。批发价会退回余额。你付的钱本来就进了你自己的钱包。

用同样的方式测试智能体渠道：准备一个在 Base 上有 1 美元 USDC 的小额测试钱包（不是你的 `PAY_TO_EVM`
钱包）。该命令会报价、显示价格，只有加上 `--yes` 才付款：

```bash
cd rails && node examples/agent-buy.mjs https://esim.example.com/agents TR --key-file ~/test-wallet.json --yes --refund
```

密钥文件里是 `{"private_key": "0x…"}`，从不打印。响应中会给出 eSIM（`esim_tran_no`）和 Base 上的结算交易。
`--refund` 会立即申请退款：节点在供应商处取消未使用的 eSIM（成本退回你的余额），如果开启了退款（[案例](cases.md)
第 7 节），还会把钱退回测试钱包；未开启时，退款记为待付。枢纽收录你之后，用 `--hub https://modelmarket.dev`
代替你的地址再运行一次：这就是智能体走的路径，包括收据。[智能体指南](agent-guide.md)中展示了一次真实运行，
包括被拒绝的情况。

对每个已开启的网络都这样做一遍。然后你就正式上线了。

## 11. 日常工作

**订单。** 店铺把订单保存在 `data/store/orders.json`。列出需要你处理的订单：

```bash
sudo jq -r '.[] | select(.status=="refund_due" or .status=="underpaid")
  | [.created_at, .id, .status, .method, (.price_cents/100), .payment.ref, (.payment.payer // "-"), (.error // "")] | @tsv' \
  data/store/orders.json
```

| 状态 | 含义 | 怎么做 |
|---|---|---|
| `awaiting_payment` | 订单已创建，尚未收到付款。 | 无需操作。 |
| `delivered` | 已付款，eSIM 已交给买家。 | 无需操作。 |
| `refund_due` | 已付款，但批发商未能交付：余额用完，或套餐下架。 | 在同一网络上退款到 `payment.payer`，或充值后手动为买家补发该套餐。 |
| `underpaid` | 收到的金额低于价格。 | 退款，或请买家补齐差额后手动交付。 |
| `expired` | 24 小时内未收到付款。 | 无需操作。之后到账的付款不会被匹配，你会在钱包里看到一笔没有订单的款项。 |

买家会写信到 `STORE_CONTACT`。向他们索要页面地址中的订单号（`/o/<订单号>`）。不要索要完整链接：里面有他们的令牌。

**余额。** 让批发余额保持在几天销量以上。余额不足以支付订单时，付款页会显示“该套餐暂时不可用”，而不会收款。用下面的命令查看余额：

```bash
docker compose exec -T rails node scripts/catalog.mjs | head -1
```

**日志。**

```bash
docker compose logs -f --tail 100 store rails
```

日志中从不包含激活码或密钥。

**备份。** 每天把 `data/` 和 `secrets/` 备份到服务器以外的地方：

- `data/store/`：订单。丢失后买家的订单页面将无法使用。
- `data/rails/`：智能体的订单、其状态令牌的密钥，以及节点的签名密钥。两个文件夹还保存最近一次的目录（`catalog-snapshot.json`）：如果供应商不再响应，会继续提供最多六小时，演示模式下不限时长。
- `data/node/`：联邦身份。
- `data/hub/`：你自己的枢纽（如果有）：它的密钥、数据库、设置和管理员令牌。
- `data/caddy/`：证书。可以重新签发，但备份能避免触发 Let's Encrypt 的限额。

**更新。**

```bash
git pull
docker compose up -d --build
docker compose --profile federation up -d --build node    # 如果你运行联邦节点
```

在更新正在销售的店铺之前，先阅读版本说明。

## 12. 智能体的订单

智能体通过 `POST /agents/order` 购买（见[智能体指南](agent-guide.md)）。节点验证 x402 付款、购买配置文件，并且只在配置文件创建后才结算。如果结算失败，节点会取消配置文件，批发价退回你的余额。智能体的订单记录在 `data/rails/orders.json` 中，不含激活码。USDC 会到达你在 Base 上的 `PAY_TO_EVM`。

**退款。** 智能体可以为未安装的 eSIM 申请退款：用 eSIM 编号和状态令牌调用 `POST /agents/refund`。节点在批发商处取消 eSIM（批发商会退回你的余额），并把价款退回付款地址。只有在你给节点配置退款钱包时才会自动退款（`REFUND_KEY_FILE`，上限为 `REFUND_MAX_USD` 和 `REFUND_DAILY_MAX_USD`）；否则退款记为待付，`agent_order.refund_due` webhook 会提醒你支付。配置、规则以及带交易记录的真实退款见[案例](cases.md)。

## 13. 法律、税务和条款

以下不构成法律或税务建议。开始销售前，请咨询你所在国家的会计师。

- **卖家是你。** 买家向你购买，适用你的条款。eSIM Access 是你的供应商。退款、客服和税务都由你负责。
- **条款和隐私。** eSIM Access 要求你的网站公布销售条款和隐私政策。设置 `STORE_TERMS_URL` 和 `STORE_PRIVACY_URL`。条款应涵盖退款（已安装的 eSIM 通常不能退款）、设备兼容性（支持 eSIM 且未锁网的手机）以及有效期何时开始。
- **欧盟增值税。** 向消费者销售的电信服务在买家所在国征税。一站式申报（OSS）可以用一份申报覆盖所有欧盟国家。欧盟以外规则不同。
- **加密货币。** 能否接受加密货币以及如何记账，取决于你所在的国家。请保留订单记录：店铺记录了每笔付款的网络、交易和金额。
- **个人数据。** 店铺不向买家索取任何信息：没有姓名，没有邮箱。它保存订单（套餐、价格、付款方式）和付款（交易及付款方地址）。根据 GDPR，区块链地址仍可能属于个人数据，请在隐私政策中说明。

## 14. 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 浏览器提示证书无效 | DNS 尚未指向这里，或 80 端口未开放 | `dig +short <域名>`，开放 80 端口，然后 `docker compose restart caddy` 并查看 `docker compose logs caddy`。 |
| `healthz` 显示 `"ok":false`，或店铺没有任何国家 | 批发密钥错误，或用户 1000 无法读取。日志显示 `catalogue not loaded yet: <code>`。 | `sudo rm secrets/esimaccess_*`，按第 6 步重新写入，然后 `docker compose restart store rails`。 |
| 日志中出现 `EACCES` 或 `permission denied` | 数据目录不属于用户 1000 | `sudo chown -R 1000:1000 data/store data/rails data/node` |
| 付款页显示“该套餐暂时不可用” | 批发余额不足以支付该套餐 | 给 eSIM Access 充值。 |
| 每个付款步骤都回答“演示模式：支付已关闭” | `DEMO_MODE=1` | 第 10 步。 |
| 付款页缺少某个网络 | 它的 `PAY_TO_*` 为空 | 检查 `.env`，然后 `docker compose up -d`。 |
| 店铺反复重启 | 某个 `PAY_TO_*` 不是有效地址：店铺遇到无效地址会拒绝启动 | `docker compose logs store` 会指出是哪个。修正 `.env`。 |
| 找不到 Tron 付款 | 金额不精确，常见原因是交易所从金额中扣除了手续费 | 在钱包中找到这笔转账并退款，或手动交付。提醒买家从钱包发送精确金额。 |
| 找不到 TON 付款 | 备注缺失或被修改 | 同上。使用 TON Connect 时钱包会自动填写备注。 |
| `aimarket doctor` 报告私有地址 | `node.toml` 中的 `url` 不是你的公网域名 | 用 `--url https://<域名>` 重新生成 `node.toml`（第 9 步）。 |
| `node` 无法启动：`node.toml` 是个目录 | 文件不存在时 compose 自动创建了目录 | `rmdir node.toml`，生成文件（第 9 步），再次启动。 |
| 测试付款被拒：`402 … self_send_not_allowed` | 你从店铺自己的 `PAY_TO_EVM` 地址付款；facilitator 拒绝付款给自己 | 换一个钱包付款。 |
| 节点日志出现 `bazaar … resource must start with 'https://'` | `PUBLIC_URL` 是 http（本地测试） | 测试节点无需处理；生产环境中 `PUBLIC_URL` 是你的 https 域名。 |
| 商店或节点启动时停止：`…prices.csv, line N: …` | 价目表某一行无法读取 | 修正该行；`docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv` 会检查整个文件。然后 `docker compose restart store rails`。 |
