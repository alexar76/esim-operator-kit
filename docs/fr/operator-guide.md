# Guide de l'opérateur

Ce guide vous mène d'un serveur vide à votre première vente, puis couvre le travail quotidien :
commandes, remboursements, solde, sauvegardes, mises à jour. Prévoyez une heure pour l'installation.
L'essentiel de cette heure, c'est attendre le compte de gros et l'enregistrement DNS.

Autres documents : [présentation](../../README.fr.md) · [guide pour les agents](agent-guide.md) · [prise en main](rails.md) · [intégrations](integrations.md) · [SDK](sdk.md)

## Le chemin court

Une fois le serveur, le domaine et le compte de gros prêts (sections 2 à 4), une commande fait le reste, en mode démo :

```bash
git clone https://github.com/alexar76/esim-operator-kit.git && cd esim-operator-kit
./onboard.sh            # boutique, nœud vendeur pour les agents, nœud de fédération ; ne demande que ce qui manque
./onboard.sh --hub      # la même chose avec votre propre hub : own-hub.md
```

Elle demande votre domaine, le nom de la boutique, un identifiant pour vos offres et les clés du grossiste (saisies masquées, écrites dans `secrets/`, jamais affichées). Puis elle démarre tout en mode démo, attend le HTTPS, vérifie le nœud vendeur, écrit `node.toml`, lance la même vérification d'admission que les autres hubs feront sur vous, et demande avant de rejoindre la fédération. Ensuite il reste : adresses et clés de paiement (section 8), `DEMO_MODE=0`, puis la commande test (section 10). Relancez-la après tout changement : elle ne fait que ce qui manque. `./onboard.sh --check` ne change rien et dit ce qui est prêt. Les sections suivantes décrivent ce qu'elle fait, pour qui préfère le faire à la main.

**nginx ou un autre serveur web tourne déjà sur les ports 80 et 443 ?** La commande le remarque et demande. Avec nginx, elle place le kit derrière : elle publie les services du kit sur `127.0.0.1` (`docker-compose.override.yml`, le Caddy du kit reste éteint), écrit le site de votre domaine et obtient le certificat avec certbot, chaque étape après vous avoir demandé. Avec tout autre serveur, elle affiche les routes à ajouter. `PROXY` dans `.env` garde le choix.

## 1. Ce que vous installez

```text
            https://esim.example.com
                      │
                   Caddy (80, 443, Let's Encrypt)
      ┌───────────────┼──────────────────────────────┐
      │               │                              │
   store          rails (/agents/*)              node (/.well-known/ai-market.json, /ai-market/*)
 achats des gens  achats des agents via x402     les hubs trouvent vos offres
      │               │
      └──── votre solde eSIM Access ────┘      les paiements vont sur vos portefeuilles
```

- **store** est le site : pages par pays, paiement, page de commande avec le QR code.
- **rails** est le nœud vendeur pour les agents IA : offres gratuites, commandes payantes via x402.
- **node** est `aimarket node`. Il indique aux hubs AIMarket ce que vous vendez, pour que les agents vous trouvent. Démarrez-le en dernier, quand tout le reste fonctionne.
- **Caddy** obtient et renouvelle le certificat HTTPS et répartit les requêtes entre les trois services.

store et rails achètent sur le même compte de gros. Aucun des deux ne détient d'argent : les acheteurs
paient à vos adresses, et le kit ne fait que lire les réseaux pour voir arriver les paiements.

## 2. Avant de commencer

