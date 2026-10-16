# Incorporación: rieles, casos de uso e interacción

Esta guía es para negocios de eSIM que ya venden — operadores, MVNO, revendedores, plataformas de
viaje — y quieren a los agentes de IA como clientes: qué son los rieles de AIMarket, qué te da
conectarte, cómo se comunican las partes y las cuatro formas de entrar, conservando tu plataforma.

Otros documentos: [resumen](../../README.es.md) · [integraciones](integrations.md) · [referencia del SDK](sdk.md) · [guía del operador](operator-guide.md) · [guía para agentes](agent-guide.md)

## 1. Qué son los rieles

AIMarket es una federación de hubs donde los agentes de IA encuentran capacidades y pagan por ellas.
Funciona gracias a tres mecanismos, y el kit usa los tres:

| Mecanismo | Qué le da a un vendedor de eSIM |
|---|---|
| **Federación y descubrimiento** | Tu nodo publica un manifiesto firmado (`/.well-known/ai-market.json`). Un hub lo admite tras llamar a `esim.quote` con un país real y luego lista tus capacidades; los hubs comparten sus listados, así que un agente que busca en cualquiera de ellos te encuentra. |
| **Respuestas firmadas** | Cada respuesta gratuita (ofertas, estado) lleva una firma Ed25519 sobre la petición y el resultado. Los hubs la verifican antes de listarte o reenviarte; los agentes también pueden. |
| **Pagos x402** | La llamada de pago (`esim.order`) responde `402 Payment Required` con su precio. El agente firma una autorización USDC en Base; tu nodo la liquida mediante un facilitador, directamente a tu monedero. |

El hub enruta el descubrimiento, nunca el dinero. No guarda fondos, no ve el código de activación y
no cobra comisión por las ventas directas.

```mermaid
flowchart LR
  subgraph discovery["Descubrimiento (hub)"]
    M["Tu manifiesto<br/>firmado con la clave del nodo"] --> ADM["Comprobación de admisión<br/>esim.quote con un país real"]
    ADM --> L["Listado: esim.quote@v1, esim.status@v1"]
    L --> S["market_search de los agentes<br/>en cualquier hub de la federación"]
  end
  subgraph trade["Venta (directa)"]
    Q["oferta — gratis, firmada"] --> O["pedido — 402, x402 USDC"]
    O --> D["entrega — código de activación"]
    D --> ST["estado — gratis, con token"]
  end
  S --> Q
```

## 2. Por qué conectarse

- **Un canal de ventas nuevo que no necesita que le vendas.** Los agentes comparan las ofertas de
  todos los vendedores por precio, datos y cobertura. Un buen precio se encuentra sin marketing.
- **Sin integración por cada plataforma de agentes.** Un contrato, `esim.*@v1`, es lo que cada
  agente usa con cada vendedor.
- **Dinero sin procesador.** Los USDC en Base llegan a tu monedero cuando la eSIM se entrega. Sin
  contracargos: un pago se liquida solo tras la entrega, y una liquidación incierta requiere conciliación.
- **Tus sistemas siguen siendo tuyos.** El kit llama a tu proveedor o sistema de aprovisionamiento
  con cinco endpoints e informa a tu CRM y facturación de cada venta con webhooks firmados.
- **Las mismas ofertas para personas.** La tienda opcional vende el mismo catálogo con el mismo
  margen, en cinco idiomas, en diez redes de pago.

## 3. Casos de uso

### 3.1 Un agente de viajes reserva un viaje y añade datos

```mermaid
sequenceDiagram
  participant U as Viajero
  participant Ag as Agente de viajes (IA)
  participant Hub as Hub de AIMarket
  participant N as Nodo vendedor
  U->>Ag: "Tokio, 12 días, necesito datos"
  Ag->>Hub: market_search "eSIM Japan"
  Hub-->>Ag: vendedores con esim.quote@v1
  Ag->>N: quote {country: JP, min_gb: 5, min_days: 12}
  N-->>Ag: 3 ofertas, firmadas
  Ag->>U: "5 GB, 15 días, $6.40 — ¿compro?"
  U->>Ag: sí
  Ag->>N: pedido + x402 USDC
  N-->>Ag: código de activación, QR, enlace de instalación
  Ag->>U: código QR y pasos de instalación
```

### 3.2 Un revendedor existente añade el canal de agentes

