export interface ApiHealthEvent {
  id: string;
  endpoint: string;
  url: string | null;
  method: string;
  ticker: string | null;
  statusCode: number | null;
  statusText: string | null;
  retryAfterMs: number | null;
  responseTimeMs: number;
  timestamp: number;
  cached: boolean;
  retryCount: number;
  rateLimited: boolean;
  errorMessage: string | null;
}

const MAX_EVENTS = 250;
const events: ApiHealthEvent[] = [];

export function logApiHealth(
  event: Omit<ApiHealthEvent, "id" | "timestamp" | "url" | "method" | "statusText" | "retryAfterMs"> & {
    timestamp?: number;
    url?: string | null;
    method?: string;
    statusText?: string | null;
    retryAfterMs?: number | null;
  },
): void {
  events.unshift({
    ...event,
    url: event.url ?? null,
    method: event.method ?? "GET",
    statusText: event.statusText ?? null,
    retryAfterMs: event.retryAfterMs ?? null,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp ?? Date.now(),
  });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

export function getApiHealthEvents(limit = 100): ApiHealthEvent[] {
  return events.slice(0, limit);
}

export function clearApiHealthEvents(): void {
  events.length = 0;
}