| Il vous faut | Remarques |
|---|---|
| Un compte eSIM Access | Inscription sur [esimaccess.com](https://esimaccess.com). Étape 3. |
| 50 $ ou plus sur le solde | La première recharge est d'au moins 50 $ (carte, PayPal ou Alipay ; virement bancaire à partir de 3 000 $). |
| Un serveur Linux | Docker Engine avec le plugin compose, une IPv4 publique, ports 80 et 443 ouverts. 1 vCPU et 1 Go de mémoire suffisent. |
| Un domaine ou sous-domaine | Par exemple `esim.example.com`, avec un enregistrement A vers le serveur. |
| Des adresses de portefeuille | EVM (une adresse pour les sept réseaux EVM), Tron, Solana, TON. N'importe quelle combinaison convient. |
| Des CGV et une politique de confidentialité | Deux pages publiques. eSIM Access attend que le site de chaque revendeur y renvoie. |
| Facultatif : une clé Coinbase Developer Platform | Active l'USDC sans gas sur Base pour les personnes et les commandes x402 des agents. Étape 8. |
| Facultatif : Stripe | Active les cartes. Étape 8. |

## 3. Le compte de gros

1. Inscrivez-vous sur [esimaccess.com](https://esimaccess.com) et confirmez votre e-mail.
2. Rechargez le solde (dans la console : solde, puis recharge). Le minimum est de 50 $. Chaque eSIM vendue est payée sur ce solde au prix de gros : c'est votre stock, pas une commission.
3. Ouvrez la section développeur (API) de la console. Elle affiche deux valeurs : l'**AccessCode** et la **SecretKey**. Traitez la SecretKey comme un mot de passe.

Il n'y a pas de bac à sable : chaque commande API est réelle. Deux façons de tester à peu de frais :

- Commandez le forfait le moins cher (quelques dizaines de centimes), puis annulez le profil non utilisé. Les profils non utilisés sont remboursés sur le solde.
- Avant votre première recharge, demandez au support un petit crédit de test : Customer Support, puis Submit ticket, type « Top Up ». Expliquez que vous intégrez l'API et qu'il vous faut quelques dollars pour des commandes de test.

## 4. Le serveur et le domaine

1. Créez un enregistrement A de votre domaine vers l'IPv4 du serveur. Vérifiez depuis votre ordinateur :

```bash
dig +short esim.example.com
```

2. Installez Docker sur le serveur ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)) et vérifiez que compose fonctionne :

```bash
docker compose version
```

3. Ouvrez les ports 80 et 443 dans le pare-feu du serveur et dans le panneau de votre hébergeur. Let's Encrypt vérifie le port 80 avant d'émettre le certificat.

## 5. Récupérez le kit et configurez-le

```bash
git clone https://github.com/alexar76/esim-operator-kit.git
cd esim-operator-kit
cp .env.example .env
nano .env
```

| Réglage | Quoi mettre |
|---|---|
| `DOMAIN` | Votre domaine, sans `https://`. |
| `STORE_NAME` | Le nom que voient les acheteurs dans l'en-tête, le titre et la fenêtre du portefeuille. |
| `PRODUCT_ID` | Un identifiant court de vos offres dans la fédération, par exemple `esim-mytravel`. Lettres, chiffres, tirets. |
| `STORE_CONTACT` | L'e-mail auquel écrivent les acheteurs. Affiché en pied de page. |
| `STORE_TERMS_URL`, `STORE_PRIVACY_URL` | Vos CGV et votre politique de confidentialité. Liées en pied de page. |
| `MARGIN_PCT` | Votre marge sur le prix de gros, en pourcentage. `100` le double. |
| `MIN_MARGIN_USD` | La marge minimale par eSIM, en dollars. Les forfaits bon marché prennent au moins cela en plus. |
| `PRICES_FILE` | Facultatif : votre grille de prix par-dessus la formule, `/config/prices.csv`. Voir plus bas. |
| `DEMO_MODE` | `1` affiche un bandeau et n'encaisse rien. `0` vend. Gardez `1` jusqu'à l'étape 10. |
| `PAY_TO_EVM`, `PAY_TO_TON`, `PAY_TO_TRON`, `PAY_TO_SOLANA` | Vos adresses de réception. Une ligne vide désactive ce réseau. |
| `EVM_CHAINS` | Les réseaux EVM proposés, par chain id : `8453` Base, `1` Ethereum, `42161` Arbitrum, `10` OP, `137` Polygon, `56` BNB Chain, `43114` Avalanche. |
| `EVM_RPC_<chain id>`, `SOLANA_RPC` | Facultatif : vos propres points d'accès RPC. Les publics sont limités en débit. |
| `SUPPLIER` | D'où viennent les eSIM : `esimaccess` (par défaut), `airalo`, `esimgo` ou `http` pour votre propre système. Voir [intégrations](integrations.md). |
| `WEBHOOK_URL`, `WEBHOOK_SECRET_FILE` | Facultatif : le statut de chaque commande, signé, vers votre CRM, votre facturation, Telegram ou un tableur. Voir [intégrations](integrations.md). |
| `REFUND_KEY_FILE`, `REFUND_MAX_USD`, `REFUND_DAILY_MAX_USD` | Facultatif : remboursements automatiques des eSIM inutilisées aux agents, depuis un portefeuille de votre choix. Voir les [cas réels](cases.md). |

