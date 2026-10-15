#!/usr/bin/env node
// Send USDC on Base from a wallet you hold to an agent's wallet (for a test purchase). The owner runs
// it; the key is read from a JSON key file ({"private_key": "0x…"}) and never printed.
//
//   node scripts/fund-agent.mjs <key file> <agent address> <amount USDC>          shows what it would do
//   node scripts/fund-agent.mjs <key file> <agent address> <amount USDC> --yes    sends it
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http, parseUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const [keyFile, to, amount] = process.argv.slice(2);
if (!keyFile || !/^0x[0-9a-fA-F]{40}$/.test(to || "") || !/^\d+(\.\d{1,6})?$/.test(amount || "")) {
  console.error("usage: node scripts/fund-agent.mjs <key file> <agent address> <amount USDC> [--yes]");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(keyFile, "utf8"));
const key = String(raw.private_key ?? raw.privateKey ?? "");
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
// Base's own endpoint: publicnode refuses eth_getTransactionReceipt without a token ("archive requests"),
// which left a sent transfer without its confirmation line on 2026-10-15.
const transport = http(process.env.BASE_RPC || "https://mainnet.base.org");
const chain = createPublicClient({ chain: base, transport });
const units = parseUnits(amount, 6);
const [usdc, eth] = await Promise.all([
  chain.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  chain.getBalance({ address: account.address }),
]);
console.log(`from   ${account.address}: ${formatUnits(usdc, 6)} USDC, ${formatEther(eth)} ETH`);
console.log(`to     ${to}: ${amount} USDC on Base`);
if (usdc < units) { console.error("not enough USDC"); process.exit(1); }
if (!process.argv.includes("--yes")) { console.log("dry run: add --yes to send"); process.exit(0); }
const wallet = createWalletClient({ account, chain: base, transport });
const tx = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [to, units] });
const receipt = await chain.waitForTransactionReceipt({ hash: tx });
console.log(`sent   ${tx} (block ${receipt.blockNumber}, ${receipt.status})`);
