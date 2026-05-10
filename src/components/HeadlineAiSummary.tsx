import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2 } from "lucide-react";
import {
  summarizeHeadline,
  type NewsAiSummary,
} from "@/lib/newsSummary.functions";

const CACHE_KEY = "market-intel:ai-summaries:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheEntry = NewsAiSummary & { at: number };
type Cache = Record<string, CacheEntry>;

function loadCache(): Cache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Cache;
    const now = Date.now();
    const fresh: Cache = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && now - v.at < CACHE_TTL_MS) fresh[k] = v;
    }
    return fresh;
  } catch {
    return {};
  }
}

function saveCache(c: Cache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

// Module-level cache shared across cards in the same session.
let memCache: Cache | null = null;
function getCache(): Cache {
  if (!memCache) memCache = loadCache();
  return memCache;
}
function setCacheEntry(key: string, entry: CacheEntry) {
  const c = getCache();
  c[key] = entry;
  saveCache(c);
}

// In-flight dedupe so two cards with the same URL don't both call the AI.
const inflight = new Map<string, Promise<NewsAiSummary>>();

interface Props {
  url: string;
  title: string;
  snippet?: string;
  source?: string;
}

export function HeadlineAiSummary({ url, title, snippet, source }: Props) {
  const callSummarize = useServerFn(summarizeHeadline);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; data: NewsAiSummary }
  >({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    const cached = getCache()[url];
    if (cached) {
      setState({ status: "ready", data: cached });
      return;
    }
    setState({ status: "loading" });
    let promise = inflight.get(url);
    if (!promise) {
      promise = callSummarize({ data: { title, snippet, source } }).then(
        (res) => {
          setCacheEntry(url, { ...res, at: Date.now() });
          return res;
        },
      );
      inflight.set(url, promise);
      promise.finally(() => inflight.delete(url));
    }
    promise
      .then((res) => {
        if (!cancelled) setState({ status: "ready", data: res });
      })
      .catch(() => {
        if (!cancelled)
          setState({
            status: "ready",
            data: { summary: snippet || title, bullets: [], error: "failed" },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [url, title, snippet, source, callSummarize]);

  if (state.status === "loading") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin text-primary/70" />
        Analyzing headline…
      </div>
    );
  }
  if (state.status !== "ready") return null;

  const { summary, bullets, error } = state.data;
  if (error && bullets.length === 0) return null;

  return (
    <div className="mt-1.5 rounded-md border border-primary/15 bg-primary/[0.04] px-2 py-1.5">
      <div className="flex items-start gap-1.5">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-primary/80">
              AI Summary
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-foreground/80">
            {summary}
          </p>
          {bullets.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
