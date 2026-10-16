// The kit's landing: five languages, live numbers from the demo seller node, a live esim.quote form,
// and the coverage globe (three.js). Every value from the network reaches the page as text.
import { LAND, COUNTRIES } from "./globe-data.js";

const NODE = "https://modelmarket.dev/providers/esim";
const STORE = "https://esim.modelmarket.dev";      // the landing and the /kit guides
const SHOP = "https://esim-shop.modelmarket.dev";   // the example shop
const LANGS = ["en", "ru", "es", "fr", "zh"];
const NETWORKS = [
  { name: "Tron", tokens: "USDT", color: "#ff4d4f", weight: 30 },
  { name: "TON", tokens: "USDT · TON", color: "#2aa8ff", weight: 16 },
  { name: "Base", tokens: "USDC", color: "#3b6cff", weight: 14, gasless: true },
  { name: "Solana", tokens: "USDC", color: "#b26bff", weight: 10 },
  { name: "Ethereum", tokens: "USDC · USDT", color: "#a4b0d6", weight: 6 },
  { name: "BNB Chain", tokens: "USDC · USDT", color: "#f3c33c", weight: 8 },
  { name: "Arbitrum", tokens: "USDC · USDT", color: "#3fb5ff", weight: 5 },
  { name: "Polygon", tokens: "USDC · USDT", color: "#9a6bff", weight: 5 },
  { name: "OP Mainnet", tokens: "USDC · USDT", color: "#ff5468", weight: 3 },
  { name: "Avalanche", tokens: "USDC · USDT", color: "#ff6b5f", weight: 3 },
];

