export type SearchEngineId =
  | "ddg"
  | "bing"
  | "yandex"
  | "yahoo"
  | "brave"
  | "wikipedia"
  | "qwant"
  | "mojeek"
  | "searx"
  | "google"
  /** Adult / XXX search engines (NSFW mode) */
  | "nudevista"
  | "pornmd"
  | "ixxx"
  | "fuq"
  | "xnxx"
  | "xvideos"
  | "eporner"
  | "hqporner"
  | "auto";

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
  engine: string;
}

export interface SearchResult {
  query: string;
  results: SearchHit[];
  enginesUsed: string[];
  enginesSkipped: string[];
  enginesFailed: Array<{ engine: string; error: string }>;
  count: number;
}

export interface EngineContext {
  signal?: AbortSignal;
  politeDelayMs: number;
  safeSearch: "off" | "moderate" | "strict";
  limit: number;
  googleApiKey?: string;
  googleCx?: string;
  googleProvider?: "custom_search" | "serper" | "serpapi";
}
