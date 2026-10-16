# Guía para agentes

Esta guía es para desarrolladores de agentes de IA que reservan viajes, planifican itinerarios o
hacen recados. Tu agente puede encontrar una eSIM de datos para un país, comprarla con un solo pago
x402 en USDC en Base y entregar al viajero un código QR. Sin cuenta, sin clave API, sin página de
pago.

Cada vendedor que usa el [kit de operador eSIM](../../README.es.md) responde a las mismas tres llamadas en
`https://<dominio del vendedor>/agents/`. Para probarlas ahora, usa el nodo demo
`https://modelmarket.dev/providers/esim`: da precios reales basados en el mayorista y rechaza los
pedidos con `demo_mode`.

Otros documentos: [resumen](../../README.es.md) · [guía del operador](operator-guide.md) · [incorporación](rails.md) · [integraciones](integrations.md) · [SDK](sdk.md)

## Las tres capacidades

| Capacidad | Ruta | Precio | Hace |
|---|---|---|---|
| `esim.quote@v1` | `POST /agents/quote` | gratis | Ofertas que cubren un país, de la más barata a la más cara. También cuentan los planes regionales y globales que incluyen el país. |
| `esim.order@v1` | `POST /agents/order` | el precio de la oferta, x402 | Compra una eSIM. Responde con el código de activación, el enlace al QR, el enlace de instalación, el ICCID y un token de estado. |
| `esim.status@v1` | `POST /agents/status` | gratis | Estado, datos usados, caducidad y de nuevo el código de activación, para quien tenga el token de estado. |
| reembolso | `POST /agents/refund` | gratis | Reembolsa una eSIM sin usar a la dirección que pagó, para quien tenga el token de estado. |

`GET /agents/listing.json` describe las tres, con la clave pública del vendedor.

## 1. Encuentra un vendedor

- **Conoces al vendedor.** Usa `https://<dominio>/agents/`.
- **A través de un hub de AIMarket.** Conecta el servidor MCP del hub (`https://modelmarket.dev/mcp`) y llama a `market_search` con una intención como `"travel eSIM data plan for France"`. Las coincidencias de `esim.quote@v1` dan `product_id` y `source_hub`. Llama a `market_invoke` con ellos y la entrada de la consulta: la respuesta es la misma que abajo y nombra la URL de pedido del vendedor. El hub lista los vendedores cuyos nodos ha admitido. El pago de la eSIM nunca pasa por el hub: pagas directamente al vendedor.

## 2. Pide ofertas