const T = {
  en: {
    nav_demo: "Live demo", nav_docs: "Docs", eyebrow: "Open source · MIT · AIMarket rails",
    h1: "Run your own eSIM operator.",
    lead: "Sell travel data eSIMs to people and to AI agents, from your own wholesale account. Buyers pay straight into your wallets on ten networks; agents buy over x402.",
    cta_demo: "Open the live demo", cta_guide: "Operator guide",
    stat_plans: "plans live", stat_countries: "countries", stat_networks: "networks", stat_langs: "languages",
    hint: "Drag to spin · hover a country · click to open its plans. Countries and prices are the live catalogue; the arcs are an illustration of sales, coloured by network.",
    legend_agent: "AI agent (x402)",
    who_k: "Who buys", who_title: "Two kinds of buyers. One wholesale balance.",
    who_sub: "The storefront and the seller node buy from the same eSIM Access account. You set one margin; both sell at it.",
    who_people_h: "Travellers", who_people_p: "A page per country, prices in dollars, checkout from any wallet or exchange, the QR code a minute later. Five languages, phone first.",
    who_agents_h: "AI agents", who_agents_p: "esim.quote and esim.status are free and signed; esim.order is one x402 payment in USDC on Base. Hubs of the AIMarket federation list your node, so agents find you.",
    who_you_h: "You, the operator", who_you_p: "Your wholesale account, your margin, your wallets. No processor in between and no hub fee on direct sales: buyers pay you, the kit only reads the chain.",
    flow_k: "The sale", flow_title: "From a quote to an installed eSIM in under a minute",
    flow_sub: "The live test order on 2026-10-14 was allocated in 2.5 seconds; the same payment sent twice found the same eSIM.",
    flow_1_h: "Quote", flow_1_p: "The buyer picks a plan. Price = wholesale + your margin, held for 20 minutes.",
    flow_2_h: "Pay", flow_2_p: "USDT, USDC or TON to your address. The store reads the network itself: token, amount, confirmations.",
    flow_3_h: "Deliver", flow_3_p: "The profile is bought from your wholesale balance and shown as a QR code, an activation code and an install link.",
    flow_4_h: "Settle", flow_4_p: "An agent's payment settles only after its eSIM exists; an uncertain settlement requires reconciliation. One payment buys one eSIM.",
    nets_k: "Payments", nets_title: "Ten networks, the tokens travellers already hold",
    nets_sub: "Each network turns on when you give it an address — addresses only, never a key. Cards through Stripe if you want them.",
    gasless: "gasless signature",
    try_k: "Live", try_title: "Ask the rails, right now",
    try_sub: "This form calls esim.quote on the demo seller node — the same request an AI agent makes. The answer is signed by the node.",
    try_country: "Destination", try_gb: "At least, GB", try_days: "At least, days", try_go: "Get live offers",
    try_note: "Buying is the next call: POST the offer_id to the order URL with an x402 payment. The demo node answers it with demo_mode and sells nothing.",
    try_loading: "Asking the seller node…", try_empty: "No plan matches. Try less data or fewer days.",
    try_err: "The demo node did not answer. Try again in a minute.", try_buy: "Open in the demo store →",
    signed: "Signed by the seller · Ed25519 · ", kind_country: "this country only", kind_region: "{n} countries", kind_global: "global",
    gb: "GB", days: "days", tip_from: "from", tip_local: "{n} plans for this country", tip_click: "click to open its plans",
    rails_k: "The rails", rails_title: "What connecting to the rails gives an operator",
    rails_1_h: "Found by agents", rails_1_p: "Your node announces itself to an AIMarket hub. After an admission check, agents searching the federation for an eSIM see your offers.",
    rails_2_h: "Paid directly", rails_2_p: "x402 moves USDC from the agent's wallet to yours. The hub routes the search, never the money.",
    rails_3_h: "Answers you can check", rails_3_p: "Every quote is signed with your node's Ed25519 key and bound to the request. Hubs verify it; agents can too.",
    rails_4_h: "One shape for every seller", rails_4_p: "Offers read the same at every seller, so agents compare price and coverage, not integrations.",
    lane_people: "People", lane_agents: "Agents", lane_find: "Discovery", lane_money: "Money",
    n_traveller: "Traveller", n_wallet: "any wallet", n_store: "Your store", n_wholesale: "wholesale", n_agent: "Agent",
    n_node: "Your node", n_fed: "Federation node", n_agents: "Agents", n_buyers: "buyers", n_wallets: "Your wallets", n_topup: "your top-ups",
    rails_more: "Rails & use cases →",
    run_k: "Run it", run_title: "From an empty server to a store, in one compose file",
    run_sub: "A domain, Docker and your eSIM Access keys. Caddy gets the certificate; the store runs in demo mode until you switch it on.",
    run_guide: "Read the operator guide",
    gal_k: "Gallery", gal_title: "What your buyers see",
    gal_sub: "The reference storefront, as it runs at esim-shop.modelmarket.dev. Addresses and codes in the payment screens are placeholders.",
    g_home: "Destinations and prices", g_country: "A country's plans, filtered by data and days", g_checkout: "Checkout: ten networks",
    g_tron: "Paying USDT on Tron: the exact amount and a QR code", g_esim: "The eSIM, ready to install", g_docs: "The guides, in five languages",
    docs_k: "Docs", docs_title: "Guides in five languages",
    d_overview: "Overview", d_rails: "Rails & use cases", d_operator: "Operator guide", d_agents: "Agent guide", d_github: "on GitHub",
    foot_part: "part of the AIMarket ecosystem", foot_demo: "The demo sells nothing: payments are off.", foot_tools: "Free tools",
  },
  ru: {
    nav_demo: "Живое демо", nav_docs: "Документация", eyebrow: "Открытый код · MIT · рельсы AIMarket",
    h1: "Свой eSIM-оператор.",
    lead: "Продавайте eSIM для поездок людям и ИИ-агентам со своего оптового аккаунта. Покупатели платят прямо на ваши кошельки в десяти сетях; агенты покупают по x402.",
    cta_demo: "Открыть живое демо", cta_guide: "Гайд оператора",
    stat_plans: "тарифов онлайн", stat_countries: "стран", stat_networks: "сетей", stat_langs: "языков",
    hint: "Тяните, чтобы вращать · наведите на страну · клик откроет её тарифы. Страны и цены — живой каталог; дуги — иллюстрация продаж, цвет — сеть оплаты.",
    legend_agent: "ИИ-агент (x402)",
    who_k: "Кто покупает", who_title: "Два вида покупателей. Один оптовый баланс.",
    who_sub: "Витрина и узел продавца покупают с одного аккаунта eSIM Access. Вы задаёте одну наценку, и оба продают по ней.",
    who_people_h: "Путешественники", who_people_p: "Страница на каждую страну, цены в долларах, оплата из любого кошелька или с биржи, QR-код через минуту. Пять языков, сначала телефон.",
    who_agents_h: "ИИ-агенты", who_agents_p: "esim.quote и esim.status бесплатные и подписанные; esim.order — один платёж x402 в USDC в Base. Хабы федерации AIMarket показывают ваш узел, и агенты вас находят.",
    who_you_h: "Вы, оператор", who_you_p: "Ваш оптовый аккаунт, ваша наценка, ваши кошельки. Без процессора посередине и без комиссии хаба на прямых продажах: покупатели платят вам, кит только читает блокчейн.",
    flow_k: "Продажа", flow_title: "От предложения до установленной eSIM меньше чем за минуту",
    flow_sub: "Живой тестовый заказ 2026-10-14 был выдан за 2,5 секунды; один и тот же платёж, отправленный дважды, нашёл ту же eSIM.",
    flow_1_h: "Предложение", flow_1_p: "Покупатель выбирает тариф. Цена = опт + ваша наценка, держится 20 минут.",
    flow_2_h: "Оплата", flow_2_p: "USDT, USDC или TON на ваш адрес. Витрина сама читает сеть: токен, сумму, подтверждения.",
    flow_3_h: "Выдача", flow_3_p: "Профиль покупается с вашего оптового баланса и показывается QR-кодом, кодом активации и ссылкой установки.",
    flow_4_h: "Расчёт", flow_4_p: "Платёж агента проводится только после того, как eSIM создана; неопределённый результат требует сверки. Один платёж — одна eSIM.",
    nets_k: "Платежи", nets_title: "Десять сетей и токены, которые у путешественников уже есть",
    nets_sub: "Каждая сеть включается, когда вы даёте ей адрес — только адрес, никогда не ключ. Карты через Stripe, если нужны.",
    gasless: "подпись без газа",
    try_k: "Вживую", try_title: "Спросите рельсы прямо сейчас",
    try_sub: "Эта форма вызывает esim.quote на демо-узле продавца — тот же запрос, что делает ИИ-агент. Ответ подписан узлом.",
    try_country: "Куда", try_gb: "Не меньше, ГБ", try_days: "Не меньше, дней", try_go: "Получить предложения",
    try_note: "Покупка — следующий вызов: POST offer_id на адрес заказа с платежом x402. Демо-узел отвечает demo_mode и ничего не продаёт.",
    try_loading: "Спрашиваем узел продавца…", try_empty: "Нет подходящих тарифов. Уменьшите трафик или срок.",
    try_err: "Демо-узел не ответил. Попробуйте через минуту.", try_buy: "Открыть в демо-витрине →",
    signed: "Подписано продавцом · Ed25519 · ", kind_country: "только эта страна", kind_region: "{n} стран", kind_global: "весь мир",
    gb: "ГБ", days: "дн.", tip_from: "от", tip_local: "{n} тарифов для этой страны", tip_click: "клик откроет тарифы",
    rails_k: "Рельсы", rails_title: "Что оператору даёт подключение к рельсам",
    rails_1_h: "Вас находят агенты", rails_1_p: "Ваш узел анонсирует себя хабу AIMarket. После проверки агенты, которые ищут eSIM в федерации, видят ваши предложения.",
    rails_2_h: "Деньги напрямую", rails_2_p: "x402 переводит USDC с кошелька агента на ваш. Хаб направляет поиск, но никогда не деньги.",
    rails_3_h: "Ответы можно проверить", rails_3_p: "Каждое предложение подписано ключом Ed25519 вашего узла и привязано к запросу. Хабы это проверяют; агенты тоже могут.",
    rails_4_h: "Одна форма у всех продавцов", rails_4_p: "Предложения у всех продавцов выглядят одинаково, поэтому агенты сравнивают цену и покрытие, а не интеграции.",
    lane_people: "Люди", lane_agents: "Агенты", lane_find: "Поиск", lane_money: "Деньги",
    n_traveller: "Путешественник", n_wallet: "любой кошелёк", n_store: "Ваша витрина", n_wholesale: "опт", n_agent: "Агент",
    n_node: "Ваш узел", n_fed: "Узел федерации", n_agents: "Агенты", n_buyers: "покупатели", n_wallets: "Ваши кошельки", n_topup: "ваши пополнения",
    rails_more: "Рельсы и сценарии →",
    run_k: "Запуск", run_title: "От пустого сервера до витрины — один compose-файл",
    run_sub: "Домен, Docker и ключи eSIM Access. Caddy получает сертификат; витрина работает в демо-режиме, пока вы её не включите.",
    run_guide: "Читать гайд оператора",
    gal_k: "Галерея", gal_title: "Что видят ваши покупатели",
    gal_sub: "Референсная витрина, как она работает на esim-shop.modelmarket.dev. Адреса и коды на экранах оплаты — заглушки.",
    g_home: "Направления и цены", g_country: "Тарифы страны с фильтром по трафику и дням", g_checkout: "Оплата: десять сетей",
    g_tron: "Оплата USDT в Tron: точная сумма и QR-код", g_esim: "eSIM готова к установке", g_docs: "Гайды на пяти языках",
    docs_k: "Документация", docs_title: "Гайды на пяти языках",
    d_overview: "Обзор", d_rails: "Рельсы и сценарии", d_operator: "Гайд оператора", d_agents: "Гайд для агентов", d_github: "на GitHub",
    foot_part: "часть экосистемы AIMarket", foot_demo: "Демо ничего не продаёт: оплата отключена.", foot_tools: "Бесплатные инструменты",
  },
  es: {
    nav_demo: "Demo en vivo", nav_docs: "Documentación", eyebrow: "Código abierto · MIT · rieles AIMarket",
    h1: "Tu propio operador eSIM.",
    lead: "Vende eSIM de datos para viajes a personas y a agentes de IA desde tu propia cuenta mayorista. Los compradores pagan directamente a tus monederos en diez redes; los agentes compran por x402.",
    cta_demo: "Abrir la demo en vivo", cta_guide: "Guía del operador",
    stat_plans: "planes en vivo", stat_countries: "países", stat_networks: "redes", stat_langs: "idiomas",
    hint: "Arrastra para girar · pasa sobre un país · haz clic para ver sus planes. Los países y precios son el catálogo real; los arcos ilustran ventas, coloreados por red.",
    legend_agent: "Agente de IA (x402)",
    who_k: "Quién compra", who_title: "Dos tipos de compradores. Un solo saldo mayorista.",
    who_sub: "La tienda y el nodo vendedor compran de la misma cuenta de eSIM Access. Fijas un margen y ambos venden con él.",
    who_people_h: "Viajeros", who_people_p: "Una página por país, precios en dólares, pago desde cualquier monedero o exchange, el código QR un minuto después. Cinco idiomas, pensado para el móvil.",
    who_agents_h: "Agentes de IA", who_agents_p: "esim.quote y esim.status son gratuitos y firmados; esim.order es un pago x402 en USDC en Base. Los hubs de la federación AIMarket listan tu nodo y los agentes te encuentran.",
    who_you_h: "Tú, el operador", who_you_p: "Tu cuenta mayorista, tu margen, tus monederos. Sin procesador de por medio y sin comisión del hub en ventas directas: te pagan a ti y el kit solo lee la cadena.",
    flow_k: "La venta", flow_title: "De una oferta a una eSIM instalada en menos de un minuto",
    flow_sub: "El pedido de prueba real del 2026-10-14 se asignó en 2,5 segundos; el mismo pago enviado dos veces encontró la misma eSIM.",
    flow_1_h: "Oferta", flow_1_p: "El comprador elige un plan. Precio = mayorista + tu margen, garantizado 20 minutos.",
    flow_2_h: "Pago", flow_2_p: "USDT, USDC o TON a tu dirección. La tienda lee la red por sí misma: token, importe, confirmaciones.",
    flow_3_h: "Entrega", flow_3_p: "El perfil se compra con tu saldo mayorista y se muestra como código QR, código de activación y enlace de instalación.",
    flow_4_h: "Liquidación", flow_4_p: "El pago de un agente se liquida solo cuando su eSIM existe; una liquidación incierta requiere conciliación. Un pago, una eSIM.",
    nets_k: "Pagos", nets_title: "Diez redes, los tokens que los viajeros ya tienen",
    nets_sub: "Cada red se activa cuando le das una dirección: solo direcciones, nunca una clave. Tarjetas con Stripe si las quieres.",
    gasless: "firma sin gas",
    try_k: "En vivo", try_title: "Pregunta a los rieles, ahora mismo",
    try_sub: "Este formulario llama a esim.quote en el nodo vendedor de la demo: la misma petición que hace un agente de IA. La respuesta va firmada por el nodo.",
    try_country: "Destino", try_gb: "Al menos, GB", try_days: "Al menos, días", try_go: "Ver ofertas en vivo",
    try_note: "Comprar es la siguiente llamada: POST del offer_id a la URL de pedido con un pago x402. El nodo demo responde demo_mode y no vende nada.",
    try_loading: "Consultando al nodo vendedor…", try_empty: "Ningún plan coincide. Prueba con menos datos o menos días.",
    try_err: "El nodo demo no respondió. Inténtalo en un minuto.", try_buy: "Abrir en la tienda demo →",
    signed: "Firmado por el vendedor · Ed25519 · ", kind_country: "solo este país", kind_region: "{n} países", kind_global: "global",
    gb: "GB", days: "días", tip_from: "desde", tip_local: "{n} planes para este país", tip_click: "haz clic para ver sus planes",
    rails_k: "Los rieles", rails_title: "Qué le da a un operador conectarse a los rieles",
    rails_1_h: "Te encuentran los agentes", rails_1_p: "Tu nodo se anuncia a un hub de AIMarket. Tras una comprobación de admisión, los agentes que buscan una eSIM en la federación ven tus ofertas.",
    rails_2_h: "Cobro directo", rails_2_p: "x402 mueve USDC del monedero del agente al tuyo. El hub enruta la búsqueda, nunca el dinero.",
    rails_3_h: "Respuestas verificables", rails_3_p: "Cada oferta va firmada con la clave Ed25519 de tu nodo y ligada a la petición. Los hubs la verifican; los agentes también pueden.",
    rails_4_h: "La misma forma en cada vendedor", rails_4_p: "Las ofertas se leen igual en todos los vendedores, así que los agentes comparan precio y cobertura, no integraciones.",
    lane_people: "Personas", lane_agents: "Agentes", lane_find: "Descubrimiento", lane_money: "Dinero",
    n_traveller: "Viajero", n_wallet: "cualquier monedero", n_store: "Tu tienda", n_wholesale: "mayorista", n_agent: "Agente",
    n_node: "Tu nodo", n_fed: "Nodo de federación", n_agents: "Agentes", n_buyers: "compradores", n_wallets: "Tus monederos", n_topup: "tus recargas",
    rails_more: "Rieles y casos de uso →",
    run_k: "Ponlo en marcha", run_title: "De un servidor vacío a una tienda, con un solo compose",
    run_sub: "Un dominio, Docker y tus claves de eSIM Access. Caddy obtiene el certificado; la tienda funciona en modo demo hasta que la actives.",
    run_guide: "Leer la guía del operador",
    gal_k: "Galería", gal_title: "Lo que ven tus compradores",
    gal_sub: "La tienda de referencia, tal como funciona en esim-shop.modelmarket.dev. Las direcciones y códigos de las pantallas de pago son de ejemplo.",
    g_home: "Destinos y precios", g_country: "Los planes de un país, filtrados por datos y días", g_checkout: "Pago: diez redes",
    g_tron: "Pagar USDT en Tron: el importe exacto y un código QR", g_esim: "La eSIM, lista para instalar", g_docs: "Las guías, en cinco idiomas",
    docs_k: "Documentación", docs_title: "Guías en cinco idiomas",
    d_overview: "Resumen", d_rails: "Rieles y casos de uso", d_operator: "Guía del operador", d_agents: "Guía para agentes", d_github: "en GitHub",
    foot_part: "parte del ecosistema AIMarket", foot_demo: "La demo no vende nada: los pagos están desactivados.", foot_tools: "Herramientas gratis",
  },
  fr: {
    nav_demo: "Démo en direct", nav_docs: "Documentation", eyebrow: "Open source · MIT · rails AIMarket",
    h1: "Votre propre opérateur eSIM.",
    lead: "Vendez des eSIM data de voyage aux gens et aux agents IA depuis votre propre compte de gros. Les acheteurs paient directement sur vos portefeuilles sur dix réseaux ; les agents achètent via x402.",
    cta_demo: "Ouvrir la démo", cta_guide: "Guide de l'opérateur",
    stat_plans: "forfaits en ligne", stat_countries: "pays", stat_networks: "réseaux", stat_langs: "langues",
    hint: "Glissez pour tourner · survolez un pays · cliquez pour ses forfaits. Pays et prix viennent du catalogue réel ; les arcs illustrent des ventes, colorés par réseau.",
    legend_agent: "Agent IA (x402)",
    who_k: "Qui achète", who_title: "Deux types d'acheteurs. Un seul solde de gros.",
    who_sub: "La vitrine et le nœud vendeur achètent sur le même compte eSIM Access. Vous fixez une marge, les deux vendent avec.",
    who_people_h: "Voyageurs", who_people_p: "Une page par pays, des prix en dollars, le paiement depuis n'importe quel portefeuille ou plateforme, le QR code une minute après. Cinq langues, pensé pour le mobile.",
    who_agents_h: "Agents IA", who_agents_p: "esim.quote et esim.status sont gratuits et signés ; esim.order est un paiement x402 en USDC sur Base. Les hubs de la fédération AIMarket référencent votre nœud : les agents vous trouvent.",
    who_you_h: "Vous, l'opérateur", who_you_p: "Votre compte de gros, votre marge, vos portefeuilles. Aucun prestataire au milieu et aucune commission du hub sur les ventes directes : on vous paie, le kit ne fait que lire la chaîne.",
    flow_k: "La vente", flow_title: "D'une offre à une eSIM installée en moins d'une minute",
    flow_sub: "La commande test réelle du 2026-10-14 a été allouée en 2,5 secondes ; le même paiement envoyé deux fois a retrouvé la même eSIM.",
    flow_1_h: "Offre", flow_1_p: "L'acheteur choisit un forfait. Prix = gros + votre marge, garanti 20 minutes.",
    flow_2_h: "Paiement", flow_2_p: "USDT, USDC ou TON vers votre adresse. La vitrine lit elle-même le réseau : jeton, montant, confirmations.",
    flow_3_h: "Livraison", flow_3_p: "Le profil est acheté sur votre solde de gros et affiché en QR code, code d'activation et lien d'installation.",
    flow_4_h: "Règlement", flow_4_p: "Le paiement d'un agent n'est réglé qu'une fois son eSIM créée ; un règlement incertain nécessite un rapprochement. Un paiement, une eSIM.",
    nets_k: "Paiements", nets_title: "Dix réseaux, les jetons que les voyageurs ont déjà",
    nets_sub: "Chaque réseau s'active dès que vous lui donnez une adresse — des adresses seulement, jamais une clé. Les cartes via Stripe si vous le souhaitez.",
    gasless: "signature sans gas",
    try_k: "En direct", try_title: "Interrogez les rails, maintenant",
    try_sub: "Ce formulaire appelle esim.quote sur le nœud vendeur de démonstration — la même requête qu'un agent IA. La réponse est signée par le nœud.",
    try_country: "Destination", try_gb: "Au moins, Go", try_days: "Au moins, jours", try_go: "Voir les offres en direct",
    try_note: "Acheter est l'appel suivant : POST de l'offer_id vers l'URL de commande avec un paiement x402. Le nœud de démo répond demo_mode et ne vend rien.",
    try_loading: "Interrogation du nœud vendeur…", try_empty: "Aucun forfait ne correspond. Essayez moins de données ou moins de jours.",
    try_err: "Le nœud de démo n'a pas répondu. Réessayez dans une minute.", try_buy: "Ouvrir dans la boutique démo →",
    signed: "Signé par le vendeur · Ed25519 · ", kind_country: "ce pays seulement", kind_region: "{n} pays", kind_global: "monde",
    gb: "Go", days: "jours", tip_from: "dès", tip_local: "{n} forfaits pour ce pays", tip_click: "cliquez pour ses forfaits",
    rails_k: "Les rails", rails_title: "Ce que les rails apportent à un opérateur",
    rails_1_h: "Trouvé par les agents", rails_1_p: "Votre nœud s'annonce à un hub AIMarket. Après un contrôle d'admission, les agents qui cherchent une eSIM dans la fédération voient vos offres.",
    rails_2_h: "Payé directement", rails_2_p: "x402 transfère l'USDC du portefeuille de l'agent vers le vôtre. Le hub achemine la recherche, jamais l'argent.",
    rails_3_h: "Des réponses vérifiables", rails_3_p: "Chaque offre est signée avec la clé Ed25519 de votre nœud et liée à la requête. Les hubs la vérifient ; les agents aussi.",
    rails_4_h: "Une seule forme pour tous", rails_4_p: "Les offres se lisent pareil chez tous les vendeurs : les agents comparent prix et couverture, pas des intégrations.",
    lane_people: "Les gens", lane_agents: "Les agents", lane_find: "Découverte", lane_money: "L'argent",
    n_traveller: "Voyageur", n_wallet: "tout portefeuille", n_store: "Votre vitrine", n_wholesale: "gros", n_agent: "Agent",
    n_node: "Votre nœud", n_fed: "Nœud de fédération", n_agents: "Agents", n_buyers: "acheteurs", n_wallets: "Vos portefeuilles", n_topup: "vos recharges",
    rails_more: "Rails et cas d'usage →",
    run_k: "Lancer", run_title: "D'un serveur vide à une boutique, en un seul fichier compose",
    run_sub: "Un domaine, Docker et vos clés eSIM Access. Caddy obtient le certificat ; la boutique tourne en mode démo jusqu'à ce que vous l'activiez.",
    run_guide: "Lire le guide de l'opérateur",
    gal_k: "Galerie", gal_title: "Ce que voient vos acheteurs",
    gal_sub: "La vitrine de référence, telle qu'elle tourne sur esim-shop.modelmarket.dev. Les adresses et codes des écrans de paiement sont fictifs.",
    g_home: "Destinations et prix", g_country: "Les forfaits d'un pays, filtrés par data et durée", g_checkout: "Paiement : dix réseaux",
    g_tron: "Payer en USDT sur Tron : le montant exact et un QR code", g_esim: "L'eSIM, prête à installer", g_docs: "Les guides, en cinq langues",
    docs_k: "Documentation", docs_title: "Des guides en cinq langues",
    d_overview: "Présentation", d_rails: "Rails et cas d'usage", d_operator: "Guide de l'opérateur", d_agents: "Guide pour les agents", d_github: "sur GitHub",
    foot_part: "fait partie de l'écosystème AIMarket", foot_demo: "La démo ne vend rien : les paiements sont désactivés.", foot_tools: "Outils gratuits",
  },
  zh: {
    nav_demo: "在线演示", nav_docs: "文档", eyebrow: "开源 · MIT · AIMarket 轨道",
    h1: "运营你自己的 eSIM 业务。",
    lead: "用你自己的批发账户，向用户和 AI 智能体销售旅行流量 eSIM。买家在十条链上直接付款到你的钱包；智能体通过 x402 购买。",
    cta_demo: "打开在线演示", cta_guide: "运营者指南",
    stat_plans: "个在售套餐", stat_countries: "个国家", stat_networks: "条网络", stat_langs: "种语言",
    hint: "拖动旋转 · 悬停查看国家 · 点击打开套餐。国家和价格来自实时目录；弧线是按付款网络着色的销售示意。",
    legend_agent: "AI 智能体（x402）",
    who_k: "谁在购买", who_title: "两类买家，同一个批发余额。",
    who_sub: "店铺和卖家节点从同一个 eSIM Access 账户进货。你设定一个加价，两者都按它销售。",
    who_people_h: "旅行者", who_people_p: "每个国家一个页面，美元标价，可从任意钱包或交易所付款，一分钟后拿到二维码。五种语言，手机优先。",
    who_agents_h: "AI 智能体", who_agents_p: "esim.quote 和 esim.status 免费且带签名；esim.order 是一笔 Base 上的 USDC x402 付款。AIMarket 联邦的枢纽会收录你的节点，智能体就能找到你。",
    who_you_h: "你，运营者", who_you_p: "你的批发账户、你的加价、你的钱包。中间没有支付服务商，直接销售也不收枢纽手续费：买家付给你，套件只读取链上数据。",
    flow_k: "销售流程", flow_title: "从报价到装好 eSIM，不到一分钟",
    flow_sub: "2026-10-14 的真实测试订单在 2.5 秒内分配完成；同一笔付款发送两次，取回的是同一张 eSIM。",
    flow_1_h: "报价", flow_1_p: "买家选择套餐。价格 = 批发价 + 你的加价，锁定 20 分钟。",
    flow_2_h: "付款", flow_2_p: "USDT、USDC 或 TON 付到你的地址。店铺自己读取链上数据：代币、金额、确认数。",
    flow_3_h: "交付", flow_3_p: "用你的批发余额购买配置文件，并以二维码、激活码和安装链接展示。",
    flow_4_h: "结算", flow_4_p: "智能体的付款只在 eSIM 创建后才结算；结算结果不确定时需要核对。一笔付款只买一张 eSIM。",
    nets_k: "付款", nets_title: "十条网络，旅行者手里已有的代币",
    nets_sub: "填入地址即开启对应网络——只要地址，绝不要密钥。需要的话还可以通过 Stripe 收银行卡。",
    gasless: "免 gas 签名",
    try_k: "实时", try_title: "现在就问问轨道",
    try_sub: "这个表单会调用演示卖家节点上的 esim.quote——和 AI 智能体发出的请求完全一样。响应由节点签名。",
    try_country: "目的地", try_gb: "至少（GB）", try_days: "至少（天）", try_go: "获取实时报价",
    try_note: "购买是下一个调用：带 x402 付款把 offer_id POST 到下单 URL。演示节点会回答 demo_mode，不出售任何东西。",
    try_loading: "正在询问卖家节点…", try_empty: "没有匹配的套餐。试试更少的流量或天数。",
    try_err: "演示节点没有响应。请一分钟后再试。", try_buy: "在演示店铺中打开 →",
    signed: "卖家签名 · Ed25519 · ", kind_country: "仅限该国", kind_region: "{n} 个国家", kind_global: "全球",
    gb: "GB", days: "天", tip_from: "起价", tip_local: "该国专属套餐 {n} 个", tip_click: "点击打开套餐",
    rails_k: "轨道", rails_title: "接入轨道能给运营者带来什么",
    rails_1_h: "被智能体发现", rails_1_p: "你的节点向 AIMarket 枢纽发布公告。通过准入检查后，在联邦中搜索 eSIM 的智能体就会看到你的套餐。",
    rails_2_h: "直接收款", rails_2_p: "x402 把 USDC 从智能体的钱包转到你的钱包。枢纽只负责路由搜索，从不经手资金。",
    rails_3_h: "可验证的响应", rails_3_p: "每个报价都用你节点的 Ed25519 密钥签名，并与请求绑定。枢纽会验证，智能体也可以验证。",
    rails_4_h: "所有卖家同一格式", rails_4_p: "所有卖家的套餐格式相同，智能体比较的是价格和覆盖范围，而不是各自的接入方式。",
    lane_people: "用户", lane_agents: "智能体", lane_find: "发现", lane_money: "资金",
    n_traveller: "旅行者", n_wallet: "任意钱包", n_store: "你的店铺", n_wholesale: "批发", n_agent: "智能体",
    n_node: "你的节点", n_fed: "联邦节点", n_agents: "智能体", n_buyers: "买家", n_wallets: "你的钱包", n_topup: "你的充值",
    rails_more: "轨道与使用场景 →",
    run_k: "运行", run_title: "从空服务器到店铺，只需一个 compose 文件",
    run_sub: "一个域名、Docker 和你的 eSIM Access 密钥。Caddy 自动获取证书；在你开启之前，店铺运行在演示模式。",
    run_guide: "阅读运营者指南",
    gal_k: "图库", gal_title: "你的买家看到的样子",
    gal_sub: "参考店铺，即 esim-shop.modelmarket.dev 上运行的版本。付款页面中的地址和代码均为占位内容。",
    g_home: "目的地和价格", g_country: "某国套餐，按流量和天数筛选", g_checkout: "付款：十条网络",
    g_tron: "在 Tron 上用 USDT 付款：精确金额和二维码", g_esim: "eSIM 已可安装", g_docs: "五种语言的指南",
    docs_k: "文档", docs_title: "五种语言的指南",
    d_overview: "概览", d_rails: "轨道与使用场景", d_operator: "运营者指南", d_agents: "智能体指南", d_github: "GitHub 上",
    foot_part: "AIMarket 生态的一部分", foot_demo: "演示不出售任何东西：付款已关闭。", foot_tools: "免费工具",
  },
};


