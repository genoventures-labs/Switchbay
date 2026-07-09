import type { ChatCompletionResponse } from "./types";

export function formatRouteTag(response: ChatCompletionResponse | null | undefined): string | null {
  const meta = response?.meta;
  if (!meta?.using) return null;
  const parts = [`Using: ${meta.using}`];
  if (meta.router_intent) parts.push(`intent=${meta.router_intent}`);
  if (meta.router_mode) parts.push(`mode=${meta.router_mode}`);
  return parts.join(" · ");
}