```bash
curl -s -X POST https://modelmarket.dev/providers/esim/quote \
  -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

| Entrada | Tipo | |
|---|---|---|
| `country` | cadena, obligatoria | Código ISO 3166-1 alfa-2 del destino: `FR`, `JP`, `US`. |
| `min_gb` | número | Datos mínimos. |
| `min_days` | entero | Validez mínima. |
| `max_usd` | número | Precio máximo. |
| `limit` | entero, de 1 a 50 | Cuántas ofertas. |

Envía siempre `min_gb` y `min_days` del viaje. Sin ellos, la oferta más barata suele ser un plan de 0,5 GB para un día.

La respuesta (una oferta, listas acortadas):

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

- `coverage.kind` es `country`, `region` o `global`.
- `unused_valid_days`: la eSIM debe instalarse y usarse por primera vez en ese número de días tras la compra.
- `networks` lista los operadores por país y su mejor tipo de red.
- `order.url` es donde se compra esta oferta.

## 3. Comprueba la firma del vendedor (opcional)

Las respuestas gratuitas llevan `X-Provider-Signature`: una firma Ed25519 en base64 sobre el JSON
canónico de `{capability_id, product_id, input_sha256, result}`. La forma canónica tiene las claves
ordenadas, sin espacios y los caracteres no ASCII tal cual. `input_sha256` es el SHA-256 en hex de la
entrada canónica. La clave pública y `product_id` están en `/agents/listing.json`. Los hubs
comprueban esta firma por sí mismos. Compruébala tú cuando llames a un vendedor directamente:

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

## 4. Compra

`POST <order.url>` con `{"offer_id": "<de la consulta>"}`. La primera respuesta es
`402 Payment Required` con las condiciones x402 v2: esquema `exact`, red `eip155:8453` (Base), USDC,
el precio de la oferta, a pagar al vendedor. Cualquier cliente x402 v2 lo paga. Tu monedero firma una
autorización EIP-3009 y no paga gas. En TypeScript con los paquetes x402:

```bash
npm i @x402/fetch @x402/evm viem
```

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);   // un monedero con USDC en Base

// Guarda la cabecera de pago que envía el envoltorio: un reintento debe llevar el mismo pago, no uno nuevo.
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
  // 503 allocation_pending: la eSIM está pedida pero aún no lista. El mismo pago, un poco más tarde.
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

**Por qué se cobra.** El vendedor verifica el pago, compra la eSIM y liquida el pago solo cuando la eSIM existe. Un pedido rechazado no cuesta nada. Un pedido que aún se prepara (`503 allocation_pending`) todavía no se cobra; el mismo pago enviado de nuevo recoge la misma eSIM, nunca una segunda. Una liquidación incierta devuelve `settlement_pending`: no pagues de nuevo; contacta con el vendedor.

La respuesta:

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

**El código de activación es un secreto.** Quien lo tenga puede instalar la eSIM. Dáselo, junto con
el enlace al QR y el de instalación, solo al viajero. No lo registres en logs ni lo pongas en un chat
compartido, un ticket o un evento de calendario. Guarda `esim_tran_no` y `status_token` para
consultar la eSIM más tarde.

## 5. Errores

| Estado | `error` | Significado | Qué hacer |
|---|---|---|---|
| 400 | `unknown_offer` | El `offer_id` no está (ya) en el catálogo. | Consulta de nuevo. |
| 402 | (condiciones x402) | Hace falta pagar, o el pago fue rechazado: importe incorrecto, USDC insuficiente, caducado. | Paga, o arregla el monedero. |
| 402 | `self_send_not_allowed` | El monedero que paga es la propia dirección del vendedor: el facilitador rechaza un pago a uno mismo. | Paga desde otro monedero. |
| 402 | `invalid_exact_evm_insufficient_balance` | El monedero que paga tiene menos USDC en Base que el precio. | Recarga el monedero. |
| 403 | `demo_mode` | Un nodo demo. No vende nada. | Usa un vendedor que venda. |
| 409 | `supplier_<code>` | El mayorista rechazó el pedido: plan retirado, precio cambiado. No se te cobró. | Consulta de nuevo. |
| 503 | `allocation_pending` | Pedido, aún no listo. Aún no cobrado. | El mismo pago tras `Retry-After` segundos (ejemplo de arriba). |
| 503 | `catalogue_unavailable`, `payments_off` | El vendedor no puede vender ahora. | Otro vendedor, o más tarde. |
| 500 | `internal_error` | El pedido falló. No se te cobró. | Más tarde, u otro vendedor. |

### Una compra real, paso a paso

Un pago rechazado explica el motivo en el campo `error` de la cabecera `PAYMENT-REQUIRED` (JSON en
base64), no en el cuerpo. La primera compra de un agente con el kit, el 2026-10-14 contra un nodo de
prueba privado, muestra las dos respuestas: pagada desde el propio monedero del vendedor, fue
rechazada; pagada desde otro monedero, se entregó en segundos y se liquidó en Base.

```text
$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
offer    TR_0.5_7 — Turkey 500MB 7Days — 0.31 USDC
payer    0x1218…Ad0a          ← el propio monedero del vendedor
402 payment refused: self_send_not_allowed (a payment was attached)

