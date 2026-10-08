import { TOP_N } from "@/lib/shared";
import { fetchJson, getState, log, nowEx } from "./core";
import { fetchPrices, fetchServerTime, fetchUsdtPairs } from "./binance";
import type { UniverseItem } from "./core";

interface Coin {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  marketCap: number;
  price: number;
}

interface GeckoCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
}

/** Defensive exclusion filter only (never a monitored list). */
const STABLE_SYMBOLS = new Set([
  "usdt", "usdc", "dai", "tusd", "busd", "fdusd", "usde", "usds", "usd1", "usdd", "pyusd", "usdg",
  "rlusd", "usdy", "usdf", "gusd", "lusd", "susd", "crvusd", "usdp", "eurc", "eurt", "usdtb", "usd0",
  "gho", "frax", "usyc", "buidl", "ustb", "usdb", "usdx", "ousd", "mim", "alusd", "dola", "eusd",
  "xsgd", "usdn", "bfusd", "usdgo", "a7a5", "ylds", "apxusd", "reusd", "ausd", "u", "sofid",
]);

function isStable(c: Coin, stableIds: Set<string>): boolean {
  if (stableIds.has(c.id)) return true;
  const sym = c.symbol.toLowerCase();
  if (STABLE_SYMBOLS.has(sym)) return true;
  const pegged = c.price > 0.97 && c.price < 1.03;
  return pegged && /usd|stable|dollar/i.test(`${c.name} ${c.symbol}`);
}

async function geckoMarkets(extra: Record<string, string>): Promise<GeckoCoin[]> {
  const qs = new URLSearchParams({
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: "250",
    page: "1",
    sparkline: "false",
    ...extra,
  });
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  return fetchJson<GeckoCoin[]>(`https://api.coingecko.com/api/v3/coins/markets?${qs.toString()}`, {
    headers,
    retries: 3,
    baseDelayMs: 2500,
    timeoutMs: 20_000,
  });
}

async function fromCoinGecko(): Promise<{ coins: Coin[]; stableIds: Set<string>; source: string }> {
  const pages = await Promise.all(
    [1, 2, 3, 4].map((page) => geckoMarkets({ page: String(page) })),
  );
  const stables = await geckoMarkets({ category: "stablecoins" }).catch(() => [] as GeckoCoin[]);
  const list = pages.flat();
  const coins: Coin[] = list
    .filter((c) => c.market_cap_rank && c.market_cap && c.market_cap > 0)
    .map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      rank: c.market_cap_rank as number,
      marketCap: c.market_cap as number,
      price: c.current_price ?? 0,
    }))
    .sort((a, b) => a.rank - b.rank);
  if (coins.length < 250) throw new Error("coingecko_short_list");
  return { coins, stableIds: new Set(stables.map((s) => s.id)), source: "coingecko" };
}

async function fromCoinGeckoLegacy(): Promise<{ coins: Coin[]; stableIds: Set<string>; source: string }> {
  const [list, stables] = await Promise.all([
    geckoMarkets({}),
    geckoMarkets({ category: "stablecoins" }).catch(() => [] as GeckoCoin[]),
  ]);
  const coins: Coin[] = list
    .filter((c) => c.market_cap_rank && c.market_cap && c.market_cap > 0)
    .map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      rank: c.market_cap_rank as number,
      marketCap: c.market_cap as number,
      price: c.current_price ?? 0,
    }))
    .sort((a, b) => a.rank - b.rank);
  if (coins.length < 60) throw new Error("coingecko_short_list");
  return { coins, stableIds: new Set(stables.map((s) => s.id)), source: "coingecko" };
}

async function fromPaprika(): Promise<{ coins: Coin[]; stableIds: Set<string>; source: string }> {
  const rows = await fetchJson<
    { id: string; name: string; symbol: string; rank: number; quotes?: { USD?: { price: number; market_cap: number } } }[]
  >("https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=1000", { retries: 2, baseDelayMs: 2000, timeoutMs: 20_000 });
  const coins: Coin[] = rows
    .filter((r) => r.rank > 0 && r.quotes?.USD?.market_cap)
    .map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      rank: r.rank,
      marketCap: r.quotes!.USD!.market_cap,
      price: r.quotes!.USD!.price ?? 0,
    }))
    .sort((a, b) => a.rank - b.rank);
  if (coins.length < 60) throw new Error("paprika_short_list");
  return { coins, stableIds: new Set(), source: "coinpaprika" };
}

/**
 * Builds the dynamic Top-1000 universe: market-cap ranking (CoinGecko, CoinPaprika as fallback),
 * stablecoins removed, and only assets that have a verified, trading USDT spot market whose
 * live price matches the market-cap data (guards against ticker collisions).
 */
export async function selectUniverse(): Promise<{
  list: UniverseItem[];
  source: string;
  excludedStable: number;
  unavailable: number;
}> {
  const st = getState();
  let ranked: { coins: Coin[]; stableIds: Set<string>; source: string };
  try {
    ranked = await fromCoinGecko();
  } catch (e) {
    log("market-cap primary failed, trying fallback:", e instanceof Error ? e.message : e);
    ranked = await fromPaprika();
  }

  // exchange symbols (cached 1h) + live prices + clock offset
  if (!st.exchange.pairs.size || Date.now() - st.exchange.at > 3_600_000) {
    st.exchange = { at: Date.now(), pairs: await fetchUsdtPairs() };
  }
  const [prices, serverTime] = await Promise.all([
    fetchPrices().catch(() => new Map<string, number>()),
    fetchServerTime().catch(() => 0),
  ]);
  if (serverTime) st.clockOffset = serverTime - Date.now();

  const list: UniverseItem[] = [];
  const seen = new Set<string>();
  let excludedStable = 0;
  let unavailable = 0;
  for (const coin of ranked.coins) {
    if (list.length >= TOP_N) break;
    const sym = coin.symbol.toUpperCase();
    if (isStable(coin, ranked.stableIds)) {
      excludedStable++;
      continue;
    }
    if (seen.has(sym)) continue;
    const pair = st.exchange.pairs.get(sym);
    if (!pair) {
      unavailable++;
      continue;
    }
    const px = prices.get(pair);
    if (pair.endsWith("USDT") && px && coin.price > 0 && Math.abs(px / coin.price - 1) > 0.25) {
      unavailable++; // same ticker, different asset
      continue;
    }
    seen.add(sym);
    list.push({ symbol: sym, name: coin.name, id: coin.id, pair, rank: coin.rank, marketCap: coin.marketCap });
  }
  if (list.length < 30) throw new Error("universe_too_small");
  void nowEx;
  return { list, source: ranked.source, excludedStable, unavailable };
}