// The onboarding of existing operators: these strings override and extend the ones above.
const T_ONBOARD = {
  en: {
    h1: "Sell eSIMs to AI agents.",
    lead: "Put your eSIM business on the AIMarket rails: agents find your offers through the federation and pay over x402, straight to your wallet. Keep your platform and your supplier — or start from scratch with the shop included.",
    cta_onboard: "Onboard your eSIM business", cta_shop: "Example shop",
    onb_k: "Already an operator", onb_title: "Plug your systems in. Don't rebuild them.",
    onb_sub: "Operators, MVNOs, resellers and travel platforms keep their platform, their supplier and their checkout. Four ways in; every one ends with your offers in front of agents.",
    onb_a_h: "Your supplier account", onb_a_p: "eSIM Access, Airalo or eSIM Go: set SUPPLIER, add your keys, docker compose up. The whole kit runs on your account.",
    onb_b_h: "Your own system", onb_b_p: "Five signed HTTP endpoints in any language — catalog, orders, profiles, cancel, balance. The kit does agents, payments and federation.",
    onb_c_h: "The SDK", onb_c_p: "@aimarket/esim-rails inside your Node.js service: createNode() with signing, x402 and idempotent orders.",
    onb_d_h: "Your own agent API", onb_d_p: "Implement esim.*@v1 in your stack, check it with esim-rails check, then announce it to a hub.",
    onb_int_title: "Ready integrations", onb_steps_title: "Onboarding in seven steps",
    onb_s1: "Read what agents will call (agent guide).", onb_s2: "Choose a path: A, B, C or D.",
    onb_s3: "Run the kit in demo mode with your supplier.", onb_s4: "Point the webhooks at your CRM; make one test order.",
    onb_s5: "Run esim-rails check until every line is ✓.", onb_s6: "Start the federation node and knock on a hub.",
    onb_s7: "Switch demo mode off: you sell to agents.",
    onb_more: "Onboarding guide, with diagrams →", onb_more2: "Integrations →",
    int_own: "Your own system (5 HTTP endpoints)", int_crm: "CRM · billing · accounting (webhooks)", int_auto: "n8n · Make · Zapier · HubSpot",
    st_live: "✅ live-tested", st_api: "🟡 to the published API", st_ok: "✅ tested", st_sheet: "🟡 Apps Script", st_recipe: "📘 recipe",
    d_integrations: "Integrations", d_sdk: "SDK reference", d_rails: "Onboarding",
  },
  ru: {
    h1: "Продавайте eSIM ИИ-агентам.",
    lead: "Поставьте свой eSIM-бизнес на рельсы AIMarket: агенты находят ваши предложения через федерацию и платят по x402 прямо на ваш кошелёк. Сохраните свою платформу и своего поставщика — или начните с нуля с готовым магазином.",
    cta_onboard: "Подключить свой eSIM-бизнес", cta_shop: "Пример магазина",
    onb_k: "Уже оператор", onb_title: "Подключите свои системы. Не перестраивайте их.",
    onb_sub: "Операторы, MVNO, реселлеры и тревел-платформы сохраняют свою платформу, своего поставщика и свою оплату. Четыре пути; каждый заканчивается вашими предложениями перед агентами.",
    onb_a_h: "Ваш аккаунт у поставщика", onb_a_p: "eSIM Access, Airalo или eSIM Go: задайте SUPPLIER, добавьте ключи, docker compose up. Весь кит работает на вашем аккаунте.",
    onb_b_h: "Ваша собственная система", onb_b_p: "Пять подписанных HTTP-эндпоинтов на любом языке — каталог, заказы, профили, отмена, баланс. Агентов, платежи и федерацию берёт на себя кит.",
    onb_c_h: "SDK", onb_c_p: "@aimarket/esim-rails внутри вашего сервиса на Node.js: createNode() с подписью, x402 и идемпотентными заказами.",
    onb_d_h: "Ваш собственный API для агентов", onb_d_p: "Реализуйте esim.*@v1 в своём стеке, проверьте esim-rails check и анонсируйте хабу.",
    onb_int_title: "Готовые интеграции", onb_steps_title: "Онбординг за семь шагов",
    onb_s1: "Прочитайте, что будут вызывать агенты (гайд для агентов).", onb_s2: "Выберите путь: A, B, C или D.",
    onb_s3: "Запустите кит в демо-режиме со своим поставщиком.", onb_s4: "Направьте вебхуки в свою CRM; сделайте один тестовый заказ.",
    onb_s5: "Запускайте esim-rails check, пока каждая строка не станет ✓.", onb_s6: "Запустите узел федерации и анонсируйте его хабу.",
    onb_s7: "Выключите демо-режим: вы продаёте агентам.",
    onb_more: "Гайд по онбордингу со схемами →", onb_more2: "Интеграции →",
    int_own: "Ваша система (5 HTTP-эндпоинтов)", int_crm: "CRM · биллинг · учёт (вебхуки)", int_auto: "n8n · Make · Zapier · HubSpot",
    st_live: "✅ проверено вживую", st_api: "🟡 по опубликованному API", st_ok: "✅ проверено", st_sheet: "🟡 Apps Script", st_recipe: "📘 рецепт",
    d_integrations: "Интеграции", d_sdk: "Справочник SDK", d_rails: "Онбординг",
  },
  es: {
    h1: "Vende eSIM a agentes de IA.",
    lead: "Pon tu negocio de eSIM sobre los rieles de AIMarket: los agentes encuentran tus ofertas en la federación y pagan por x402, directamente a tu monedero. Conserva tu plataforma y tu proveedor, o empieza de cero con la tienda incluida.",
    cta_onboard: "Incorpora tu negocio de eSIM", cta_shop: "Tienda de ejemplo",
    onb_k: "Ya eres operador", onb_title: "Conecta tus sistemas. No los reconstruyas.",
    onb_sub: "Operadores, MVNO, revendedores y plataformas de viaje conservan su plataforma, su proveedor y su pago. Cuatro caminos; todos terminan con tus ofertas delante de los agentes.",
    onb_a_h: "Tu cuenta de proveedor", onb_a_p: "eSIM Access, Airalo o eSIM Go: define SUPPLIER, añade tus claves, docker compose up. Todo el kit funciona sobre tu cuenta.",
    onb_b_h: "Tu propio sistema", onb_b_p: "Cinco endpoints HTTP firmados en cualquier lenguaje: catálogo, pedidos, perfiles, cancelación, saldo. El kit se ocupa de agentes, pagos y federación.",
    onb_c_h: "El SDK", onb_c_p: "@aimarket/esim-rails dentro de tu servicio Node.js: createNode() con firma, x402 y pedidos idempotentes.",
    onb_d_h: "Tu propia API para agentes", onb_d_p: "Implementa esim.*@v1 en tu stack, compruébalo con esim-rails check y anúncialo a un hub.",
    onb_int_title: "Integraciones listas", onb_steps_title: "Incorporación en siete pasos",
    onb_s1: "Lee lo que llamarán los agentes (guía para agentes).", onb_s2: "Elige un camino: A, B, C o D.",
    onb_s3: "Ejecuta el kit en modo demo con tu proveedor.", onb_s4: "Apunta los webhooks a tu CRM; haz un pedido de prueba.",
    onb_s5: "Ejecuta esim-rails check hasta que cada línea sea ✓.", onb_s6: "Arranca el nodo de federación y anúncialo a un hub.",
    onb_s7: "Desactiva el modo demo: vendes a agentes.",
    onb_more: "Guía de incorporación, con diagramas →", onb_more2: "Integraciones →",
    int_own: "Tu propio sistema (5 endpoints HTTP)", int_crm: "CRM · facturación · contabilidad (webhooks)", int_auto: "n8n · Make · Zapier · HubSpot",
    st_live: "✅ probado en vivo", st_api: "🟡 según la API publicada", st_ok: "✅ probado", st_sheet: "🟡 Apps Script", st_recipe: "📘 receta",
    d_integrations: "Integraciones", d_sdk: "Referencia del SDK", d_rails: "Incorporación",
  },
  fr: {
    h1: "Vendez des eSIM aux agents IA.",
    lead: "Mettez votre activité eSIM sur les rails AIMarket : les agents trouvent vos offres via la fédération et paient via x402, directement sur votre portefeuille. Gardez votre plateforme et votre fournisseur — ou partez de zéro avec la boutique incluse.",
    cta_onboard: "Raccorder votre activité eSIM", cta_shop: "Boutique d'exemple",
    onb_k: "Déjà opérateur", onb_title: "Branchez vos systèmes. Ne les reconstruisez pas.",
    onb_sub: "Opérateurs, MVNO, revendeurs et plateformes de voyage gardent leur plateforme, leur fournisseur et leur paiement. Quatre voies ; toutes mènent vos offres devant les agents.",
    onb_a_h: "Votre compte fournisseur", onb_a_p: "eSIM Access, Airalo ou eSIM Go : réglez SUPPLIER, ajoutez vos clés, docker compose up. Tout le kit tourne sur votre compte.",
    onb_b_h: "Votre propre système", onb_b_p: "Cinq endpoints HTTP signés, dans n'importe quel langage — catalogue, commandes, profils, annulation, solde. Le kit gère agents, paiements et fédération.",
    onb_c_h: "Le SDK", onb_c_p: "@aimarket/esim-rails dans votre service Node.js : createNode() avec signature, x402 et commandes idempotentes.",
    onb_d_h: "Votre propre API pour agents", onb_d_p: "Implémentez esim.*@v1 dans votre stack, vérifiez-le avec esim-rails check, puis annoncez-le à un hub.",
    onb_int_title: "Intégrations prêtes", onb_steps_title: "La prise en main en sept étapes",
    onb_s1: "Lisez ce que les agents appelleront (guide pour les agents).", onb_s2: "Choisissez une voie : A, B, C ou D.",
    onb_s3: "Lancez le kit en mode démo avec votre fournisseur.", onb_s4: "Pointez les webhooks vers votre CRM ; faites une commande test.",
    onb_s5: "Lancez esim-rails check jusqu'à ce que chaque ligne soit ✓.", onb_s6: "Démarrez le nœud de fédération et annoncez-le à un hub.",
    onb_s7: "Désactivez le mode démo : vous vendez aux agents.",
    onb_more: "Guide de prise en main, avec schémas →", onb_more2: "Intégrations →",
    int_own: "Votre propre système (5 endpoints HTTP)", int_crm: "CRM · facturation · comptabilité (webhooks)", int_auto: "n8n · Make · Zapier · HubSpot",
    st_live: "✅ testé en direct", st_api: "🟡 selon l'API publiée", st_ok: "✅ testé", st_sheet: "🟡 Apps Script", st_recipe: "📘 recette",
    d_integrations: "Intégrations", d_sdk: "Référence du SDK", d_rails: "Prise en main",
  },
  zh: {
    h1: "把 eSIM 卖给 AI 智能体。",
    lead: "把你的 eSIM 业务接入 AIMarket 轨道：智能体通过联邦发现你的套餐，并通过 x402 直接付款到你的钱包。保留你的平台和供应商——或者从零开始，店铺已包含在内。",
    cta_onboard: "接入你的 eSIM 业务", cta_shop: "示例店铺",
    onb_k: "已经是运营商", onb_title: "接入你的系统，而不是重建它们。",
    onb_sub: "运营商、MVNO、经销商和旅行平台保留自己的平台、供应商和结账流程。四种接入方式，最终都会把你的套餐呈现在智能体面前。",
    onb_a_h: "你的供应商账户", onb_a_p: "eSIM Access、Airalo 或 eSIM Go：设置 SUPPLIER，添加密钥，docker compose up。整套套件运行在你的账户上。",
    onb_b_h: "你自己的系统", onb_b_p: "任意语言的五个签名 HTTP 端点——目录、订单、配置文件、取消、余额。智能体、付款和联邦由套件负责。",
    onb_c_h: "SDK", onb_c_p: "在你的 Node.js 服务中使用 @aimarket/esim-rails：带签名、x402 和幂等订单的 createNode()。",
    onb_d_h: "你自己的智能体 API", onb_d_p: "在你的技术栈中实现 esim.*@v1，用 esim-rails check 检查，然后向枢纽发布公告。",
    onb_int_title: "现成的集成", onb_steps_title: "七步完成接入",
    onb_s1: "了解智能体会调用什么（智能体指南）。", onb_s2: "选择一条路径：A、B、C 或 D。",
    onb_s3: "用你的供应商以演示模式运行套件。", onb_s4: "把 webhooks 指向你的 CRM；做一次测试订单。",
    onb_s5: "运行 esim-rails check，直到每一行都是 ✓。", onb_s6: "启动联邦节点并向枢纽发布公告。",
    onb_s7: "关闭演示模式：你开始向智能体销售。",
    onb_more: "接入指南（含图示）→", onb_more2: "集成 →",
    int_own: "你自己的系统（5 个 HTTP 端点）", int_crm: "CRM · 计费 · 会计（webhooks）", int_auto: "n8n · Make · Zapier · HubSpot",
    st_live: "✅ 已实测", st_api: "🟡 按公开 API", st_ok: "✅ 已测试", st_sheet: "🟡 Apps Script", st_recipe: "📘 配方",
    d_integrations: "集成", d_sdk: "SDK 参考", d_rails: "接入指南",
  },
};
for (const l of Object.keys(T_ONBOARD)) Object.assign(T[l], T_ONBOARD[l]);

