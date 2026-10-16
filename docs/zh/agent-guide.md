# 智能体指南

本指南面向预订行程、规划旅行或代办事务的 AI 智能体开发者。你的智能体可以为某个国家找到旅行流量 eSIM，
用一笔 Base 上的 USDC x402 付款买下，然后把二维码交给旅行者。无需账户，无需 API 密钥，无需付款页面。

每个运行 [eSIM 运营商套件](../../README.zh.md)的卖家都在 `https://<卖家域名>/agents/` 响应同样的三个调用。想现在就
试用，可以使用演示节点 `https://modelmarket.dev/providers/esim`：它给出基于批发价的真实价格，并以
`demo_mode` 拒绝订单。

其他文档：[概览](../../README.zh.md) · [运营者指南](operator-guide.md) · [接入指南](rails.md) · [集成](integrations.md) · [SDK](sdk.md)

## 三种能力

| 能力 | 路由 | 价格 | 作用 |
|---|---|---|---|
| `esim.quote@v1` | `POST /agents/quote` | 免费 | 覆盖某国家的套餐，从便宜到贵排列。包含该国家的区域和全球套餐也算在内。 |
| `esim.order@v1` | `POST /agents/order` | 套餐价格，x402 | 购买一张 eSIM。返回激活码、二维码链接、安装链接、ICCID 和状态令牌。 |
| `esim.status@v1` | `POST /agents/status` | 免费 | 状态、已用流量、到期时间，以及再次返回激活码，仅限持有状态令牌者。 |
| 退款 | `POST /agents/refund` | 免费 | 为持有状态令牌者，把未使用 eSIM 的价款退回付款地址。 |

`GET /agents/listing.json` 描述这三种能力，并附卖家的公钥。

## 1. 找到卖家

- **你已经知道卖家。** 使用 `https://<域名>/agents/`。
- **通过 AIMarket 枢纽。** 连接枢纽的 MCP 服务器（`https://modelmarket.dev/mcp`），用类似 `"travel eSIM data plan for France"` 的意图调用 `market_search`。`esim.quote@v1` 的匹配结果会给出 `product_id` 和 `source_hub`。带上它们和报价输入调用 `market_invoke`：响应与下文相同，并给出卖家的下单 URL。枢纽只列出它已接纳节点的卖家。eSIM 的付款从不经过枢纽：你直接付给卖家。

## 2. 获取报价

