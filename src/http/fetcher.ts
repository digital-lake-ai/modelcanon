import { createHash } from "node:crypto";

export interface FetchResourceOptions {
  etag?: string | null;
  lastModified?: string | null;
  accept?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  allowHttpForTests?: boolean;
  fetchImpl?: typeof fetch;
}

export interface FetchResourceResult {
  status: number;
  notModified: boolean;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
  sha256: string | null;
  contentType: string | null;
  bytesRead: number;
}

export class FetchLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly maxBytes: number,
  ) {
    super(`Response from ${url} exceeded maxBytes limit of ${maxBytes} bytes`);
    this.name = "FetchLimitError";
  }
}

export class FetchHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`HTTP GET ${url} failed with status ${status}`);
    this.name = "FetchHttpError";
  }
}

const SENSITIVE_HEADERS = new Set(["authorization", "x-api-key", "x-goog-api-key"]);
const MAX_REDIRECTS = 3;

function assertAllowedUrl(rawUrl: string, allowHttpForTests: boolean): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol === "https:") {
    return parsed;
  }
  if (allowHttpForTests && parsed.protocol === "http:") {
    return parsed;
  }
  throw new Error(`Only HTTPS URLs are permitted (received ${parsed.protocol})`);
}

function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function fetchResource(
  url: string,
  options: FetchResourceOptions = {},
): Promise<FetchResourceResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const allowHttpForTests = options.allowHttpForTests ?? false;

  let currentUrl = assertAllowedUrl(url, allowHttpForTests);
  let requestHeaders: Record<string, string> = {
    "User-Agent": "ModelCanon/0.1.2 (+https://github.com/digital-lake-ai/modelcanon)",
    ...options.headers,
  };
  if (options.accept) {
    requestHeaders.Accept = options.accept;
  }
  if (options.etag) {
    requestHeaders["If-None-Match"] = options.etag;
  }
  if (options.lastModified) {
    requestHeaders["If-Modified-Since"] = options.lastModified;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // Always issue HTTP GET (never HEAD) to avoid upstream 500 errors on catalog endpoints.
      const res = await fetchFn(currentUrl.toString(), {
        method: "GET",
        headers: requestHeaders,
        redirect: "manual",
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location || hop === MAX_REDIRECTS) {
          throw new FetchHttpError(currentUrl.toString(), res.status);
        }
        const nextUrl = assertAllowedUrl(
          new URL(location, currentUrl).toString(),
          allowHttpForTests,
        );
        if (nextUrl.origin !== currentUrl.origin) {
          requestHeaders = stripSensitiveHeaders(requestHeaders);
        }
        currentUrl = nextUrl;
        continue;
      }

      response = res;
      break;
    }

    if (!response) {
      throw new FetchHttpError(currentUrl.toString(), 310);
    }

    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const contentType = response.headers.get("content-type");

    if (response.status === 304) {
      return {
        status: 304,
        notModified: true,
        body: null,
        etag,
        lastModified,
        sha256: null,
        contentType,
        bytesRead: 0,
      };
    }

    if (!response.ok) {
      throw new FetchHttpError(currentUrl.toString(), response.status);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredBytes = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        await response.body?.cancel();
        throw new FetchLimitError(currentUrl.toString(), maxBytes);
      }
    }

    if (!response.body) {
      const text = await response.text();
      const buf = Buffer.from(text, "utf8");
      if (buf.byteLength > maxBytes) {
        throw new FetchLimitError(currentUrl.toString(), maxBytes);
      }
      return {
        status: response.status,
        notModified: false,
        body: text,
        etag,
        lastModified,
        sha256: createHash("sha256").update(buf).digest("hex"),
        contentType,
        bytesRead: buf.byteLength,
      };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new FetchLimitError(currentUrl.toString(), maxBytes);
        }
        chunks.push(value);
      }
    }

    const combined = Buffer.concat(chunks);
    const sha256 = createHash("sha256").update(combined).digest("hex");
    return {
      status: response.status,
      notModified: false,
      body: combined.toString("utf8"),
      etag,
      lastModified,
      sha256,
      contentType,
      bytesRead: combined.byteLength,
    };
  } finally {
    clearTimeout(timer);
  }
}
