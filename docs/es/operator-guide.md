# Guía del operador

Esta guía te lleva de un servidor vacío a tu primera venta y después cubre el trabajo diario:
pedidos, reembolsos, saldo, copias de seguridad, actualizaciones. Reserva una hora para la
configuración. Casi toda esa hora es esperar a la cuenta mayorista y al registro DNS.

Otros documentos: [resumen](../../README.es.md) · [guía para agentes](agent-guide.md) · [incorporación](rails.md) · [integraciones](integrations.md) · [SDK](sdk.md)

## El camino corto

Cuando tengas el servidor, el dominio y la cuenta mayorista (secciones 2 a 4), un comando hace el resto, en modo demo:

```bash
git clone https://github.com/alexar76/esim-operator-kit.git && cd esim-operator-kit
./onboard.sh            # tienda, nodo vendedor para agentes, nodo de federación; solo pregunta lo que falta
./onboard.sh --hub      # lo mismo con tu propio hub: own-hub.md
```

Te pide el dominio, el nombre de la tienda, un id para tus ofertas y las claves del mayorista (se escriben ocultas, van a `secrets/` y nunca se imprimen). Después lo arranca todo en modo demo, espera al HTTPS, comprueba el nodo vendedor, escribe `node.toml`, pasa la misma comprobación de admisión que te harán otros hubs y pregunta antes de unirse a la federación. Lo que queda después: direcciones y claves de pago (sección 8), `DEMO_MODE=0` y el pedido de prueba (sección 10). Vuelve a ejecutarlo tras cualquier cambio: solo hace lo que falta. `./onboard.sh --check` no cambia nada y dice qué está listo. Las secciones siguientes son lo que hace, para quien prefiera hacerlo a mano.

**¿Ya tienes nginx u otro servidor web en los puertos 80 y 443?** El comando lo detecta y pregunta. Con nginx pone el kit detrás: publica los servicios del kit en `127.0.0.1` (`docker-compose.override.yml`, el Caddy del kit queda apagado), escribe el sitio de tu dominio y obtiene el certificado con certbot, cada paso tras preguntar. Con cualquier otro servidor imprime las rutas que añadir. `PROXY` en `.env` recuerda la elección.

## 1. Qué vas a montar

```text
            https://esim.example.com
                      │
                   Caddy (80, 443, Let's Encrypt)
      ┌───────────────┼──────────────────────────────┐
      │               │                              │
   store          rails (/agents/*)              node (/.well-known/ai-market.json, /ai-market/*)
 compran personas  compran agentes por x402      los hubs encuentran tus ofertas
      │               │
      └──── tu saldo en eSIM Access ────┘      los pagos van a tus monederos
```

- **store** es el sitio web: páginas por país, pago, la página del pedido con el código QR.
- **rails** es el nodo vendedor para agentes de IA: ofertas gratuitas, pedidos de pago por x402.
- **node** es `aimarket node`. Comunica a los hubs de AIMarket lo que vendes para que los agentes te encuentren. Arráncalo el último, cuando todo lo demás funcione.
- **Caddy** obtiene y renueva el certificado HTTPS y reparte las peticiones a los tres servicios.

store y rails compran de la misma cuenta mayorista. Ninguno guarda dinero: los compradores pagan a
tus direcciones, y el kit solo lee las redes para ver llegar los pagos.

## 2. Antes de empezar