const LANG_NAMES = { en: "English", ru: "Русский", es: "Español", fr: "Français", zh: "中文" };
const prefix = (l) => (l === "en" ? "/" : `/${l}/`);
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const flag = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "text") e.textContent = v; else if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};

let lang = "en";
const t = (k) => T[lang][k] ?? T.en[k] ?? k;
const region = (cc) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(cc) || cc; } catch { return cc; } };
const money = (usd) => new Intl.NumberFormat(lang, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(usd);

function pickLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (LANGS.includes(q)) return q;
  try { const s = localStorage.getItem("esim-kit-lang"); if (LANGS.includes(s)) return s; } catch { /* storage off */ }
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return LANGS.includes(n) ? n : "en";
}

function applyLang(l) {
  lang = l;
  document.documentElement.lang = l === "zh" ? "zh-Hans" : l;
  for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
  for (const b of document.querySelectorAll(".langs button")) b.setAttribute("aria-pressed", String(b.dataset.lang === l));
  for (const a of document.querySelectorAll("[data-doc]")) a.href = `${STORE}${prefix(l)}kit/${a.dataset.doc}`;
  try { localStorage.setItem("esim-kit-lang", l); } catch { /* storage off */ }
  renderNets(); renderDocs(); renderInts(); renderLegend(); fillCountries(); renderCurl();
}

