import { expect, test } from "bun:test";
import { createApiHandler } from "./server";
import { SWITCHBAY_VERSION } from "../version";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("health reports the local service", async () => {
  const response = await createApiHandler()(new Request("http://local/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, service: "switchbay", version: SWITCHBAY_VERSION });
});

test("bearer auth protects API routes but not health", async () => {
  const handler = createApiHandler({ token: "secret" });
  expect((await handler(new Request("http://local/v1/sessions"))).status).toBe(401);
  expect((await handler(new Request("http://local/health"))).status).toBe(200);
  expect((await handler(new Request("http://local/v1/sessions", { headers: { authorization: "Bearer secret" } }))).status).toBe(200);
});

test("turn validates JSON and input before calling the model", async () => {
  const handler = createApiHandler();
  const missing = await handler(new Request("http://local/v1/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ error: { code: "bad_request" } });

  const malformed = await handler(new Request("http://local/v1/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
  expect(malformed.status).toBe(400);
});

test("unknown routes return JSON 404", async () => {
  const response = await createApiHandler()(new Request("http://local/nope"));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { message: "Not found", code: "not_found" } });
});

test("capabilities and status expose machine-readable service state", async () => {
  const handler = createApiHandler();
  const capabilities: any = await (await handler(new Request("http://local/v1/capabilities"))).json();
  expect(capabilities.features).toContain("streaming");
  expect(capabilities.features).toContain("native-tools");
  expect(capabilities.serviceVersion).toBe(SWITCHBAY_VERSION);
  expect(capabilities.nativeTools.environment.backend).toBeTruthy();
  const status: any = await (await handler(new Request("http://local/v1/status"))).json();
  expect(status).toMatchObject({ ok: true, apiVersion: "1", serviceVersion: SWITCHBAY_VERSION });
});

test("workspace pages expose structured local inventories", async () => {
  const handler = createApiHandler();
  const workspace = encodeURIComponent(process.cwd());
  const agents = await handler(new Request(`http://local/v1/agents?workspace=${workspace}`));
  expect(agents.status).toBe(200);
  expect((await agents.json() as any).agents.some((agent: any) => agent.id === "debugger")).toBe(true);

  const usage = await handler(new Request(`http://local/v1/usage?workspace=${workspace}`));
  expect(usage.status).toBe(200);
  expect(await usage.json()).toMatchObject({
    totals: { turns: expect.any(Number), toolCalls: expect.any(Number) },
    days: expect.any(Array),
    providers: expect.any(Array),
  });
  const usageBody: any = await (await handler(new Request(`http://local/v1/usage?workspace=${workspace}`))).json();
  for (const provider of usageBody.providers) expect(provider.pricedTurns + provider.unpricedTurns).toBe(provider.turns);
});

test("model selection rejects unknown registry entries", async () => {
  const response = await createApiHandler()(new Request("http://local/v1/models/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "definitely-not-registered", lane: "cloud", provider: "openai" }),
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "bad_request" } });
});

test("resource authoring creates workspace resources and rejects collisions", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "switchbay-builder-"));
  try {
    const request = () => new Request("http://local/v1/resources", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace, kind: "agent", name: "Release Captain", description: "Coordinates safe releases", instructions: "Inspect the release state first." }),
    });
    const created = await createApiHandler()(request());
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ resource: { kind: "agent", id: "release-captain", name: "Release Captain" } });
    const collision = await createApiHandler()(request());
    expect(collision.status).toBe(400);
    expect(await collision.json()).toMatchObject({ error: { code: "resource_exists" } });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("skill bridge previews foreign Markdown without writing it", async () => {
  const response = await createApiHandler()(new Request("http://local/v1/skills/bridge/preview", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: process.cwd(), provider: "gemini", mode: "convert", filename: "GEMINI.md", content: "# Research Helper\n\nUse cited sources.\n" }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ skill: { id: "research-helper", provider: "gemini", mode: "convert" } });
});