| Necesitas | Notas |
|---|---|
| Una cuenta en eSIM Access | Regístrate en [esimaccess.com](https://esimaccess.com). Paso 3. |
| $50 o más de saldo | La primera recarga es de al menos $50 (tarjeta, PayPal o Alipay; transferencia bancaria desde $3.000). |
| Un servidor Linux | Docker Engine con el plugin compose, una IPv4 pública, puertos 80 y 443 abiertos. Bastan 1 vCPU y 1 GB de memoria. |
| Un dominio o subdominio | Por ejemplo `esim.example.com`, con un registro A hacia el servidor. |
| Direcciones de monedero | EVM (una dirección para las siete redes EVM), Tron, Solana, TON. Cualquier combinación sirve. |
| Condiciones y política de privacidad | Dos páginas públicas. eSIM Access espera que el sitio de cada revendedor las enlace. |
| Opcional: una clave de Coinbase Developer Platform | Activa USDC sin gas en Base para personas y los pedidos x402 de los agentes. Paso 8. |
| Opcional: Stripe | Activa las tarjetas. Paso 8. |

## 3. La cuenta mayorista

1. Regístrate en [esimaccess.com](https://esimaccess.com) y confirma tu correo.
2. Recarga el saldo (en la consola: saldo, luego recarga). El mínimo es $50. Cada eSIM que vendes se paga con este saldo al precio mayorista: es tu existencia, no una comisión.
3. Abre la sección de desarrollador (API) de la consola. Muestra dos valores: el **AccessCode** y la **SecretKey**. Trata la SecretKey como una contraseña.

No hay sandbox: cada pedido por la API es real. Dos maneras baratas de probar:

- Pide el plan más barato (unas decenas de céntimos) y cancela el perfil sin usar. Los perfiles sin usar se reembolsan al saldo.
- Antes de tu primera recarga, pide al soporte un pequeño crédito de prueba: Customer Support, luego Submit ticket, tipo «Top Up». Explica que estás integrando la API y necesitas unos dólares para pedidos de prueba.

## 4. El servidor y el dominio

1. Crea un registro A de tu dominio hacia la IPv4 del servidor. Compruébalo desde tu ordenador:

```bash
dig +short esim.example.com
```

2. Instala Docker en el servidor ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)) y comprueba que compose funciona:

```bash
docker compose version
```

3. Abre los puertos 80 y 443 en el cortafuegos del servidor y en el panel de tu proveedor. Let's Encrypt comprueba el puerto 80 antes de emitir el certificado.

## 5. Descarga el kit y configúralo

```bash
git clone https://github.com/alexar76/esim-operator-kit.git
cd esim-operator-kit
cp .env.example .env
nano .env
```

| Ajuste | Qué poner |
|---|---|
| `DOMAIN` | Tu dominio, sin `https://`. |
| `STORE_NAME` | El nombre que ven los compradores en la cabecera, el título y la ventana del monedero. |
| `PRODUCT_ID` | Un identificador corto de tus ofertas en la federación, por ejemplo `esim-mytravel`. Letras, cifras, guiones. |
| `STORE_CONTACT` | El correo al que escriben los compradores. Se muestra en el pie. |
| `STORE_TERMS_URL`, `STORE_PRIVACY_URL` | Tus condiciones y tu política de privacidad. Se enlazan en el pie. |
| `MARGIN_PCT` | Tu margen sobre el precio mayorista, en porcentaje. `100` lo duplica. |
| `MIN_MARGIN_USD` | El margen mínimo por eSIM, en dólares. Los planes baratos llevan al menos esto encima. |
| `PRICES_FILE` | Opcional: tu lista de precios sobre la fórmula, `/config/prices.csv`. Mira abajo. |
| `DEMO_MODE` | `1` muestra un aviso y no cobra. `0` vende. Mantén `1` hasta el paso 10. |
| `PAY_TO_EVM`, `PAY_TO_TON`, `PAY_TO_TRON`, `PAY_TO_SOLANA` | Tus direcciones de cobro. Una línea vacía desactiva esa red. |
| `EVM_CHAINS` | Qué redes EVM ofrecer, por su chain id: `8453` Base, `1` Ethereum, `42161` Arbitrum, `10` OP, `137` Polygon, `56` BNB Chain, `43114` Avalanche. |
| `EVM_RPC_<chain id>`, `SOLANA_RPC` | Opcional: tus propios endpoints RPC. Los públicos tienen límites. |
| `SUPPLIER` | De dónde salen las eSIM: `esimaccess` (por defecto), `airalo`, `esimgo` o `http` para tu propio sistema. Mira [integraciones](integrations.md). |
| `WEBHOOK_URL`, `WEBHOOK_SECRET_FILE` | Opcional: el estado de cada pedido, firmado, hacia tu CRM, facturación, Telegram o una hoja. Mira [integraciones](integrations.md). |
| `REFUND_KEY_FILE`, `REFUND_MAX_USD`, `REFUND_DAILY_MAX_USD` | Opcional: reembolsos automáticos de eSIM sin usar a los agentes, desde una cartera que tú eliges. Mira [casos](cases.md). |

