import type { NextRequest } from "next/server";
import { SYMBOL_RE, json } from "@/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  translated: boolean;
}

const cache = new Map<string, { at: number; items: NewsItem[] }>();
const CACHE_MS = 180_000;

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ").trim();
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

function parseRss(xml: string): NewsItem[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m, i) => {
    const body = m[1];
    const published = Date.parse(tag(body, "pubDate"));
    const url = tag(body, "link") || tag(body, "guid");
    return {
      id: `${url || "news"}-${i}`,
      title: tag(body, "title"),
      summary: tag(body, "description").slice(0, 300),
      url,
      source: tag(body, "source") || "Google News",
      publishedAt: Number.isFinite(published) ? published : Date.now(),
      translated: false,
    };
  }).filter((item) => item.title && item.url).sort((a, b) => b.publishedAt - a.publishedAt);
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

async function translate(items: NewsItem[]): Promise<NewsItem[]> {
  return translateFallback(items);
}

async function translateFallback(items: NewsItem[]): Promise<NewsItem[]> {
  const output: NewsItem[] = [];
  for (const item of items) {
    try {
      const translateText = async (value: string) => {
        if (!value) return "";
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(value)}&langpair=en%7Cfa`, { signal: AbortSignal.timeout(4_000) });
        if (!res.ok) return "";
        const body = await res.json() as { responseData?: { translatedText?: string } };
        return body.responseData?.translatedText?.replace(/&#10;/g, " ").replace(/\s+/g, " ").trim() ?? "";
      };
      const title = await translateText(item.title);
      output.push(title ? { ...item, title, summary: "", translated: true } : item);
    } catch {
      output.push(item);
    }
  }
  return output;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return json({ error: "invalid_symbol" }, 400);
  const page = Math.min(Math.max(Number(req.nextUrl.searchParams.get("page") || "1"), 1), 5);
  const name = req.nextUrl.searchParams.get("name")?.slice(0, 80) || symbol;
  const key = `${symbol}:${name}`;
  const cached = cache.get(key);
  let items = cached && Date.now() - cached.at < CACHE_MS ? cached.items : null;
  if (!items) {
    const query = encodeURIComponent(`"${name}" OR "${symbol}" cryptocurrency`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { headers: { "User-Agent": "ShahabRadar/1.0" }, signal: AbortSignal.timeout(10_000), next: { revalidate: 180 } });
    if (!res.ok) return json({ error: "news_unavailable", items: [], page, hasMore: false }, 502);
    const parsed = parseRss(await res.text());
    const nameToken = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const symbolToken = symbol.toLowerCase();
    const relevant = parsed.filter((item) => {
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      return haystack.includes(nameToken) || new RegExp(`\\b${symbolToken}\\b`, "i").test(haystack);
    });
    items = await translate(relevant.slice(0, 30));
    cache.set(key, { at: Date.now(), items });
  }
  const start = (page - 1) * 6;
  return json({ symbol, items: items.slice(start, start + 6), page, hasMore: start + 6 < items.length, updatedAt: Date.now() });
}