Ya vendes eSIM en tu propio sitio, de tu propio suministro. Ejecutas el kit con `SUPPLIER=http` e
implementas cinco endpoints en tu plataforma. Tu tienda sigue como está; la del kit puede quedarse
apagada. Cada venta a un agente llega a tus sistemas como webhook `agent_order.delivered` y a tu
monedero como USDC.

### 3.3 Un MVNO o una teleco expone sus propios perfiles

Tu SM-DP+ o tu API de aprovisionamiento crea los perfiles. `POST /orders` del proveedor HTTP reserva
uno, `GET /profiles` devuelve su código de activación cuando está listo y `cancel` devuelve uno sin
usar al stock. El kit añade el pago x402, las firmas y la federación.

### 3.4 Un asistente de viajes de empresa o de gastos

Un asistente que reserva viajes para empleados compra una eSIM por viaje, guarda `esim_tran_no` y
`status_token`, y consulta `esim.status` antes de que el empleado vuelva: datos usados, días
restantes. Finanzas concilia cada pago USDC con los eventos de webhook.

### 3.5 Una superapp o una mini app de Telegram

Una app centrada en el monedero (TON, Telegram) llama al nodo vendedor desde su backend: oferta,
luego pedido con x402, o envía a sus usuarios a la tienda que acepta USDT en TON. El mismo nodo sirve
a ambos.

### 3.6 Un operador nuevo con solo una cuenta mayorista

Una cuenta de eSIM Access, un servidor y un dominio: `docker compose up` da el nodo para agentes, el
nodo de federación y la tienda. Así funciona esim-shop.modelmarket.dev, en modo demo.

## 4. Las cuatro formas de entrar

| | A · Kit completo | B · Proveedor HTTP | C · SDK | D · Contrato |
|---|---|---|---|---|
| **Tienes** | una cuenta de eSIM Access, Airalo o eSIM Go | un sistema de aprovisionamiento, cualquier lenguaje | una plataforma Node.js | tu propia API para agentes |
| **Construyes** | nada | 5 endpoints | un objeto proveedor | 3 endpoints de `esim.*@v1` |
| **El kit ejecuta** | todo | todo menos el suministro | dentro de tu servicio | la prueba de conformidad |
| **Pagos de personas** | 10 redes | 10 redes | los tuyos | los tuyos |
| **Hasta la primera oferta** | una hora | un día | un día | unos días |

```mermaid
flowchart TB
  subgraph A["A · kit completo"]
    A1["Caddy"] --> A2["store"] & A3["rails"] & A4["node"]
    A2 & A3 --> A5["eSIM Access"]
  end
  subgraph B["B · proveedor HTTP"]
    B1["Caddy"] --> B2["store (opcional)"] & B3["rails"] & B4["node"]
    B2 & B3 -->|"HTTP firmado"| B5["Tu sistema<br/>/catalog /orders /profiles /balance"]
  end
  subgraph C["C · SDK"]
    C1["Tu servicio"] --> C2["createNode()"]
    C2 --> C3["tu objeto proveedor"]
  end
  subgraph D["D · contrato"]
    D1["Tu API para agentes<br/>cualquier lenguaje"] --> D2["esim-rails check"]
  end
```

Después, cada camino se anuncia a un hub de la misma forma (mira la [guía del operador](operator-guide.md),
sección 9): genera `node.toml`, arranca `aimarket node`, ejecuta `aimarket doctor` y luego `aimarket node knock`.

## 5. Cómo se comunican las partes

### 5.1 El pedido de un agente, de principio a fin

```mermaid
sequenceDiagram
  autonumber
  participant Ag as Agente
  participant N as Nodo vendedor
  participant F as Facilitador x402
  participant S as Proveedor
  participant CRM as Tus sistemas
  Ag->>N: POST /order {offer_id}
  N-->>Ag: 402 + PAYMENT-REQUIRED (exact, USDC, eip155:8453, precio, payTo)
  Ag->>N: POST /order + PAYMENT-SIGNATURE
  N->>F: verificar la autorización
  N->>S: pedido {transaction_id = hash(pagador, nonce), plan, coste}
  S-->>N: order_ref
  loop hasta que el perfil esté listo (≤ 45 s)
    N->>S: profiles {order_ref}
  end
  N->>F: liquidar
  F-->>N: liquidado (USDC en tu monedero)
  N-->>Ag: 200, entrega
  N-)CRM: agent_order.delivered (webhook firmado)
```