**Cómo se calcula el precio.** Precio = mayorista × (1 + `MARGIN_PCT`/100), pero nunca menos que mayorista + `MIN_MARGIN_USD`. Se redondea al céntimo hacia arriba. Con los valores por defecto (100 % y $1.00), Francia 1 GB por 7 días cuesta $0.70 al por mayor y se vende a $1.70. Un plan de 20 GB a $9.00 al por mayor se vende a $18.00. Las tiendas minoristas de eSIM suelen pedir de $4 a $8 por los planes pequeños, así que tienes margen.

**Tu propia lista de precios.** Si ya tienes precios minoristas, o quieres otro margen para algunos países, ponlos en una lista de precios. La fórmula de arriba pone precio a todo plan que la lista no elige.

```bash
cp config/prices.example.csv config/prices.csv
nano config/prices.csv                   # luego descomenta PRICES_FILE=/config/prices.csv en .env
docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv
```

Un ejemplo:

```csv
match,gb,days,price_usd,margin_pct,min_margin_usd
TR,1,7,4.50,,
TR,,,,80,
JP,,,,,2.00
global,,,,60,
US_0.1_7,,,off,,
```

| Columna | Qué dice |
|---|---|
| `match` | Qué planes: un id de oferta (`TR_1_7`, como lo muestra la cotización), un país (`TR`: los planes propios de ese país), `region` o `global` (planes multipaís) o `*` (todos los planes). |
| `gb`, `days` | Opcional, junto a un país, `region`, `global` o `*`: solo los planes de ese tamaño y duración. `gb` coincide con un ±10 %, porque los proveedores cuentan el gigabyte como 1000 o 1024 MB. |
| `price_usd` | Un precio fijo, por ejemplo `4.50`, u `off`: el plan no se vende. |
| `margin_pct`, `min_margin_usd` | O la fórmula con estos números para los planes elegidos. Uno vacío conserva el valor de `.env`. |

Gana la línea más específica: un id de oferta sobre un país, un país sobre `region` y `global`, estos sobre `*`, y luego la línea que rellena más de `gb` y `days`; de dos igual de específicas, la de más arriba. Un precio fijo nunca vende a pérdida: si el coste mayorista sube por encima, la fórmula pone precio a ese plan hasta que cambies la lista, y la revisión de precios del paso 7 lo avisa. El archivo se lee al arrancar; una lista con un error detiene el arranque e indica el número de línea, así que una errata nunca vende a un precio que no quisiste. Sirven las exportaciones de hojas de cálculo: se leen el punto y coma y la coma decimal. Si los precios viven en tu facturación, expórtalos a este archivo de forma programada. Aplica un cambio con `docker compose restart store rails`.

**Solo direcciones.** Cada `PAY_TO_*` es una dirección donde recibes. El kit nunca necesita una clave privada ni una frase semilla. Si una guía o una persona te pide ponerla en `.env`, está mal.

## 6. Coloca las claves

Las claves viven en `secrets/`, un valor por archivo. La carpeta está fuera de git y se monta en solo lectura en los contenedores. Escribe los valores sin que queden en el historial de la shell:

```bash
cd ~/esim-operator-kit
umask 077
printf 'AccessCode: '; read -rs v; printf %s "$v" > secrets/esimaccess_access_code; echo
printf 'SecretKey: '; read -rs v; printf %s "$v" > secrets/esimaccess_secret_key; echo
unset v
```

