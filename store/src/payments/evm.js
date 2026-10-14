// USDC and USDT on six EVM networks, paid by an ordinary token transfer and proved by its hash.
//
// The buyer's wallet sends `transfer(store, amount)` on the token contract (the page builds the
// call; a buyer paying from an exchange pastes the hash instead). The store checks the receipt on
// the network itself: a successful transaction, a Transfer event of that token to the store of at
// least the price, enough confirmations, and a block no older than the order — and one transaction
// pays one order. USDT has no EIP-3009 signature, so this path, not the gasless one, serves it.
//
// Every address below was read back from its contract (symbol, decimals) on 2026-10-14. On BNB Chain
// both tokens have 18 decimals; everywhere else 6.
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const EVM_CHAINS = {
  1: { key: "ethereum", name: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com", confirmations: 3,
       explorer: "https://etherscan.io/tx/", native: "ETH",
       tokens: { USDC: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6], USDT: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", 6] } },
  42161: { key: "arbitrum", name: "Arbitrum One", rpc: "https://arbitrum-one-rpc.publicnode.com", confirmations: 1,
       explorer: "https://arbiscan.io/tx/", native: "ETH",
       tokens: { USDC: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6], USDT: ["0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6] } },
  10: { key: "optimism", name: "OP Mainnet", rpc: "https://optimism-rpc.publicnode.com", confirmations: 1,
       explorer: "https://optimistic.etherscan.io/tx/", native: "ETH",
       tokens: { USDC: ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6], USDT: ["0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6] } },
  137: { key: "polygon", name: "Polygon", rpc: "https://polygon-bor-rpc.publicnode.com", confirmations: 10,
       explorer: "https://polygonscan.com/tx/", native: "POL",
       tokens: { USDC: ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6], USDT: ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6] } },
  56: { key: "bsc", name: "BNB Chain", rpc: "https://bsc-rpc.publicnode.com", confirmations: 3,
       explorer: "https://bscscan.com/tx/", native: "BNB",
       tokens: { USDC: ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18], USDT: ["0x55d398326f99059fF775485246999027B3197955", 18] } },
  // Base: USDC by transfer, for stores without a CDP key (with one, the gasless signature serves Base).
  8453: { key: "base", name: "Base", rpc: "https://base-rpc.publicnode.com", confirmations: 1,
       explorer: "https://basescan.org/tx/", native: "ETH",
       tokens: { USDC: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6] } },
  43114: { key: "avalanche", name: "Avalanche C-Chain", rpc: "https://avalanche-c-chain-rpc.publicnode.com", confirmations: 1,
       explorer: "https://snowtrace.io/tx/", native: "AVAX",
       tokens: { USDC: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6], USDT: ["0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6] } },
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const HASH = /^0x[0-9a-fA-F]{64}$/;
const word = (hex) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** The price in a token's smallest unit: cents × 10^(decimals − 2). */
export const tokenUnits = (cents, decimals) => (BigInt(cents) * 10n ** BigInt(decimals - 2)).toString();

export function evmTransfer({ payTo = "", chains = Object.keys(EVM_CHAINS).map(Number), rpcOverrides = {},
                              fetchImpl = globalThis.fetch }) {
  if (payTo && !ADDRESS.test(payTo)) throw new Error("payTo must be an EVM address");
  const enabled = chains.filter((c) => EVM_CHAINS[c]);
  const rpc = async (chainId, method, params) => {
    const url = rpcOverrides[chainId] || EVM_CHAINS[chainId].rpc;
    const res = await fetchImpl(url, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": "esim-kit/0.1" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000),
    });
    const d = await res.json();
    if (d.error) throw new Error(`rpc ${d.error.code}: ${d.error.message}`);
    return d.result;
  };

  return {
    id: "evm",
    kind: "claim",
    enabled: () => Boolean(payTo) && enabled.length > 0,
    options: () => enabled.flatMap((cid) => Object.keys(EVM_CHAINS[cid].tokens).map((tok) => ({
      id: `evm:${cid}:${tok}`, network: EVM_CHAINS[cid].name, token: tok }))),

    intent(order, { asset }) {
      const chain = EVM_CHAINS[asset?.chainId];
      const t = chain?.tokens[asset?.token];
      if (!chain || !t || !enabled.includes(Number(asset.chainId))) throw new Error("unknown network or token");
      const [address, decimals] = t;
      const units = tokenUnits(order.price_cents, decimals);
      const amount = (order.price_cents / 100).toFixed(2);
      return {
        method: "evm", chain_id: Number(asset.chainId), chain_name: chain.name, native: chain.native, token: asset.token,
        token_address: address, decimals, to: payTo, units, amount_display: `${amount} ${asset.token}`,
        explorer: chain.explorer, confirmations: chain.confirmations, rpc_public: chain.rpc,
        // transfer(address,uint256): what the wallet sends, to the token contract, with no ETH attached.
        tx: { to: address, value: "0x0", data: `0xa9059cbb${word(payTo)}${BigInt(units).toString(16).padStart(64, "0")}` },
        // EIP-681, for wallets that scan a QR code.
        uri: `ethereum:${address}@${asset.chainId}/transfer?address=${payTo}&uint256=${units}`,
      };
    },

    /**
     * Is `hash` this order's payment? {status: paid, ref, payer, units} | pending (not mined or not
     * confirmed yet) | failed (reverted) | wrong (not a payment to the store of this token and amount,
     * or older than the order).
     */
    async verify(intent, hash, { since }) {
      if (!HASH.test(hash || "")) return { status: "wrong", reason: "not_a_hash" };
      const cid = intent.chain_id;
      const receipt = await rpc(cid, "eth_getTransactionReceipt", [hash]);
      if (!receipt) return { status: "pending" };
      if (receipt.status !== "0x1") return { status: "failed" };
      const to = `0x${word(intent.to)}`;
      const log = (receipt.logs || []).find((l) => String(l.address).toLowerCase() === intent.token_address.toLowerCase()
        && l.topics?.[0] === TRANSFER && String(l.topics?.[2]).toLowerCase() === to && BigInt(l.data) >= BigInt(intent.units));
      if (!log) return { status: "wrong", reason: "no_transfer_to_store" };
      const block = await rpc(cid, "eth_getBlockByNumber", [receipt.blockNumber, false]);
      if (Number(block?.timestamp) * 1000 < since) return { status: "wrong", reason: "older_than_order" };
      const head = Number(await rpc(cid, "eth_blockNumber", []));
      if (head - Number(receipt.blockNumber) + 1 < intent.confirmations) return { status: "pending", confirming: true };
      return { status: "paid", ref: `evm:${cid}:${hash.toLowerCase()}`, payer: `0x${log.topics[1].slice(-40)}`, units: BigInt(log.data).toString() };
    },
  };
}