function renderLegend() {
  const box = document.getElementById("legend");
  box.replaceChildren(...NETWORKS.slice(0, 5).map((n) => el("span", {}, el("i", { style: `background:${n.color}` }), n.name)),
    el("span", {}, el("i", { style: "background:#eafff7;box-shadow:0 0 8px #7fe9d6" }), t("legend_agent")));
}

function renderNets() {
  document.getElementById("nets").replaceChildren(...NETWORKS.map((n) => el("div", { class: "net", style: `--c:${n.color}` },
    el("i"), el("div", {}, el("b", { text: n.name }), el("small", { text: n.gasless ? `${n.tokens} · ${t("gasless")}` : n.tokens })))));
}

function renderInts() {
  const rows = [["eSIM Access", "st_live"], ["Airalo Partner API", "st_api"], ["eSIM Go API v2.5", "st_api"], [t("int_own"), "st_ok"],
                [t("int_crm"), "st_ok"], ["Telegram · Slack", "st_ok"], ["Google Sheets", "st_sheet"], [t("int_auto"), "st_recipe"]];
  document.getElementById("ints").replaceChildren(...rows.flatMap(([name, st]) => [el("span", { text: name }), el("span", { text: t(st) })]));
}

function renderDocs() {
  const pages = [["", "d_overview"], ["rails", "d_rails"], ["integrations", "d_integrations"], ["sdk", "d_sdk"], ["operator", "d_operator"], ["agents", "d_agents"]];
  const order = [lang, ...LANGS.filter((l) => l !== lang)];
  document.getElementById("docs-grid").replaceChildren(...order.map((l) => el("div", { class: "card" },
    el("h3", { text: LANG_NAMES[l], lang: l }),
    ...pages.map(([p, k]) => el("a", { href: `${STORE}${prefix(l)}kit${p ? `/${p}` : ""}`, text: T[l][k], lang: l })),
    el("a", { href: `https://github.com/alexar76/esim-operator-kit/blob/main/${l === "en" ? "README.md" : `README.${l}.md`}`,
              text: `README ${T[l].d_github}`, lang: l, class: "muted" }))));
}