Los contenedores se ejecutan como el usuario 1000, así que dale los archivos de claves y las carpetas de datos:

```bash
mkdir -p data/store data/rails data/node data/caddy
sudo chown 1000:1000 secrets/*
sudo chown -R 1000:1000 data/store data/rails data/node
ls -l secrets
```

La carpeta sigue siendo tuya, así que puedes añadir archivos más tarde. Cada archivo de clave nuevo necesita el mismo `sudo chown 1000:1000` y `chmod 600`.

[secrets/README.md](../../secrets/README.md) lista todos los archivos opcionales: la clave CDP, las claves de tonapi y TronGrid y las claves de Stripe.

## 7. Arranca en modo demo

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail 30 store rails
```

La primera compilación tarda unos minutos. Después comprueba tres cosas:

```bash
curl -s https://esim.example.com/agents/healthz
curl -s -X POST https://esim.example.com/agents/quote -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

- La respuesta de salud dice `"ok":true` y da el número de ofertas, unas 1.700 con eSIM Access. `"demo":true` es lo esperado por ahora.
- La consulta de ofertas lista planes reales a tus precios.
- `https://esim.example.com/` muestra tu tienda con el aviso de demo. Abre un país y recorre el pago: cada paso responde «Modo demo: los pagos están desactivados».

Si la respuesta de salud dice `"ok":false`, las claves mayoristas son incorrectas o no se pueden leer. Mira la sección 14.

**Revisa tus precios.** Esto imprime tu saldo y las mejores ofertas de los países que quieras, a tus precios y con el precio mayorista al lado. Con una lista de precios muestra también qué puso cada línea y qué líneas no eligen ningún plan:

```bash
docker compose exec -T rails node scripts/catalog.mjs FR ES IT US JP TH
```

Cambia `MARGIN_PCT` o `MIN_MARGIN_USD` en `.env` y aplícalo con `docker compose up -d`. Tras editar la lista de precios, `docker compose restart store rails`.

## 8. Pagos

Cada método se activa cuando su dirección (y su clave, si la necesita) está puesta. Activa los que
usan tus compradores. USDT en Tron es la forma más común de pagar en cripto; le siguen USDT y USDC en redes EVM y USDT en TON.

| Método | Qué poner | Cómo paga el comprador | Cómo lo confirma la tienda |
|---|---|---|---|
| USDC en Base, sin gas | `PAY_TO_EVM` + `secrets/cdp_api_key.json` | Firma un mensaje en un monedero del navegador y no paga gas. | El facilitador de CDP liquida la firma. Primero se entrega la eSIM, después se liquida el pago; si el resultado es incierto, se requiere conciliación. |
| USDC / USDT en 7 redes EVM | `PAY_TO_EVM` (+ `EVM_CHAINS`) | Envía la transferencia desde un monedero del navegador, o desde cualquier monedero o exchange y pega el hash de la transacción. | Lee el recibo: una transferencia de ese token hacia ti, de al menos el precio, posterior al pedido. Espera confirmaciones: 3 en Ethereum y BNB Chain, 10 en Polygon, 1 en las demás. Una transacción paga un pedido. |
| USDT en Tron | `PAY_TO_TRON` (+ `secrets/trongrid_key`) | Envía exactamente el importe mostrado, desde TronLink en la página o desde cualquier monedero. | Cada pedido pide el precio más unas millonésimas de dólar (como mucho $0.0099 más). Ese importe exacto identifica el pedido entre tus transferencias USDT confirmadas. |
| USDC en Solana | `PAY_TO_SOLANA` (+ `SOLANA_RPC`) | Abre el enlace de Solana Pay o escanea su QR (Phantom, Solflare, Backpack). | Cada pedido tiene su propia clave de referencia, que el monedero añade a la transferencia. La tienda encuentra la transacción por ella. |
| USDT o TON en TON | `PAY_TO_TON` (+ `secrets/tonapi_key`) | Conecta Tonkeeper u otro monedero con TON Connect, o paga a mano con el comentario indicado. | Encuentra la transferencia por el comentario del pedido a través de tonapi.io. |
| Tarjetas | `secrets/stripe_secret_key` + `secrets/stripe_webhook_secret` | Stripe Checkout. | El webhook de Stripe. |