Si el perfil no está listo en 45 segundos, el agente recibe `503 allocation_pending` y no se liquida
nada; el mismo pago enviado de nuevo encuentra el mismo pedido. Si la liquidación es incierta, el nodo conserva el perfil y envía `agent_order.settlement_pending`. El proceso automático concilia el pago original con datos finalizados de Base antes de entregar o cancelar.

### 5.2 Un pedido en la tienda

```mermaid
stateDiagram-v2
  [*] --> awaiting_payment: pedido creado (precio fijo 20 min)
  awaiting_payment --> delivered: pago encontrado, eSIM comprada
  awaiting_payment --> refund_due: pagado, el proveedor rechazó
  awaiting_payment --> underpaid: menos que el precio
  awaiting_payment --> expired: nada en 24 h
  delivered --> [*]
  refund_due --> [*]: tú reembolsas
  underpaid --> [*]: tú reembolsas o completas
  expired --> [*]
```

Cada cambio de estado es un webhook `order.<status>` a tus sistemas.

### 5.3 A dónde va el dinero

```mermaid
flowchart LR
  P["Viajero"] -->|"USDT · USDC · TON<br/>10 redes"| W["Tus monederos"]
  AG["Agente"] -->|"USDC en Base, x402"| W
  W -->|"tú recargas"| SUP["Tu saldo en el proveedor"]
  SUP -->|"coste por eSIM"| K["perfiles"]
  HUB["Hub de AIMarket"] -.->|"sin dinero, sin comisión"| W
```

### 5.4 Quién ve qué

| Parte | Ve | Nunca ve |
|---|---|---|
| Hub de AIMarket | tu manifiesto, las ofertas que reenvía, sus firmas | pagos, códigos de activación, tu coste |
| Agente | ofertas, precios, su propia entrega | tu coste, otros compradores |
| Proveedor (eSIM Access o el tuyo) | pedidos con un id de transacción derivado del pago | el comprador, el pago |
| Tus sistemas (webhooks) | pedido, precio, coste, método, referencia del pago, dirección del pagador, id del perfil | código de activación, token del pedido |
| El disco del kit | pedidos sin códigos de activación, el hash de cada token de pedido | códigos de activación, claves privadas |

## 6. Conectar tus sistemas

| Tu sistema | Se conecta mediante | Qué fluye |
|---|---|---|
| Suministro de eSIM, SM-DP+, stock de perfiles | proveedor HTTP (`SUPPLIER=http`) | entran planes y costes; salen pedidos, perfiles, cancelaciones |
| CRM, helpdesk | webhooks (`WEBHOOK_URL`) | cada pedido y su estado |
| Facturación, contabilidad, ERP | webhooks | precio, coste, método, referencia del pago |
| Tu propia tienda o app | la API del nodo vendedor | ofertas y pedidos, como cualquier agente |
| Precios | `MARGIN_PCT`, `MIN_MARGIN_USD`, tu lista de precios (`PRICES_FILE`, CSV o JSON, p. ej. exportada de tu facturación), o `cost_usd` por plan desde tu sistema | tu precio: coste + margen, o el precio fijo de tu lista |

La [referencia del SDK](sdk.md) tiene cada endpoint, cuerpo y firma, con código.

## 7. Lista de incorporación para un operador existente

1. Lee la [guía para agentes](agent-guide.md) para ver qué llamarán los agentes.
2. Elige un camino (sección 4). Para B, implementa los cinco endpoints; `rails/examples/operator-backend.mjs` es una referencia.
3. Ejecuta el kit con `DEMO_MODE=1` y tu proveedor; comprueba que el catálogo carga (`/agents/healthz`).
4. Trae tus precios: exporta tus precios minoristas a `config/prices.csv` (guía del operador, paso 5); `scripts/catalog.mjs` muestra qué puso cada línea y qué líneas no eligen ningún plan.
5. Apunta `WEBHOOK_URL` a un endpoint de prueba de tu CRM; haz un pedido de prueba (guía del operador, sección 10).
6. Ejecuta `esim-rails check https://<tu dominio>/agents --country <un país que vendas>` hasta que cada línea sea ✓.
7. Arranca el nodo de federación y anúncialo a un hub. Búscate con `market_search`.
8. Pon `DEMO_MODE=0`. Ya vendes a agentes.

## 8. Preguntas

**¿Los hubs cobran comisión?** No en las ventas directas: el agente paga a tu nodo por x402.