**Comment le prix est calculé.** Prix = gros × (1 + `MARGIN_PCT`/100), mais jamais moins que gros + `MIN_MARGIN_USD`. Arrondi au centime supérieur. Avec les valeurs par défaut (100 % et 1,00 $), la France 1 Go pour 7 jours coûte 0,70 $ en gros et se vend 1,70 $. Un forfait de 20 Go à 9,00 $ en gros se vend 18,00 $. Les boutiques eSIM de détail demandent souvent de 4 à 8 $ pour les petits forfaits : vous avez de la marge.

**Votre propre grille de prix.** Si vous avez déjà des prix de détail, ou voulez une autre marge pour certains pays, mettez-les dans une grille de prix. La formule ci-dessus fixe le prix de tout forfait que la grille ne vise pas.

```bash
cp config/prices.example.csv config/prices.csv
nano config/prices.csv                   # puis décommentez PRICES_FILE=/config/prices.csv dans .env
docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv
```

Un exemple :

```csv
match,gb,days,price_usd,margin_pct,min_margin_usd
TR,1,7,4.50,,
TR,,,,80,
JP,,,,,2.00
global,,,,60,
US_0.1_7,,,off,,
```

| Colonne | Ce qu'elle dit |
|---|---|
| `match` | Quels forfaits : un id d'offre (`TR_1_7`, tel que le devis l'affiche), un pays (`TR` : les forfaits propres à ce pays), `region` ou `global` (forfaits multi-pays) ou `*` (tous les forfaits). |
| `gb`, `days` | Facultatif, à côté d'un pays, de `region`, `global` ou `*` : seulement les forfaits de cette taille et de cette durée. `gb` correspond à ±10 % près, car les fournisseurs comptent le gigaoctet comme 1000 ou 1024 Mo. |
| `price_usd` | Un prix fixe, par exemple `4.50`, ou `off` : le forfait n'est pas vendu. |
| `margin_pct`, `min_margin_usd` | Ou la formule avec ces nombres pour les forfaits visés. Une valeur vide garde celle de `.env`. |

La ligne la plus précise l'emporte : un id d'offre sur un pays, un pays sur `region` et `global`, ceux-ci sur `*`, puis la ligne qui remplit le plus de `gb` et `days` ; entre deux lignes aussi précises, celle du haut. Un prix fixe ne vend jamais à perte : si le coût de gros passe au-dessus, la formule fixe le prix de ce forfait jusqu'à ce que vous changiez la grille, et la vérification des prix de l'étape 7 le signale. Le fichier est lu au démarrage ; une grille avec une erreur arrête le démarrage en donnant le numéro de ligne, pour qu'une faute de frappe ne vende jamais à un prix que vous n'avez pas voulu. Les exports de tableur fonctionnent : points-virgules et virgules décimales sont lus. Si vos prix vivent dans votre facturation, exportez-les vers ce fichier à intervalles réguliers. Appliquez un changement avec `docker compose restart store rails`.

**Des adresses seulement.** Chaque `PAY_TO_*` est une adresse de réception. Le kit n'a jamais besoin d'une clé privée ni d'une phrase de récupération. Si un guide ou une personne vous demande d'en mettre une dans `.env`, c'est une erreur.

## 6. Placez les clés

Les clés vivent dans `secrets/`, une valeur par fichier. Le dossier est hors git et monté en lecture seule dans les conteneurs. Saisissez les valeurs sans qu'elles atterrissent dans l'historique du shell :

```bash
cd ~/esim-operator-kit
umask 077
printf 'AccessCode: '; read -rs v; printf %s "$v" > secrets/esimaccess_access_code; echo
printf 'SecretKey: '; read -rs v; printf %s "$v" > secrets/esimaccess_secret_key; echo
unset v
```