// ── live numbers and the quote form ─────────────────────────────────────────────────────
const countrySel = document.getElementById("q-country");
function fillCountries() {
  const keep = countrySel.value || "JP";
  const opts = COUNTRIES.map(([cc]) => cc).filter((cc) => cc !== "AN")
    .sort((a, b) => region(a).localeCompare(region(b), lang));
  countrySel.replaceChildren(...opts.map((cc) => el("option", { value: cc, text: `${flag(cc)} ${region(cc)}` })));
  countrySel.value = keep;
}
function quoteBody() {
  return { country: countrySel.value || "JP", min_gb: Number(document.getElementById("q-gb").value), min_days: Number(document.getElementById("q-days").value), limit: 3 };
}
function renderCurl() {
  const body = JSON.stringify(quoteBody());
  const pre = document.getElementById("curl");
  pre.replaceChildren(el("span", { class: "c", text: "# esim.quote@v1 — free, signed" }), "\n",
    el("span", { class: "k", text: "curl" }), ` -s -X POST ${NODE}/quote \\\n  -H 'content-type: application/json' \\\n  -d `,
    el("span", { class: "s", text: `'${body}'` }));
}
document.getElementById("q-gb").addEventListener("change", renderCurl);
document.getElementById("q-days").addEventListener("change", renderCurl);
countrySel.addEventListener("change", renderCurl);