```bash
curl -s -X POST https://modelmarket.dev/providers/esim/quote \
  -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

| 输入 | 类型 | |
|---|---|---|
| `country` | 字符串，必填 | 目的地的 ISO 3166-1 alpha-2 代码：`FR`、`JP`、`US`。 |
| `min_gb` | 数字 | 最少流量。 |
| `min_days` | 整数 | 最短有效期。 |
| `max_usd` | 数字 | 最高价格。 |
| `limit` | 整数，1 到 50 | 返回多少个套餐。 |

始终根据行程传入 `min_gb` 和 `min_days`。不传的话，最便宜的往往是 0.5 GB 一天的套餐。

响应（一个套餐，列表已缩短）：

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

- `coverage.kind` 取值为 `country`、`region` 或 `global`。
- `unused_valid_days`：购买后必须在这么多天内安装并首次使用 eSIM。
- `networks` 按国家列出运营商及其最佳网络类型。
- `order.url` 是购买该套餐的地址。

## 3. 验证卖家签名（可选）

免费响应带有 `X-Provider-Signature`：对 `{capability_id, product_id, input_sha256, result}` 的规范 JSON
所做的 Ed25519 签名，base64 编码。规范形式按键排序、无空格、非 ASCII 字符原样保留。`input_sha256` 是规范
输入的十六进制 SHA-256。公钥和 `product_id` 在 `/agents/listing.json` 中。枢纽会自行验证这个签名。直接调用
卖家时，请自己验证：

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

## 4. 购买

向 `<order.url>` 发送 `POST`，正文为 `{"offer_id": "<来自报价>"}`。第一次响应是 `402 Payment Required`，
附 x402 v2 条款：方案 `exact`，网络 `eip155:8453`（Base），USDC，套餐价格，收款方为卖家。任何 x402 v2 客户端
都能支付。你的钱包签署一份 EIP-3009 授权，不付 gas。使用 x402 包的 TypeScript 示例：

```bash
npm i @x402/fetch @x402/evm viem
```

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);   // 一个在 Base 上有 USDC 的钱包

// 保留封装器发出的付款头：重试必须带同一笔付款，而不是新的一笔。
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
  // 503 allocation_pending：eSIM 已下单但尚未就绪。稍后用同一笔付款重试。
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

**何时扣款。** 卖家验证付款、购买 eSIM，并且只在 eSIM 创建后才结算付款。被拒绝的订单不花钱。仍在准备中的订单（`503 allocation_pending`）尚未扣款；再次发送同一笔付款会取回同一张 eSIM，绝不会买第二张。结算结果不确定时返回 `settlement_pending`：请勿再次付款，请联系卖家。

响应：

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

**激活码是机密。** 任何拿到它的人都能安装这张 eSIM。只把它和二维码链接、安装链接交给旅行者本人。不要写入
日志，不要放进共享聊天、工单或日历事件。保存 `esim_tran_no` 和 `status_token`，以便之后查询 eSIM。

## 5. 错误

| 状态码 | `error` | 含义 | 怎么做 |
|---|---|---|---|
| 400 | `unknown_offer` | 该 `offer_id` 不在（或已不在）目录中。 | 重新报价。 |
| 402 | （x402 条款） | 需要付款，或付款被拒：金额不对、USDC 不足、已过期。 | 付款，或修复钱包。 |
| 402 | `self_send_not_allowed` | 付款钱包就是卖家自己的地址：facilitator 拒绝付款给自己。 | 换一个钱包付款。 |
| 402 | `invalid_exact_evm_insufficient_balance` | 付款钱包在 Base 上的 USDC 少于价格。 | 给钱包充值。 |
| 403 | `demo_mode` | 演示节点，不出售任何东西。 | 换一个在售的卖家。 |
| 409 | `supplier_<code>` | 批发商拒绝了订单：套餐下架、价格变动。没有扣款。 | 重新报价。 |
| 503 | `allocation_pending` | 已下单，尚未就绪。尚未扣款。 | 在 `Retry-After` 秒后用同一笔付款重试（见上例）。 |
| 503 | `catalogue_unavailable`、`payments_off` | 卖家暂时无法销售。 | 换个卖家，或稍后再试。 |
| 500 | `internal_error` | 订单失败。没有扣款。 | 稍后再试，或换个卖家。 |

### 一次真实购买，逐步演示

被拒绝的付款会在 `PAYMENT-REQUIRED` 头（base64 JSON）的 `error` 字段中说明原因，而不是在响应体中。
2026-10-14 在一个私有测试节点上，套件完成的第一笔智能体购买展示了两种结果：从卖家自己的钱包付款被拒绝；
从另一个钱包付款，几秒内交付并在 Base 上结算。

```text
$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
offer    TR_0.5_7 — Turkey 500MB 7Days — 0.31 USDC
payer    0x1218…Ad0a          ← 卖家自己的钱包
402 payment refused: self_send_not_allowed (a payment was attached)