Les conteneurs tournent sous l'utilisateur 1000 : donnez-lui les fichiers de clés et les dossiers de données :

```bash
mkdir -p data/store data/rails data/node data/caddy
sudo chown 1000:1000 secrets/*
sudo chown -R 1000:1000 data/store data/rails data/node
ls -l secrets
```

Le dossier lui-même reste à vous : vous pourrez ajouter des fichiers plus tard. Chaque nouveau fichier de clé demande le même `sudo chown 1000:1000` et `chmod 600`.

[secrets/README.md](../../secrets/README.md) liste tous les fichiers facultatifs : la clé CDP, les clés tonapi et TronGrid, les clés Stripe.

## 7. Démarrez en mode démo

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail 30 store rails
```

La première construction prend quelques minutes. Vérifiez ensuite trois choses :

```bash
curl -s https://esim.example.com/agents/healthz
curl -s -X POST https://esim.example.com/agents/quote -H 'content-type: application/json' \
  -d '{"country":"FR","min_gb":3,"min_days":7,"limit":3}'
```

- La réponse de santé indique `"ok":true` et le nombre d'offres, environ 1 700 avec eSIM Access. `"demo":true` est normal pour l'instant.
- La demande d'offres liste de vrais forfaits à vos prix.
- `https://esim.example.com/` affiche votre boutique avec le bandeau démo. Ouvrez un pays et parcourez le paiement : chaque étape répond « Mode démo : les paiements sont désactivés ».

Si la réponse de santé indique `"ok":false`, les clés de gros sont fausses ou illisibles. Voir la section 14.

**Vérifiez vos prix.** Cette commande affiche votre solde et les meilleures offres des pays de votre choix, à vos prix, avec le prix de gros à côté. Avec une grille de prix, elle montre aussi ce que chaque ligne a fixé et les lignes qui ne visent aucun forfait :

```bash
docker compose exec -T rails node scripts/catalog.mjs FR ES IT US JP TH
```

Modifiez `MARGIN_PCT` ou `MIN_MARGIN_USD` dans `.env` et appliquez avec `docker compose up -d`. Après avoir modifié la grille, `docker compose restart store rails`.

## 8. Paiements

Chaque moyen s'active dès que son adresse (et sa clé, si besoin) est renseignée. Activez ceux
qu'utilisent vos acheteurs. L'USDT sur Tron est la façon la plus courante de payer en crypto ; viennent ensuite l'USDT et l'USDC sur les réseaux EVM et l'USDT sur TON.

| Moyen | À renseigner | Comment paie l'acheteur | Comment la vitrine confirme |
|---|---|---|---|
| USDC sur Base, sans gas | `PAY_TO_EVM` + `secrets/cdp_api_key.json` | Signe un message dans un portefeuille du navigateur et ne paie pas de gas. | Le facilitateur CDP règle la signature. L'eSIM est livrée d'abord, puis le paiement est réglé ; si le règlement échoue, l'eSIM est annulée. |
| USDC / USDT sur 7 réseaux EVM | `PAY_TO_EVM` (+ `EVM_CHAINS`) | Envoie le virement depuis un portefeuille du navigateur, ou depuis n'importe quel portefeuille ou plateforme d'échange, et colle le hash de la transaction. | Lit le reçu : un transfert de ce jeton vers vous, d'au moins le prix, plus récent que la commande. Attend les confirmations : 3 sur Ethereum et BNB Chain, 10 sur Polygon, 1 ailleurs. Une transaction paie une commande. |
| USDT sur Tron | `PAY_TO_TRON` (+ `secrets/trongrid_key`) | Envoie exactement le montant affiché, depuis TronLink sur la page ou depuis n'importe quel portefeuille. | Chaque commande demande le prix plus quelques millionièmes de dollar (0,0099 $ de plus au maximum). Ce montant exact identifie la commande parmi vos transferts USDT confirmés. |
| USDC sur Solana | `PAY_TO_SOLANA` (+ `SOLANA_RPC`) | Ouvre le lien Solana Pay ou scanne son QR code (Phantom, Solflare, Backpack). | Chaque commande a sa propre clé de référence, que le portefeuille ajoute au transfert. La vitrine retrouve la transaction grâce à elle. |
| USDT ou TON sur TON | `PAY_TO_TON` (+ `secrets/tonapi_key`) | Connecte Tonkeeper ou un autre portefeuille via TON Connect, ou paie à la main avec le commentaire indiqué. | Retrouve le transfert par le commentaire de la commande via tonapi.io. |
| Cartes | `secrets/stripe_secret_key` + `secrets/stripe_webhook_secret` | Stripe Checkout. | Le webhook Stripe. |