document.getElementById("q").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const out = document.getElementById("offers");
  const signed = document.getElementById("signed");
  const body = quoteBody();
  renderCurl();
  signed.hidden = true;
  out.replaceChildren(el("p", { class: "muted", text: t("try_loading") }));
  try {
    const r = await fetch(`${NODE}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || r.status);
    const offers = d.result.offers || [];
    if (!offers.length) { out.replaceChildren(el("p", { class: "muted", text: t("try_empty") })); return; }
    out.replaceChildren(...offers.map((o) => {
      const cov = o.coverage?.kind === "country" ? t("kind_country") : o.coverage?.kind === "global" ? t("kind_global")
        : fill(t("kind_region"), { n: o.coverage?.countries?.length ?? "" });
      return el("div", { class: "offer" },
        el("div", {}, el("b", { text: `${o.data_gb} ${t("gb")} · ${o.days} ${t("days")}` }), el("br"),
          el("small", { text: `${cov} · ${o.speed || ""} · ${o.offer_id}` })),
        el("div", { class: "price", text: money(Number(o.price.usd)) }),
        el("a", { href: `${SHOP}${prefix(lang)}c/${body.country.toLowerCase()}`, text: t("try_buy") }));
    }));
    const sig = r.headers.get("x-provider-signature");
    if (sig) { signed.textContent = `✓ ${t("signed")}${sig.slice(0, 22)}…`; signed.hidden = false; }
  } catch {
    out.replaceChildren(el("p", { class: "muted", text: t("try_err") }));
  }
});

async function liveStats() {
  document.getElementById("s-countries").textContent = String(COUNTRIES.length);
  try {
    const r = await fetch(`${NODE}/healthz`, { signal: AbortSignal.timeout(8000) });
    const h = await r.json();
    if (h.offers) document.getElementById("s-plans").textContent = new Intl.NumberFormat(lang).format(h.offers);
  } catch { /* the snapshot number stays */ }
}

// ── scroll reveal ───────────────────────────────────────────────────────────────────────
const io = "IntersectionObserver" in window
  ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 })
  : null;
document.querySelectorAll(".reveal").forEach((e) => (io ? io.observe(e) : e.classList.add("in")));

for (const b of document.querySelectorAll(".langs button")) b.addEventListener("click", () => applyLang(b.dataset.lang));
applyLang(pickLang());
liveStats();

// ── the globe ───────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("globe");
const tip = document.getElementById("tip");
const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
import("./globe.js").then(({ startGlobe }) => startGlobe({
  canvas, land: LAND, countries: COUNTRIES, networks: NETWORKS, reduced,
  onHover(c, x, y) {
    if (!c) { tip.style.opacity = "0"; return; }
    const [cc, , , from, local] = c;
    tip.replaceChildren(el("b", { text: `${flag(cc)} ${region(cc)}` }),
      el("small", { text: `${t("tip_from")} ${money(from)}${local ? ` · ${fill(t("tip_local"), { n: local })}` : ""}` }),
      el("small", { text: t("tip_click") }));
    tip.style.left = `${x}px`; tip.style.top = `${y}px`; tip.style.opacity = "1";
  },
  onPick(c) { if (c[0] !== "AN") window.open(`${SHOP}${prefix(lang)}c/${c[0].toLowerCase()}`, "_blank", "noopener"); },
})).catch(() => { canvas.style.display = "none"; });
