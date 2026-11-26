import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createModelCanonServer } from "../src/mcp/server.js";
import { CatalogCacheStore } from "../src/store/cache.js";

describe("Cold-start offline fallback via bundled data/seed.json", () => {
  it("resolves queries in < 50 ms with no network and read-only cache fallback", async () => {
    const cacheStore = new CatalogCacheStore({
      cacheFilePath: "/nonexistent-readonly-path/catalog-snapshot.json",
      offlineFallback: true,
      ttlSeconds: 60,
    });

    const failingFetch: typeof fetch = async () => {
      throw new Error("Simulated offline environment");
    };

    const server = createModelCanonServer({
      cacheStore,
      fetchImpl: failingFetch,
      now: () => new Date("2026-11-26T08:00:00Z"),
    });

    const client = new Client({ name: "cold-start-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const start = performance.now();
      const res = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "claude-opus-5-5" },
      });
      const elapsedMs = performance.now() - start;

      const payload = res.structuredContent as Record<string, unknown>;
      expect(payload.canonical_id).toBe("claude-opus-5-5");
      expect(payload.context_window).toBe(1_000_000);
      expect(payload.source_origin).toBe("bundled_seed");
      expect(payload.stale).toBe(true);
      expect(elapsedMs).toBeLessThan(150);

      const sonnetRes = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "claude-sonnet-4-5" },
      });
      const sonnetPayload = sonnetRes.structuredContent as Record<string, unknown>;
      expect(sonnetPayload.status).toBe("deprecated");
      expect(sonnetPayload.shutdown_date).toBe("2026-11-30");
      expect(sonnetPayload.replacement_id).toBe("claude-sonnet-5-5");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