Un paiement envoyé (tous les moyens sauf Base sans gas et les cartes) est recherché pendant 24 heures
après la création de la commande.

**Clé Coinbase Developer Platform.** Elle active l'USDC sans gas sur Base pour les personnes et les commandes x402 des agents. Sans elle, la vitrine accepte encore l'USDC sur Base en simple virement, mais le nœud pour agents ne prend aucune commande.

1. Connectez-vous sur [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com) et créez un projet.
2. API Keys : créez une clé API secrète et téléchargez son fichier JSON.
3. Copiez le fichier dans `secrets/cdp_api_key.json` (il contient `id` et `privateKey`), puis lancez `sudo chown 1000:1000 secrets/cdp_api_key.json && sudo chmod 600 secrets/cdp_api_key.json` et `docker compose up -d`.

**Stripe.** Dans le tableau de bord Stripe, ajoutez un point de terminaison webhook `https://<votre domaine>/api/stripe/webhook` avec les événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`. Mettez la clé secrète (`sk_live_…`) dans `secrets/stripe_secret_key` et le secret de signature du point de terminaison (`whsec_…`) dans `secrets/stripe_webhook_secret`.

**Limites de débit.** Les points d'accès publics TronGrid, tonapi et RPC suffisent pour une petite boutique. Quand les ventes deviennent régulières, ajoutez une clé TronGrid gratuite et une clé tonapi, et pointez `EVM_RPC_<id>` et `SOLANA_RPC` vers votre propre fournisseur.

## 9. Agents et fédération

Le nœud rails répond déjà aux agents sur `https://<votre domaine>/agents/`. Pour que les agents vous
trouvent en cherchant sur un hub, décrivez votre nœud à la fédération et annoncez-le.

1. Générez `node.toml` à partir de votre catalogue réel. Mettez votre nom, votre domaine et votre `PRODUCT_ID` :

```bash
docker compose exec -T rails node scripts/node-toml.mjs \
  --name "My Travel eSIM" --url https://esim.example.com \
  --product esim-mytravel --upstream http://rails:9490 > node.toml
head -20 node.toml
```

2. Démarrez le nœud :

```bash
docker compose --profile federation up -d --build node
curl -s https://esim.example.com/.well-known/ai-market.json | head -c 400; echo
```

3. Vérifiez-le comme le fera un hub, puis annoncez-le :

```bash
docker compose exec node aimarket doctor --url https://esim.example.com
docker compose exec node aimarket node knock --config /node/node.toml --hub https://modelmarket.dev
```

Avant de vous référencer, le hub appelle `esim.quote` avec un vrai pays. Une fois référencé, un agent qui cherche « eSIM France » sur le hub obtient vos offres. Le paiement ne passe jamais par le hub : l'agent paie votre nœud via x402, directement sur votre portefeuille.

`data/node/` contient la clé de signature du nœud, son identité dans la fédération. Sauvegardez-la. Refaites le point 1 quand le catalogue gagne des pays.

**Livraisons confirmées.** Chaque commande et chaque remboursement auxquels répond votre nœud portent un reçu signé avec la clé du vendeur du nœud (`data/rails/provider_ed25519.pem`, celle qui signe chaque réponse gratuite), et le `node.toml` de l'étape 1 publie sa partie publique en tant que `provider_pubkey`. Un acheteur qui vous a trouvé via un hub peut apporter le reçu et sa transaction à ce hub ; le hub vérifie les deux on-chain et compte une livraison confirmée. Vos listings affichent alors `deliveries_30d` (les livraisons et remboursements confirmés par les acheteurs en 30 jours, et combien d'acheteurs distincts), et le score de confiance du hub pour vous compte un succès par acheteur distinct. Rien à faire au-delà de l'étape 1 ; un `node.toml` écrit avant le 15 octobre 2026 n'a pas la clé : refaites l'étape 1. Sauvegardez la clé du vendeur avec le reste de `data/rails/` : des reçus signés avec une clé perdue ne correspondent plus à votre listing. Les [cas réels](cases.md), cas 3, le montrent avec de vrais acheteurs.