Un pago enviado (todos los métodos salvo Base sin gas y tarjetas) se busca durante 24 horas después
de crear el pedido.

**Clave de Coinbase Developer Platform.** Activa USDC sin gas en Base para personas y los pedidos x402 de los agentes. Sin ella, la tienda sigue aceptando USDC en Base como transferencia normal, pero el nodo para agentes no acepta pedidos.

1. Entra en [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com) y crea un proyecto.
2. API Keys: crea una clave API secreta y descarga su archivo JSON.
3. Copia el archivo a `secrets/cdp_api_key.json` (contiene `id` y `privateKey`), luego ejecuta `sudo chown 1000:1000 secrets/cdp_api_key.json && sudo chmod 600 secrets/cdp_api_key.json` y `docker compose up -d`.

**Stripe.** En el panel de Stripe, añade un endpoint de webhook `https://<tu dominio>/api/stripe/webhook` con los eventos `checkout.session.completed` y `checkout.session.async_payment_succeeded`. Pon la clave secreta (`sk_live_…`) en `secrets/stripe_secret_key` y el secreto de firma del endpoint (`whsec_…`) en `secrets/stripe_webhook_secret`.

**Límites.** Los endpoints públicos de TronGrid, tonapi y RPC bastan para una tienda pequeña. Cuando tengas ventas regulares, añade una clave gratuita de TronGrid y una de tonapi, y apunta `EVM_RPC_<id>` y `SOLANA_RPC` a tu propio proveedor.

## 9. Agentes y federación

El nodo rails ya responde a los agentes en `https://<tu dominio>/agents/`. Para que los agentes te
encuentren buscando en un hub, describe tu nodo a la federación y anúncialo.

1. Genera `node.toml` a partir de tu catálogo real. Usa tu nombre, tu dominio y tu `PRODUCT_ID`:

```bash
docker compose exec -T rails node scripts/node-toml.mjs \
  --name "My Travel eSIM" --url https://esim.example.com \
  --product esim-mytravel --upstream http://rails:9490 > node.toml
head -20 node.toml
```

2. Arranca el nodo:

```bash
docker compose --profile federation up -d --build node
curl -s https://esim.example.com/.well-known/ai-market.json | head -c 400; echo
```

3. Compruébalo como lo hará un hub y anúncialo:

```bash
docker compose exec node aimarket doctor --url https://esim.example.com
docker compose exec node aimarket node knock --config /node/node.toml --hub https://modelmarket.dev
```

Antes de listarte, el hub llama a `esim.quote` con un país real. Una vez listado, un agente que busque «eSIM France» en el hub obtiene tus ofertas. El pago nunca pasa por el hub: el agente paga a tu nodo por x402, directamente a tu monedero.

`data/node/` guarda la clave de firma del nodo, que es su identidad en la federación. Haz copia de seguridad. Repite el punto 1 cuando el catálogo gane países.

**Entregas confirmadas.** Cada pedido y cada reembolso que responde tu nodo lleva un recibo firmado con la clave del vendedor del nodo (`data/rails/provider_ed25519.pem`, la que firma cada respuesta gratuita), y el `node.toml` del paso 1 publica su parte pública como `provider_pubkey`. Un comprador que te encontró a través de un hub puede llevar el recibo y su transacción a ese hub; el hub comprueba ambos on-chain y cuenta una entrega confirmada. Tus listings muestran entonces `deliveries_30d` (entregas y reembolsos que los compradores confirmaron en 30 días, y cuántos compradores distintos), y la puntuación de confianza del hub para ti cuenta un éxito por cada comprador distinto. No hay nada que hacer aparte del paso 1; un `node.toml` escrito antes del 15 de octubre de 2026 no tiene la clave, así que repite el paso 1. Guarda copia de la clave del vendedor con el resto de `data/rails/`: los recibos firmados con una clave perdida ya no coinciden con tu listing. Los [casos](cases.md), caso 3, lo muestran con compradores reales.