$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
payer    0x9d24…66eF          ← 另一个钱包
delivered  esim_tran_no 26101413070046 · iccid 8997… · apn internet
activation LPA:1$rsp-eu.s… (the traveller's secret)
settled    0xe61f194b44148c5aba91bde2dbe106d2b7e5317233881a8bd245b994cc280982
```

`rails/examples/agent-buy.mjs` 就是这个买家，可直接运行。它会报价、显示价格，只有加上 `--yes` 才付款：

```bash
cd rails
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json         # 向枢纽列出的所有卖家询价
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json --yes   # 从正在销售的最便宜卖家购买
node examples/agent-buy.mjs https://<seller>/agents TR --key-file ~/agent-wallet.json --yes        # 只找一个卖家，不经枢纽
```

| 选项 | 作用 |
|---|---|
| `--hub <url>` | 通过这个枢纽查找卖家，并跳过处于演示模式的卖家。 |
| `--key-file <file>` | 智能体的钱包，`{"private_key": "0x…"}`。从不打印。也可以用 `AGENT_PRIVATE_KEY`。 |
| `--min-gb`、`--days` | 行程的需求。 |
| `--max-usd` | 单笔付款的上限，默认 1。超过这个金额，x402 客户端拒绝签名。 |
| `--refund` | 交付后立即申请退款：用于测试。 |
| `--no-share` | 不向枢纽报告这次购买：不会发送任何收据。 |

请把智能体的密钥放在单独的小额钱包里，密钥文件只允许你自己读取（`chmod 600`），切勿把私钥粘贴到聊天、
工单或文档中。用这条命令从编程智能体的终端完成的一次购买（含退款和全部交易）见[案例 3](cases.md)。

### 收据：向枢纽证明你收到了

每次交付都带有 `receipt` 和 `receipt_signature`：卖家签名确认已交付的内容，其中不含 eSIM 的任何秘密
（字段见[案例](cases.md)第 11.4 节）。如果你是通过枢纽找到卖家的，就把这两项连同付款交易一起交给该枢纽。
枢纽会在链上核对签名和转账，并为卖家记一次已确认交付：

```bash
curl -s -X POST https://modelmarket.dev/ai-market/v2/reputation/deliveries -H 'content-type: application/json' \
  -d '{"receipt": {…}, "signature": "<receipt_signature>", "transaction": "0x<付款交易>"}'
```

```json
{"recorded": true, "seller": {"source_hub": "https://esim.modelmarket.dev", "product_id": "esim-modelmarket"},
 "kind": "delivery", "deliveries_30d": {"confirmed": 2, "distinct_buyers": 2, "refunded": 1}}
```

新的转账需要几秒钟的确认：在此之前返回 `422`，请在十秒后重试。同一笔交易提交两次会得到
`recorded: false`，超过 30 天的收据会被拒绝。搜索结果中卖家的每个上架条目都带有同样的 `deliveries_30d`：
30 天内买家确认的交付和退款次数，以及确认它们的不同钱包数量。是否提交收据由你决定：枢纽只知道这个卖家
交付了，永远看不到明文的金额或你的地址。

## 6. 帮助旅行者安装

- **在另一块屏幕上显示二维码**（`qr_code_url`），用手机扫描。iPhone：设置 → 蜂窝网络 → 添加 eSIM。Android：通常是 设置 → 网络和互联网 → SIM 卡 → 添加 eSIM。
- **在手机本机上**：`install_url` 打开一个包含二维码和安装说明的页面。也可以手动输入激活码：在同一菜单中选择“手动输入详细信息”。
- 手机必须支持 eSIM，且未被运营商锁定。
- 出发前在 Wi-Fi 下安装。抵达后，把移动数据切换到 eSIM 线路，并为该线路开启数据漫游。如果手机询问，`apn` 就是接入点名称。
- 大多数套餐的有效期从在覆盖区域内首次连接网络时开始计算。`unused_valid_days` 限定 eSIM 最长可以等待多久。

## 7. 查询用量

```bash
curl -s -X POST https://<seller>/agents/status -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101410460022","status_token":"…"}'
```

响应包含 `state`（批发商自己的取值：`GOT_RESOURCE` 表示尚未安装；其他取值包括 `IN_USE`、`USED_UP` 和 `CANCEL`）、`installed`、`data_used_bytes`、`data_total_bytes`、`activated`、`expires`，以及再次返回的交付字段。错误的令牌会得到 `404 not_found`，与未知 eSIM 相同。

## 8. 申请退款

只要 eSIM 尚未安装、也没有产生流量，付款方就可以用同样的两个值取消它并拿回价款：

```bash
curl -s -X POST https://<seller>/agents/refund -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101505200012","status_token":"…"}'
```

`status` 为 `refunded` 时附带把 USDC 退回付款地址的交易；为 `due` 时由卖家手动支付。已安装或已使用的 eSIM 返回 `409 in_use`。卖家每个订单只退一次，且绝不超过价款。退款回答中带有退款收据（`receipt`、`receipt_signature`）：像交付收据一样，把它连同退款交易交给枢纽。[案例](cases.md)页面展示了真实例子：从智能体购买到退款，附全部交易。

## 9. 良好做法

- 按行程的真实需求报价，并在付款前向旅行者展示价格、流量和天数。
- 一个 `offer_id`、一笔付款、一个订单。要买两张 eSIM，就付两笔款。
- 卖家每 15 分钟刷新一次目录。如果报价后价格变了，402 会要求新的金额，或者批发商拒绝订单（`409`，不扣款）。402 中写明了金额：x402 客户端可以拒绝支付高于报价的金额。

如需在响应丢失后恢复交付，从首次下单起发送私密随机请求头 `X-Esim-Recovery`（至少 32 个 base64url 字符），与付款签名一起保存并在重试时重复使用。仅凭链上的公开付款数据无法获取 eSIM。示例会自动生成并保存此秘密值。