Vérifiez que la clé est publiée :

```bash
curl -s https://esim.example.com/ai-market/v2/manifest | grep -o provider_pubkey | head -1    # provider_pubkey
```

Il faut pour cela `aimarket-hub` 3.15.27 ou plus récent dans l'image `node/`, celle qu'installe le kit. Un nœud plus ancien laisse la clé de côté, et le hub répond alors `404` aux reçus de vos acheteurs.

**Votre propre hub à la place du nœud.** `./onboard.sh --hub` fait tourner un hub complet sur votre domaine : il liste lui-même vos offres, donne aux agents votre propre adresse pour la recherche et MCP, et se fédère avec les autres hubs. Si le nœud tournait avant, le domaine garde son identité. Voir [votre propre hub](own-hub.md).

## 10. La commande test, puis la mise en vente

1. Dans `.env`, mettez `DEMO_MODE=0` et revérifiez les adresses `PAY_TO_*`, caractère par caractère.
2. Appliquez :

```bash
docker compose up -d
curl -s https://esim.example.com/agents/healthz
```

`"demo":false` doit apparaître. `"paid_orders":true` apparaît quand la clé CDP et `PAY_TO_EVM` sont renseignées.

3. Achetez le forfait le moins cher d'un pays dans votre propre boutique, avec un de vos portefeuilles qui n'est pas l'adresse de la boutique, sur le réseau que vos acheteurs utiliseront le plus selon vous. La page de commande doit afficher le QR code en moins d'une minute. Ne payez pas depuis le portefeuille `PAY_TO_EVM` lui-même : le facilitateur x402 refuse un paiement d'une adresse vers elle-même (`self_send_not_allowed`).
4. Vérifiez le paiement dans votre portefeuille et la commande dans la console eSIM Access.
5. Si vous ne voulez pas garder l'eSIM, annulez le profil non utilisé dans la console eSIM Access. Le prix de gros revient sur votre solde. Votre paiement est de toute façon allé sur votre propre portefeuille.

Testez le canal agents de la même façon, avec un petit portefeuille de test qui détient un dollar
d'USDC sur Base (pas votre portefeuille `PAY_TO_EVM`). La commande demande des offres, affiche le prix
et ne paie qu'avec `--yes` :

```bash
cd rails && node examples/agent-buy.mjs https://esim.example.com/agents TR --key-file ~/test-wallet.json --yes --refund
```

Le fichier de clé contient `{"private_key": "0x…"}` et n'est jamais affiché. La réponse donne l'eSIM
(`esim_tran_no`) et la transaction de règlement sur Base. `--refund` redemande l'argent aussitôt : le
nœud annule l'eSIM inutilisée chez le fournisseur (le coût revient sur votre solde) et, avec les
remboursements activés ([cas réels](cases.md), section 7), rembourse le portefeuille de test ; sinon le
remboursement est enregistré comme dû. Une fois référencé par un hub, lancez la même chose avec
`--hub https://modelmarket.dev` à la place de votre URL : c'est le chemin des agents, reçus compris. Le
[guide pour les agents](agent-guide.md) montre une exécution réelle, refus compris.

Faites de même pour chaque réseau activé. Vous êtes alors en vente.

## 11. Au quotidien

**Commandes.** La vitrine les garde dans `data/store/orders.json`. Listez celles qui demandent votre attention :

```bash
sudo jq -r '.[] | select(.status=="refund_due" or .status=="underpaid")
  | [.created_at, .id, .status, .method, (.price_cents/100), .payment.ref, (.payment.payer // "-"), (.error // "")] | @tsv' \
  data/store/orders.json
```