$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
payer    0x9d24…66eF          ← otro monedero
delivered  esim_tran_no 26101413070046 · iccid 8997… · apn internet
activation LPA:1$rsp-eu.s… (the traveller's secret)
settled    0xe61f194b44148c5aba91bde2dbe106d2b7e5317233881a8bd245b994cc280982
```

`rails/examples/agent-buy.mjs` es este comprador, listo para usar. Consulta ofertas, muestra el
precio y solo paga con `--yes`:

```bash
cd rails
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json         # cotiza a todos los vendedores que lista el hub
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json --yes   # compra al vendedor más barato que vende
node examples/agent-buy.mjs https://<seller>/agents TR --key-file ~/agent-wallet.json --yes        # un solo vendedor, sin hub
```

| Opción | Qué hace |
|---|---|
| `--hub <url>` | Busca vendedores a través de este hub y se salta los que están en modo demo. |
| `--key-file <file>` | La cartera del agente, `{"private_key": "0x…"}`. Nunca se imprime. `AGENT_PRIVATE_KEY` también funciona. |
| `--min-gb`, `--days` | Lo que necesita el viaje. |
| `--max-usd` | Lo máximo que puede costar un pago, 1 por defecto. El cliente x402 se niega a firmar más. |
| `--refund` | Pide el dinero de vuelta justo después de la entrega: para una prueba. |
| `--no-share` | No informa de la compra al hub: no le llega ningún recibo. |

Guarda la clave del agente en una cartera propia con poco saldo, en un archivo que solo tú puedas
leer (`chmod 600`), y nunca pegues una clave privada en un chat, un ticket o un documento. Una compra
con este comando desde la terminal de un agente de programación, con su reembolso y todas las
transacciones, es el [caso 3](cases.md).

### El recibo: demuestra al hub que la recibiste

Cada entrega lleva `receipt` y `receipt_signature`: lo que el vendedor firma para decir que entregó,
sin ningún secreto de la eSIM (los campos están en los [casos](cases.md), sección 11.4). Si
encontraste al vendedor a través de un hub, lleva ambos a ese hub con la transacción del pago. El hub
comprueba la firma y la transferencia on-chain, y cuenta una entrega confirmada para el vendedor:

```bash
curl -s -X POST https://modelmarket.dev/ai-market/v2/reputation/deliveries -H 'content-type: application/json' \
  -d '{"receipt": {…}, "signature": "<receipt_signature>", "transaction": "0x<la transacción del pago>"}'
```

```json
{"recorded": true, "seller": {"source_hub": "https://esim.modelmarket.dev", "product_id": "esim-modelmarket"},
 "kind": "delivery", "deliveries_30d": {"confirmed": 2, "distinct_buyers": 2, "refunded": 1}}
```

Una transferencia reciente necesita unos segundos de confirmaciones: hasta entonces la respuesta es
`422`, así que reintenta a los diez segundos. La misma transacción dos veces recibe `recorded: false`,
y los recibos de más de 30 días se rechazan. Los resultados de búsqueda llevan el mismo
`deliveries_30d` en cada listing del vendedor: cuántas entregas y reembolsos confirmaron los
compradores en 30 días, y cuántas carteras distintas los confirmaron. Llevar los recibos es tu
decisión: el hub sabe que este vendedor entregó, nunca el importe ni tu dirección en claro.

## 6. Ayuda al viajero a instalarla

- **Otra pantalla muestra el código QR** (`qr_code_url`) y el teléfono lo escanea. iPhone: Ajustes → Datos móviles → Añadir eSIM. Android: normalmente Ajustes → Redes e Internet → SIM → Añadir eSIM.
- **En el propio teléfono**: `install_url` abre una página con el código QR e instrucciones de instalación. O se escribe el código de activación a mano: «introducir datos manualmente» en el mismo menú.
- El teléfono debe admitir eSIM y no estar bloqueado por un operador.
- Instálala antes de salir, con wifi. Al llegar, pasa los datos móviles a la línea eSIM y activa la itinerancia de datos en esa línea. `apn` es el nombre del punto de acceso, si el teléfono lo pide.
- En la mayoría de los planes, la validez cuenta desde la primera conexión en la zona de cobertura. `unused_valid_days` limita cuánto puede esperar la eSIM.

## 7. Consulta el consumo

```bash
curl -s -X POST https://<seller>/agents/status -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101410460022","status_token":"…"}'
```

La respuesta tiene `state` (el valor del mayorista: `GOT_RESOURCE` significa aún no instalada; otros son `IN_USE`, `USED_UP` y `CANCEL`), `installed`, `data_used_bytes`, `data_total_bytes`, `activated`, `expires` y de nuevo los campos de entrega. Un token incorrecto recibe `404 not_found`, igual que una eSIM desconocida.

## 8. Obtén un reembolso

Mientras la eSIM no esté instalada y no haya gastado datos, quien pagó puede cancelarla y recuperar el precio, con los mismos dos valores:

```bash
curl -s -X POST https://<seller>/agents/refund -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101505200012","status_token":"…"}'
```

`status` es `refunded` con la transacción de los USDC devueltos a la dirección que pagó, o `due` cuando el vendedor lo paga a mano. Una eSIM instalada o usada recibe `409 in_use`. El vendedor reembolsa una vez por pedido y nunca más que el precio. Una respuesta de reembolso lleva un recibo de reembolso (`receipt`, `receipt_signature`): llévalo al hub con la transacción del reembolso, igual que el recibo de entrega. La página de [casos](cases.md) muestra casos reales, de la compra de un agente al reembolso, con todas las transacciones.

## 9. Buenas maneras

- Consulta con las necesidades reales del viaje y muestra al viajero el precio, los datos y los días antes de pagar.
- Un `offer_id`, un pago, un pedido. Para comprar dos eSIM, haz dos pagos.
- Un vendedor actualiza su catálogo cada 15 minutos. Si un precio cambió después de tu consulta, el 402 pide el nuevo importe, o el mayorista rechaza el pedido (`409`, nada cobrado). El 402 indica el importe: un cliente x402 puede negarse a pagar más que la consulta.

Para recuperar una entrega tras perder la respuesta, envía un encabezado privado aleatorio `X-Esim-Recovery` (32+ caracteres base64url) desde la primera petición. Guárdalo con la firma del pago y reutiliza ambos. Los datos públicos de la cadena no bastan. El ejemplo genera y guarda este secreto automáticamente.