Comprueba que la clave está publicada:

```bash
curl -s https://esim.example.com/ai-market/v2/manifest | grep -o provider_pubkey | head -1    # provider_pubkey
```

Para ello la imagen `node/` necesita `aimarket-hub` 3.15.27 o posterior, que es la que instala el kit. Un nodo anterior deja fuera la clave, y entonces el hub responde `404` a los recibos de tus compradores.

**Tu propio hub en lugar del nodo.** `./onboard.sh --hub` ejecuta un hub completo en tu dominio: lista tus ofertas él mismo, da a los agentes tu propia dirección para búsqueda y MCP, y se federa con los demás hubs. Si antes funcionaba el nodo, el dominio conserva su identidad. Ver [tu propio hub](own-hub.md).

## 10. El pedido de prueba y la puesta en marcha

1. En `.env`, pon `DEMO_MODE=0` y revisa otra vez las direcciones `PAY_TO_*`, carácter a carácter.
2. Aplícalo:

```bash
docker compose up -d
curl -s https://esim.example.com/agents/healthz
```

Debe aparecer `"demo":false`. `"paid_orders":true` aparece cuando la clave CDP y `PAY_TO_EVM` están puestas.

3. Compra el plan más barato de un país en tu propia tienda, con un monedero tuyo que no sea la dirección de la tienda, en la red que esperas que más usen los compradores. La página del pedido debe mostrar el código QR en menos de un minuto. No pagues desde el propio monedero `PAY_TO_EVM`: el facilitador x402 rechaza un pago de una dirección a sí misma (`self_send_not_allowed`).
4. Comprueba el pago en tu monedero y el pedido en la consola de eSIM Access.
5. Si no quieres quedarte la eSIM, cancela el perfil sin usar en la consola de eSIM Access. El precio mayorista vuelve a tu saldo. Tu pago fue a tu propio monedero de todos modos.

Prueba el canal de agentes de la misma forma, con un monedero de prueba pequeño que tenga un dólar de
USDC en Base (no tu monedero `PAY_TO_EVM`). El comando consulta, muestra el precio y solo paga con `--yes`:

```bash
cd rails && node examples/agent-buy.mjs https://esim.example.com/agents TR --key-file ~/test-wallet.json --yes --refund
```

El archivo de la clave guarda `{"private_key": "0x…"}` y nunca se imprime. La respuesta nombra la eSIM
(`esim_tran_no`) y la transacción de liquidación en Base. `--refund` pide el dinero de vuelta enseguida:
el nodo cancela la eSIM sin usar en el proveedor (el coste vuelve a tu saldo) y, con los reembolsos
activados ([casos](cases.md), sección 7), devuelve el dinero a la cartera de prueba; sin ellos, el
reembolso queda registrado como pendiente. Cuando un hub te liste, ejecuta lo mismo con
`--hub https://modelmarket.dev` en lugar de tu URL: es el camino que siguen los agentes, recibos
incluidos. La [guía para agentes](agent-guide.md) muestra una ejecución real, rechazo incluido.

Haz lo mismo con cada red que hayas activado. Y ya estás vendiendo.

## 11. El día a día

**Pedidos.** La tienda los guarda en `data/store/orders.json`. Lista los que te necesitan:

```bash
sudo jq -r '.[] | select(.status=="refund_due" or .status=="underpaid")
  | [.created_at, .id, .status, .method, (.price_cents/100), .payment.ref, (.payment.payer // "-"), (.error // "")] | @tsv' \
  data/store/orders.json
```