| Statut | Signification | Que faire |
|---|---|---|
| `awaiting_payment` | La commande existe, rien n'est encore arrivé. | Rien. |
| `delivered` | Payée, l'eSIM est chez l'acheteur. | Rien. |
| `refund_due` | Payée, mais le grossiste n'a pas livré : solde épuisé, ou forfait retiré. | Remboursez l'acheteur à `payment.payer` sur le même réseau, ou rechargez et vendez-lui le forfait à la main. |
| `underpaid` | Un paiement inférieur au prix est arrivé. | Remboursez-le, ou demandez la différence à l'acheteur et livrez à la main. |
| `expired` | Rien n'est arrivé en 24 heures. | Rien. Un paiement arrivé plus tard n'est pas rapproché ; vous le verrez sur votre portefeuille sans commande. |

Les acheteurs écrivent à `STORE_CONTACT`. Demandez-leur le numéro de commande dans l'adresse de leur page (`/o/<numéro>`). Ne demandez pas le lien complet : il contient leur jeton.

**Solde.** Gardez le solde de gros au-dessus de quelques jours de ventes. Quand il ne couvre pas une commande, le paiement indique « Ce forfait est temporairement indisponible » au lieu d'encaisser. Vérifiez-le avec :

```bash
docker compose exec -T rails node scripts/catalog.mjs | head -1
```

**Journaux.**

```bash
docker compose logs -f --tail 100 store rails
```

Les journaux ne contiennent jamais de code d'activation ni de clé.

**Sauvegardes.** Sauvegardez `data/` et `secrets/` chaque jour, ailleurs que sur le serveur :

- `data/store/` : les commandes. Si vous les perdez, les pages de commande des acheteurs cessent de fonctionner.
- `data/rails/` : les commandes des agents, la clé de leurs jetons de statut et la clé de signature du nœud. Les deux dossiers gardent aussi le dernier catalogue (`catalog-snapshot.json`) : si le fournisseur ne répond plus, il est servi jusqu'à six heures, et en mode démo aussi longtemps que nécessaire.
- `data/node/` : l'identité dans la fédération.
- `data/hub/` : votre propre hub, si vous en avez un : ses clés, sa base, ses réglages et son jeton d'administrateur.
- `data/caddy/` : les certificats. Ils peuvent être réémis, mais la sauvegarde évite les limites de Let's Encrypt.

**Mises à jour.**

```bash
git pull
docker compose up -d --build
docker compose --profile federation up -d --build node    # si vous utilisez le nœud de fédération
```

Lisez les notes de version avant de mettre à jour une boutique qui vend.

## 12. Commandes des agents

Les agents achètent via `POST /agents/order` (voir le [guide pour les agents](agent-guide.md)). Le nœud vérifie le paiement x402, achète le profil et ne règle qu'une fois le profil créé. Si le règlement échoue, il annule le profil et le prix de gros revient sur votre solde. Les commandes des agents sont enregistrées dans `data/rails/orders.json`, sans codes d'activation. Les USDC arrivent sur `PAY_TO_EVM` sur Base.

**Remboursements.** Un agent peut demander le remboursement d'une eSIM qu'il n'a pas installée : `POST /agents/refund` avec le numéro de l'eSIM et le jeton de statut. Le nœud annule l'eSIM chez le grossiste, qui recrédite votre solde, et rend le prix à l'adresse qui a payé. Le remboursement est automatique seulement si vous donnez au nœud un portefeuille de remboursement (`REFUND_KEY_FILE`, plafonné par `REFUND_MAX_USD` et `REFUND_DAILY_MAX_USD`) ; sans lui, le remboursement est enregistré comme dû et le webhook `agent_order.refund_due` vous demande de le payer. Configuration, règles et un vrai remboursement avec ses transactions : [cas réels](cases.md).

## 13. Droit, taxes et conditions

Ceci n'est pas un conseil juridique ou fiscal. Consultez un comptable dans votre pays avant de vendre.