**¿Puedo mantener mi tienda y mis precios?** Sí. Camino B o C, con la tienda del kit apagada, o
encendida con tu margen. Tu lista de precios actual se carga como CSV: precios fijos por plan o por
país y tamaño, un margen por país o región, planes desactivados. Agentes y personas ven los mismos
precios.

**¿Qué agentes pueden comprar?** Cualquier cliente que hable x402 v2 con USDC en Base, y cualquier
cliente MCP conectado a un hub de AIMarket para el descubrimiento.

**¿Y si el hub cae?** Tu nodo sigue vendiendo a los agentes que conocen su URL; el descubrimiento
vuelve cuando vuelve el hub.

**¿Puedo vender pases por día o recargas?** No en v1: `esim.*@v1` vende planes fijos de un tamaño y
una duración dados.

**¿Necesito una empresa?** El comerciante eres tú: tus condiciones, tus reembolsos, tus impuestos.
Mira la guía del operador, sección 13.

## Elige tu ruta de incorporación

| Tu perfil | Punto de entrada | Criterio de éxito |
|---|---|---|
| Viajero | Tienda | Código de activación/QR completo tras pagar y acceso posterior mediante el enlace privado del pedido. |
| Agente de IA externo | [Guía del agente](agent-guide.md) | Descubrir → cotizar → comprar directamente con x402 → guardar entrega y token → consultar estado directamente. `agent-buy.mjs --yes --output ./delivery.json` guarda un archivo privado. |
| Nuevo revendedor | Kit completo + cuenta mayorista propia | Catálogo demo, configuración de pagos y compra completa. Stripe sirve a la tienda; los agentes pagan directamente con x402 USDC en Base. |
| Operador con backend propio | Proveedor HTTP (cinco endpoints), SDK JavaScript o contrato público | Una provisión por ID de transacción, consulta de consumo y cancelación del perfil sin usar. Conservas infraestructura y contratos. |
| Propietario de hub independiente | [Hub propio](own-hub.md), `./onboard.sh --hub` | Identidad, claves y directorio propios; ofertas descubribles desde otro hub. Un nodo vendedor no constituye por sí solo un hub independiente. |

El software es gratuito. El operador paga alojamiento, inventario mayorista, procesamiento de pagos y costes de red. La federación es un canal potencial de ventas, sin garantía de compradores ni ingresos. MCP permite descubrir e invocar herramientas; no sustituye provisión ni pagos.

`./onboard.sh --check` no cambia archivos: comprueba configuración, secretos obligatorios y el servicio vendedor. No realiza pagos ni confirma admisión en la federación. Una ejecución posterior sin `--hub`/`--node` conserva el modo. Solo se publican cotizaciones en los hubs; estado y reembolso con tokens privados se solicitan directamente al vendedor.

Las transferencias EVM requieren una firma del monedero emisor que vincule el hash al pedido; no se admiten retiros de exchanges mediante este método. La tarjeta requiere almacenamiento del navegador para conservar acceso tras Stripe. Guarda el enlace privado.

Desde 0.3.0, el nodo y la tienda incluidos concilian automáticamente los pagos USDC/Base inciertos al iniciar y cada 30 segundos. Comprueban datos finalizados: remitente, destinatario, importe exacto y nonce originales; nunca vuelven a cobrar. Una transferencia confirmada permite la entrega. Una autorización finalizada que caducó sin usarse o fue cancelada cierra el pedido impagado; se reintenta cancelar el perfil si falla el proveedor. Los errores RPC y los resultados no finalizados mantienen el pedido pendiente; la finalidad puede tardar más que el intervalo de consulta. Configura `BASE_RPC` con soporte para bloques `finalized` y registros históricos. Los pedidos antiguos sin punto de control requieren revisión del operador. Las **transferencias de reembolso** inciertas siguen requiriendo revisión y mantienen su reserva presupuestaria. Al integrar el SDK, llama a `startReconciliation(() => node.reconcile())`; el almacén debe implementar `all()`, `get()` y `put()`. Conserva el token privado original para recuperar la entrega del agente.

Las correcciones del 2026-10-15 están en este código fuente, todavía sin publicar en npm ni desplegar. Instala `./rails` desde este checkout para probarlas. El paywall requiere `onSettleFailure` y `onSettled`; consulta el [ejemplo SDK](sdk.md).

Para producción, configura un RPC de archivo en `BASE_RPC`: el servicio público predeterminado `https://base.drpc.org` limita las consultas y el historial; tras una interrupción larga, la recuperación puede quedar pendiente hasta conectar un RPC de archivo.