| Estado | Significado | Qué hacer |
|---|---|---|
| `awaiting_payment` | El pedido existe y aún no ha llegado nada. | Nada. |
| `delivered` | Pagado, y la eSIM está con el comprador. | Nada. |
| `refund_due` | Pagado, pero el mayorista no entregó: se acabó el saldo o retiraron el plan. | Reembolsa al comprador a `payment.payer` en la misma red, o recarga y véndele el plan a mano. |
| `underpaid` | Llegó un pago por debajo del precio. | Reembólsalo, o pide al comprador la diferencia y entrega a mano. |
| `expired` | No llegó nada en 24 horas. | Nada. Un pago que llegue después no se empareja; lo verás en tu monedero sin pedido. |

Los compradores escriben a `STORE_CONTACT`. Pídeles el número de pedido de la dirección de su página (`/o/<número>`). No pidas el enlace completo: contiene su token.

**Saldo.** Mantén el saldo mayorista por encima de unos días de ventas. Cuando no cubre un pedido, el pago dice «Este plan no está disponible temporalmente» en lugar de cobrar. Compruébalo con:

```bash
docker compose exec -T rails node scripts/catalog.mjs | head -1
```

**Registros.**

```bash
docker compose logs -f --tail 100 store rails
```

Los registros nunca contienen un código de activación ni una clave.

**Copias de seguridad.** Copia `data/` y `secrets/` cada día, fuera del servidor:

- `data/store/`: los pedidos. Si los pierdes, las páginas de pedido de los compradores dejan de funcionar.
- `data/rails/`: los pedidos de los agentes, la clave de sus tokens de estado y la clave de firma del nodo. Ambas carpetas guardan también el último catálogo (`catalog-snapshot.json`): si el proveedor deja de responder, se sirve hasta seis horas, y en modo demo todo lo que haga falta.
- `data/node/`: la identidad en la federación.
- `data/hub/`: tu propio hub, si lo tienes: sus claves, base de datos, ajustes y token de administrador.
- `data/caddy/`: los certificados. Se pueden volver a emitir, pero la copia evita los límites de Let's Encrypt.

**Actualizaciones.**

```bash
git pull
docker compose up -d --build
docker compose --profile federation up -d --build node    # si usas el nodo de federación
```

Lee las notas de la versión antes de actualizar una tienda que vende.

## 12. Pedidos de agentes

Los agentes compran con `POST /agents/order` (mira la [guía para agentes](agent-guide.md)). El nodo verifica el pago x402, compra el perfil y liquida solo cuando el perfil existe. Si la liquidación es incierta, conserva el perfil para conciliar el pago; no cobres de nuevo. Los pedidos de agentes se registran en `data/rails/orders.json`, sin códigos de activación. Los USDC llegan a `PAY_TO_EVM` en Base.

**Reembolsos.** Un agente puede pedir el reembolso de una eSIM que no ha instalado: `POST /agents/refund` con el número de la eSIM y el token de estado. El nodo cancela la eSIM en el mayorista, que te devuelve el saldo, y devuelve el precio a la dirección que pagó. La devolución es automática solo si das al nodo una cartera de reembolsos (`REFUND_KEY_FILE`, con los límites `REFUND_MAX_USD` y `REFUND_DAILY_MAX_USD`); sin ella el reembolso queda pendiente y el webhook `agent_order.refund_due` te avisa de que debes pagarlo. Configuración, reglas y un reembolso real con sus transacciones: [casos](cases.md).

## 13. Leyes, impuestos y condiciones

Esto no es asesoramiento legal ni fiscal. Consulta a un asesor en tu país antes de vender.