- **Le vendeur, c'est vous.** Vos acheteurs achètent chez vous, à vos conditions. eSIM Access est votre fournisseur. Remboursements, support et taxes sont à votre charge.
- **CGV et confidentialité.** eSIM Access attend que votre site publie des conditions de vente et une politique de confidentialité. Renseignez `STORE_TERMS_URL` et `STORE_PRIVACY_URL`. Les conditions doivent couvrir les remboursements (une eSIM installée n'est en général pas remboursable), la compatibilité (un téléphone désimlocké qui gère l'eSIM) et le début de validité.
- **TVA dans l'UE.** Les services de télécommunication vendus aux consommateurs sont taxés dans le pays de l'acheteur. Le guichet unique (OSS) permet de déclarer tous les pays de l'UE en une seule déclaration. Hors UE, les règles diffèrent.
- **Crypto.** Le droit d'accepter des cryptoactifs, et la façon de les comptabiliser, dépendent de votre pays. Conservez les enregistrements des commandes : la vitrine a le réseau, la transaction et le montant de chaque paiement.
- **Données personnelles.** La vitrine ne demande rien aux acheteurs : ni nom, ni e-mail. Elle garde la commande (forfait, prix, moyen) et le paiement (transaction et adresse du payeur). Une adresse blockchain peut néanmoins être une donnée personnelle au sens du RGPD : mentionnez-la dans votre politique de confidentialité.

## 14. Dépannage

| Ce que vous voyez | Cause | Solution |
|---|---|---|
| Le navigateur dit que le certificat n'est pas valide | Le DNS ne pointe pas encore ici, ou le port 80 est fermé | `dig +short <domaine>`, ouvrez le port 80, puis `docker compose restart caddy` et lisez `docker compose logs caddy`. |
| `healthz` affiche `"ok":false` ou la boutique n'affiche aucun pays | Les clés de gros sont fausses ou l'utilisateur 1000 ne peut pas les lire. Les journaux disent `catalogue not loaded yet: <code>`. | `sudo rm secrets/esimaccess_*`, réécrivez-les comme à l'étape 6, puis `docker compose restart store rails`. |
| `EACCES` ou `permission denied` dans les journaux | Les dossiers de données n'appartiennent pas à l'utilisateur 1000 | `sudo chown -R 1000:1000 data/store data/rails data/node` |
| Le paiement indique « Ce forfait est temporairement indisponible » | Le solde de gros ne couvre pas le forfait | Rechargez eSIM Access. |
| Chaque paiement répond « Mode démo : les paiements sont désactivés » | `DEMO_MODE=1` | Étape 10. |
| Un réseau manque au paiement | Son `PAY_TO_*` est vide | Vérifiez `.env`, puis `docker compose up -d`. |
| La vitrine redémarre en boucle | Un `PAY_TO_*` n'est pas une adresse valide : la vitrine refuse de démarrer avec | `docker compose logs store` la nomme. Corrigez `.env`. |
| Un paiement Tron est introuvable | Le montant n'était pas exact, souvent parce qu'une plateforme d'échange en a déduit ses frais | Retrouvez le transfert sur votre portefeuille et remboursez-le, ou livrez à la main. Demandez aux acheteurs d'envoyer le montant exact depuis un portefeuille. |
| Un paiement TON est introuvable | Le commentaire manquait ou a été modifié | Comme ci-dessus. Avec TON Connect, le portefeuille remplit le commentaire tout seul. |
| `aimarket doctor` signale une adresse privée | L'`url` de `node.toml` n'est pas votre domaine public | Régénérez `node.toml` (étape 9) avec `--url https://<domaine>`. |
| `node` ne démarre pas : `node.toml` est un dossier | Compose l'a créé parce que le fichier n'existait pas | `rmdir node.toml`, générez le fichier (étape 9), redémarrez. |
| Un paiement test est refusé : `402 … self_send_not_allowed` | Vous avez payé depuis l'adresse `PAY_TO_EVM` de la boutique elle-même ; le facilitateur refuse un paiement à soi-même | Payez depuis un autre portefeuille. |
| Le nœud journalise `bazaar … resource must start with 'https://'` | `PUBLIC_URL` est en http (un test local) | Rien à faire sur un nœud de test ; en production `PUBLIC_URL` est votre domaine https. |
| La boutique ou le nœud s'arrête au démarrage : `…prices.csv, line N: …` | Une ligne de la grille de prix est illisible | Corrigez cette ligne ; `docker compose run --rm rails node bin/esim-rails.mjs prices /config/prices.csv` vérifie tout le fichier. Puis `docker compose restart store rails`. |
