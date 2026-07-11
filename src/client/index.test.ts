import { expect, test } from "bun:test";
import { Switchbay, SwitchbayError } from "./index";

test("client merges PageTend defaults into turns", async () => {
  let received: any;
  const bay = new Switchbay({
    token: "secret",
    clientId: "pagetend",
    workspace: "/tmp/PageTend",
    fetch: async (_url, init) => {
      received = { headers: init?.headers, body: JSON.parse(String(init?.body)) };
      return Response.json({ sessionId: "one", content: "ok" });
    },
  });
  await bay.turn({ input: "hello" });
  expect(received.body).toMatchObject({ input: "hello", clientId: "pagetend", workspace: "/tmp/PageTend" });
  expect(received.headers.authorization).toBe("Bearer secret");
});

test("client throws structured Switchbay errors", async () => {
  const bay = new Switchbay({ fetch: async () => Response.json({ error: { message: "nope", code: "denied" } }, { status: 403 }) });
  try { await bay.health(); throw new Error("expected failure"); }
  catch (error) { expect(error).toBeInstanceOf(SwitchbayError); expect((error as SwitchbayError).code).toBe("denied"); }
});
