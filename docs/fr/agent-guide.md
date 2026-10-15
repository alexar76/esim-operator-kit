# Guide pour les agents

Ce guide s'adresse aux développeurs d'agents IA qui réservent des voyages, planifient des itinéraires
ou font des courses. Votre agent peut trouver une eSIM data pour un pays, l'acheter en un seul
paiement x402 en USDC sur Base et remettre un QR code au voyageur. Sans compte, sans clé API, sans
page de paiement.

Chaque vendeur qui fait tourner le [kit d'opérateur eSIM](../../README.fr.md) répond aux trois mêmes appels
sur `https://<domaine du vendeur>/agents/`. Pour les essayer tout de suite, utilisez le nœud de
démonstration `https://modelmarket.dev/providers/esim` : il donne de vrais prix fondés sur le gros et
refuse les commandes avec `demo_mode`.

Autres documents : [présentation](../../README.fr.md) · [guide de l'opérateur](operator-guide.md) · [prise en main](rails.md) · [intégrations](integrations.md) · [SDK](sdk.md)

## Les trois capacités

| Capacité | Route | Prix | Rôle |
|---|---|---|---|
| `esim.quote@v1` | `POST /agents/quote` | gratuit | Les offres qui couvrent un pays, de la moins chère à la plus chère. Les forfaits régionaux et mondiaux qui incluent le pays comptent aussi. |
| `esim.order@v1` | `POST /agents/order` | le prix de l'offre, x402 | Achète une eSIM. Répond avec le code d'activation, le lien du QR, le lien d'installation, l'ICCID et un jeton de statut. |
| `esim.status@v1` | `POST /agents/status` | gratuit | État, données consommées, expiration, et à nouveau le code d'activation, pour qui détient le jeton de statut. |
| remboursement | `POST /agents/refund` | gratuit | Rembourse une eSIM inutilisée à l'adresse qui a payé, pour le détenteur du jeton de statut. |

`GET /agents/listing.json` décrit les trois, avec la clé publique du vendeur.

## 1. Trouvez un vendeur

- **Vous connaissez le vendeur.** Utilisez `https://<domaine>/agents/`.
- **Via un hub AIMarket.** Connectez le serveur MCP du hub (`https://modelmarket.dev/mcp`) et appelez `market_search` avec une intention comme `"travel eSIM data plan for France"`. Les résultats pour `esim.quote@v1` donnent `product_id` et `source_hub`. Appelez `market_invoke` avec eux et l'entrée de la demande : la réponse est la même que ci-dessous et indique l'URL de commande du vendeur. Le hub référence les vendeurs dont il a admis les nœuds. Le paiement de l'eSIM ne passe jamais par le hub : vous payez directement le vendeur.

## 2. Demandez des offres

```bash
curl -s -X POST https://modelmarket.dev/providers/esim/quote \
  -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

| Entrée | Type | |
|---|---|---|
| `country` | chaîne, obligatoire | Code ISO 3166-1 alpha-2 de la destination : `FR`, `JP`, `US`. |
| `min_gb` | nombre | Volume de données minimal. |
| `min_days` | entier | Validité minimale. |
| `max_usd` | nombre | Prix maximal. |
| `limit` | entier, de 1 à 50 | Nombre d'offres. |

Envoyez toujours `min_gb` et `min_days` d'après le voyage. Sans eux, l'offre la moins chère est souvent un forfait de 0,5 Go pour une journée.

La réponse (une offre, listes raccourcies) :

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

- `coverage.kind` vaut `country`, `region` ou `global`.
- `unused_valid_days` : l'eSIM doit être installée et utilisée une première fois dans ce nombre de jours après l'achat.
- `networks` liste les opérateurs par pays et leur meilleur type de réseau.
- `order.url` est l'adresse où s'achète cette offre.

## 3. Vérifiez la signature du vendeur (facultatif)

Les réponses gratuites portent `X-Provider-Signature` : une signature Ed25519 en base64 sur le JSON
canonique de `{capability_id, product_id, input_sha256, result}`. La forme canonique a les clés
triées, aucun espace et les caractères non ASCII tels quels. `input_sha256` est le SHA-256 en hex de
l'entrée canonique. La clé publique et `product_id` sont dans `/agents/listing.json`. Les hubs
vérifient cette signature eux-mêmes. Vérifiez-la vous-même quand vous appelez un vendeur directement :

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

## 4. Achetez

`POST <order.url>` avec `{"offer_id": "<issu de la demande>"}`. La première réponse est
`402 Payment Required` avec les conditions x402 v2 : schéma `exact`, réseau `eip155:8453` (Base),
USDC, le prix de l'offre, payé au vendeur. N'importe quel client x402 v2 le paie. Votre portefeuille
signe une autorisation EIP-3009 et ne paie pas de gas. En TypeScript avec les paquets x402 :

```bash
npm i @x402/fetch @x402/evm viem
```

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);   // un portefeuille avec de l'USDC sur Base

// Garder l'en-tête de paiement envoyé par l'enveloppe : une nouvelle tentative doit porter le même paiement, pas un nouveau.
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
  // 503 allocation_pending : l'eSIM est commandée mais pas encore prête. Même paiement, un peu plus tard.
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

**Ce qui est facturé.** Le vendeur vérifie le paiement, achète l'eSIM et ne règle le paiement qu'une fois l'eSIM créée. Une commande refusée ne coûte rien. Une commande encore en préparation (`503 allocation_pending`) n'est pas encore facturée ; le même paiement renvoyé récupère la même eSIM, jamais une seconde. Un paiement qui ne se règle pas annule l'eSIM.

La réponse :

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

**Le code d'activation est un secret.** Quiconque le détient peut installer l'eSIM. Donnez-le, avec
le lien du QR et le lien d'installation, au voyageur uniquement. Ne le journalisez pas et ne le mettez
pas dans un chat partagé, un ticket ou un événement d'agenda. Gardez `esim_tran_no` et `status_token`
pour consulter l'eSIM plus tard.

## 5. Erreurs

| Statut | `error` | Signification | Que faire |
|---|---|---|---|
| 400 | `unknown_offer` | L'`offer_id` n'est pas (plus) au catalogue. | Redemandez des offres. |
| 402 | (conditions x402) | Paiement requis, ou paiement refusé : mauvais montant, USDC insuffisant, expiré. | Payez, ou corrigez le portefeuille. |
| 402 | `self_send_not_allowed` | Le portefeuille payeur est l'adresse du vendeur lui-même : le facilitateur refuse un paiement à soi-même. | Payez depuis un autre portefeuille. |
| 402 | `invalid_exact_evm_insufficient_balance` | Le portefeuille payeur détient moins d'USDC sur Base que le prix. | Approvisionnez le portefeuille. |
| 403 | `demo_mode` | Un nœud de démonstration. Il ne vend rien. | Utilisez un vendeur qui vend. |
| 409 | `supplier_<code>` | Le grossiste a refusé la commande : forfait retiré, prix changé. Rien n'a été facturé. | Redemandez des offres. |
| 503 | `allocation_pending` | Commandée, pas encore prête. Pas encore facturée. | Même paiement après `Retry-After` secondes (exemple ci-dessus). |
| 503 | `catalogue_unavailable`, `payments_off` | Le vendeur ne peut pas vendre pour l'instant. | Un autre vendeur, ou plus tard. |
| 500 | `internal_error` | La commande a échoué. Rien n'a été facturé. | Plus tard, ou un autre vendeur. |

### Un vrai achat, pas à pas

Un paiement refusé donne sa raison dans le champ `error` de l'en-tête `PAYMENT-REQUIRED` (JSON en
base64), pas dans le corps. Le premier achat d'un agent avec le kit, le 2026-10-14 sur un nœud de
test privé, montre les deux réponses : payé depuis le portefeuille du vendeur lui-même, il a été
refusé ; payé depuis un autre portefeuille, il a été livré en quelques secondes et réglé sur Base.

```text
$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
offer    TR_0.5_7 — Turkey 500MB 7Days — 0.31 USDC
payer    0x1218…Ad0a          ← le portefeuille du vendeur lui-même
402 payment refused: self_send_not_allowed (a payment was attached)

$ AGENT_PRIVATE_KEY=0x… node examples/agent-buy.mjs http://127.0.0.1:9489 TR --yes
payer    0x9d24…66eF          ← un autre portefeuille
delivered  esim_tran_no 26101413070046 · iccid 8997… · apn internet
activation LPA:1$rsp-eu.s… (the traveller's secret)
settled    0xe61f194b44148c5aba91bde2dbe106d2b7e5317233881a8bd245b994cc280982
```

`rails/examples/agent-buy.mjs` est cet acheteur, prêt à lancer. Il demande des offres, affiche le
prix et ne paie qu'avec `--yes` :

```bash
cd rails
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json         # devis de tous les vendeurs listés par le hub
node examples/agent-buy.mjs TR --hub https://modelmarket.dev --key-file ~/agent-wallet.json --yes   # achète au vendeur le moins cher qui vend
node examples/agent-buy.mjs https://<seller>/agents TR --key-file ~/agent-wallet.json --yes        # un seul vendeur, sans hub
```

| Option | Ce qu'elle fait |
|---|---|
| `--hub <url>` | Trouve les vendeurs via ce hub et ignore ceux en mode démo. |
| `--key-file <file>` | Le portefeuille de l'agent, `{"private_key": "0x…"}`. Jamais affiché. `AGENT_PRIVATE_KEY` fonctionne aussi. |
| `--min-gb`, `--days` | Les besoins du voyage. |
| `--max-usd` | Le maximum qu'un paiement peut coûter, 1 par défaut. Le client x402 refuse de signer davantage. |
| `--refund` | Redemande l'argent juste après la livraison : pour un test. |
| `--no-share` | Ne signale pas l'achat au hub : aucun reçu ne lui est envoyé. |

Gardez la clé de l'agent dans un portefeuille dédié peu approvisionné, dans un fichier que vous seul
pouvez lire (`chmod 600`), et ne collez jamais une clé privée dans un chat, un ticket ou un document.
Un achat avec cette commande depuis le terminal d'un agent de programmation, avec son remboursement et
toutes les transactions, est le [cas 3](cases.md).

### Le reçu : montrez au hub que vous l'avez reçue

Chaque livraison porte `receipt` et `receipt_signature` : ce que le vendeur signe pour dire qu'il a
livré, sans aucun secret de l'eSIM (les champs sont dans les [cas réels](cases.md), section 11.4). Si
vous avez trouvé le vendeur via un hub, apportez les deux à ce hub avec la transaction du paiement. Le
hub vérifie la signature et le transfert on-chain, et compte une livraison confirmée pour le vendeur :

```bash
curl -s -X POST https://modelmarket.dev/ai-market/v2/reputation/deliveries -H 'content-type: application/json' \
  -d '{"receipt": {…}, "signature": "<receipt_signature>", "transaction": "0x<la transaction du paiement>"}'
```

```json
{"recorded": true, "seller": {"source_hub": "https://esim.modelmarket.dev", "product_id": "esim-modelmarket"},
 "kind": "delivery", "deliveries_30d": {"confirmed": 2, "distinct_buyers": 2, "refunded": 1}}
```

Un transfert récent a besoin de quelques secondes de confirmations : d'ici là la réponse est `422`,
réessayez donc après dix secondes. La même transaction deux fois reçoit `recorded: false`, et les reçus
de plus de 30 jours sont refusés. Les résultats de recherche portent le même `deliveries_30d` sur
chaque listing du vendeur : combien de livraisons et de remboursements les acheteurs ont confirmés en
30 jours, et combien de portefeuilles distincts les ont confirmés. Apporter les reçus est votre choix :
le hub apprend que ce vendeur a livré, jamais le montant ni votre adresse en clair.

## 6. Aidez le voyageur à l'installer

- **Un autre écran affiche le QR code** (`qr_code_url`) et le téléphone le scanne. iPhone : Réglages → Réseau cellulaire → Ajouter une eSIM. Android : en général Paramètres → Réseau et Internet → SIM → Ajouter une eSIM.
- **Sur le téléphone lui-même** : `install_url` ouvre une page avec le QR code et les instructions d'installation. Ou bien le code d'activation se saisit à la main : « saisir les informations manuellement » dans le même menu.
- Le téléphone doit gérer l'eSIM et ne pas être verrouillé par un opérateur.
- Installez avant le départ, en Wi-Fi. À l'arrivée, basculez les données mobiles sur la ligne eSIM et activez l'itinérance des données pour cette ligne. `apn` est le nom du point d'accès, si le téléphone le demande.
- Pour la plupart des forfaits, la validité court à partir de la première connexion dans la zone couverte. `unused_valid_days` borne le temps d'attente de l'eSIM.

## 7. Suivez la consommation

```bash
curl -s -X POST https://<seller>/agents/status -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101410460022","status_token":"…"}'
```

La réponse contient `state` (la valeur du grossiste : `GOT_RESOURCE` signifie pas encore installée ; d'autres valeurs sont `IN_USE`, `USED_UP` et `CANCEL`), `installed`, `data_used_bytes`, `data_total_bytes`, `activated`, `expires` et à nouveau les champs de livraison. Un mauvais jeton reçoit `404 not_found`, comme une eSIM inconnue.

## 8. Obtenir un remboursement

Tant que l'eSIM n'est pas installée et n'a consommé aucune donnée, le payeur peut la faire annuler et récupérer le prix, avec les deux mêmes valeurs :

```bash
curl -s -X POST https://<seller>/agents/refund -H 'content-type: application/json' \
  -d '{"esim_tran_no":"26101505200012","status_token":"…"}'
```

`status` vaut `refunded` avec la transaction des USDC renvoyés à l'adresse qui a payé, ou `due` quand le vendeur le paie à la main. Une eSIM installée ou utilisée reçoit `409 in_use`. Le vendeur rembourse une fois par commande, jamais plus que le prix. Une réponse de remboursement porte un reçu de remboursement (`receipt`, `receipt_signature`) : apportez-le au hub avec la transaction du remboursement, comme le reçu de livraison. La page des [cas réels](cases.md) en montre, de l'achat par un agent au remboursement, avec toutes les transactions.

## 9. Bonnes manières

- Demandez des offres selon les vrais besoins du voyage, et montrez au voyageur le prix, les données et la durée avant de payer.
- Un `offer_id`, un paiement, une commande. Pour acheter deux eSIM, faites deux paiements.
- Un vendeur rafraîchit son catalogue toutes les 15 minutes. Si un prix a changé après votre demande, le 402 réclame le nouveau montant, ou le grossiste refuse la commande (`409`, rien de facturé). Le 402 indique le montant : un client x402 peut refuser de payer plus que l'offre.
