import { expect, test } from "bun:test";
import { createApiHandler } from "./server";
import { SWITCHBAY_VERSION } from "../version";

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