- **El vendedor eres tú.** Tus compradores te compran a ti, con tus condiciones. eSIM Access es tu proveedor. Los reembolsos, el soporte y los impuestos son tuyos.
- **Condiciones y privacidad.** eSIM Access espera que tu sitio publique condiciones de venta y una política de privacidad. Pon `STORE_TERMS_URL` y `STORE_PRIVACY_URL`. Las condiciones deben cubrir los reembolsos (una eSIM instalada normalmente no se reembolsa), la compatibilidad (un teléfono libre que admita eSIM) y cuándo empieza la validez.
- **IVA en la UE.** Los servicios de telecomunicaciones a consumidores tributan en el país del comprador. La ventanilla única (OSS) permite declarar todos los países de la UE en una sola declaración. Fuera de la UE las reglas cambian.
- **Cripto.** Si puedes aceptar cripto, y cómo contabilizarlo, depende de tu país. Guarda los registros de pedidos: la tienda tiene la red, la transacción y el importe de cada pago.
- **Datos personales.** La tienda no pide nada a los compradores: ni nombre ni correo. Guarda el pedido (plan, precio, método) y el pago (transacción y dirección del pagador). Una dirección de blockchain puede ser un dato personal según el RGPD, así que menciónala en tu política de privacidad.

## 14. Resolución de problemas

| Qué ves | Causa | Solución |
|---|---|---|
| El navegador dice que el certificado no es válido | El DNS aún no apunta aquí, o el puerto 80 está cerrado | `dig +short <dominio>`, abre el puerto 80, luego `docker compose restart caddy` y lee `docker compose logs caddy`. |
| `healthz` muestra `"ok":false` o la tienda no muestra países | Las claves mayoristas son incorrectas o el usuario 1000 no puede leerlas. Los registros dicen `catalogue not loaded yet: <code>`. | `sudo rm secrets/esimaccess_*`, escríbelas de nuevo como en el paso 6, luego `docker compose restart store rails`. |
| `EACCES` o `permission denied` en los registros | Las carpetas de datos no son del usuario 1000 | `sudo chown -R 1000:1000 data/store data/rails data/node` |
| El pago dice «Este plan no está disponible temporalmente» | El saldo mayorista no cubre el plan | Recarga eSIM Access. |
| Cada pago responde «Modo demo: los pagos están desactivados» | `DEMO_MODE=1` | Paso 10. |
| Falta una red en el pago | Su `PAY_TO_*` está vacío | Revisa `.env`, luego `docker compose up -d`. |
| La tienda se reinicia una y otra vez | Un `PAY_TO_*` no es una dirección válida: la tienda se niega a arrancar con ella | `docker compose logs store` la nombra. Corrige `.env`. |
| No se encuentra un pago en Tron | El importe no era exacto, a menudo porque un exchange descontó su comisión | Busca la transferencia en tu monedero y reembólsala, o entrega a mano. Pide a los compradores enviar el importe exacto desde un monedero. |
| No se encuentra un pago en TON | Faltaba el comentario o se cambió | Igual que arriba. Con TON Connect el monedero pone el comentario solo. |
| `aimarket doctor` informa de una dirección privada | El `url` de `node.toml` no es tu dominio público | Genera `node.toml` de nuevo (paso 9) con `--url https://<dominio>`. |
| `node` no arranca: `node.toml` es una carpeta | Compose la creó porque el archivo no existía | `rmdir node.toml`, genera el archivo (paso 9), arranca de nuevo. |
| Un pago de prueba es rechazado: `402 … self_send_not_allowed` | Pagaste desde la propia dirección `PAY_TO_EVM` de la tienda; el facilitador rechaza un pago a uno mismo | Paga desde otro monedero. |
| El nodo registra `bazaar … resource must start with 'https://'` | `PUBLIC_URL` es http (una prueba local) | Nada que hacer en un nodo de prueba; en producción `PUBLIC_URL` es tu dominio https. |
| La tienda o el nodo se detiene al arrancar: `…prices.csv, line N: …` | Una línea de la lista de precios no se puede leer | Corrige esa línea; `docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv` revisa todo el archivo. Luego `docker compose restart store rails`. |
