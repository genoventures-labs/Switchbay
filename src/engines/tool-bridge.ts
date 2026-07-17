/**
 * Engine-to-provider tool bridge.
 *
 * Converts every registered EngineTool into a first-class ToolDefinition so
 * all model providers (OpenAI, Anthropic, Gemini, Apple FM, …) can call engine
 * tools natively — no separate wrapper, no two-step run_engine_tool required.
 *
 * Every time an engine is added to the registry its tools automatically become
 * available to every provider. The flow:
 *
 *   Engine manifest → engineToolToDefinition → filteredTools in executeTurn
 *   Model calls tool directly → executeToolCall fallback → executeEngineTool
 */

import type { ToolDefinition } from "../runtime/types";
import type { EngineManifest, EngineTool, EngineRegistry } from "./registry";

// ──────────────────────────────────────────────────────────────────────────────
// Conversion
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Convert a single EngineTool into a provider-agnostic ToolDefinition.
 * The engine name is prepended to the description so models know the origin.
 */
export function engineToolToDefinition(
  engine: EngineManifest,
  tool: EngineTool,
): ToolDefinition {
  const properties: Record<string, unknown> = {};

  for (const [paramName, param] of Object.entries(tool.parameters ?? {})) {
    const raw = param as Record<string, unknown>;
    const prop: Record<string, unknown> = {
      type: raw.type ?? "string",
      description: raw.description ?? "",
    };
    if (raw.default !== undefined) prop.default = raw.default;
    if (Array.isArray(raw.enum)) prop.enum = raw.enum;
    properties[paramName] = prop;
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: `[${engine.name}] ${tool.description}`,
      parameters: {
        type: "object",
        properties,
        required: tool.required ?? [],
      },
    },
  };
}

/**
 * Expand every tool in every engine of a registry into ToolDefinitions.
 * Skips duplicates — first engine with a given tool name wins (matches
 * loadEngineRegistry priority: workspace > engine bay > plugins).
 */
export function engineRegistryToToolDefinitions(
  registry: EngineRegistry,
  options: { exclude?: Set<string> } = {},
): ToolDefinition[] {
  const seen = new Set(options.exclude ?? []);
  const defs: ToolDefinition[] = [];

  for (const engine of registry.engines) {
    for (const tool of engine.tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      defs.push(engineToolToDefinition(engine, tool));
    }
  }

  return defs;
}

// ──────────────────────────────────────────────────────────────────────────────
// Lookup
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Find the engine and tool that owns a given tool name.
 * Returns null if no engine in the registry exposes that tool.
 */
export function findEngineForTool(
  toolName: string,
  registry: EngineRegistry,
): { engine: EngineManifest; tool: EngineTool } | null {
  for (const engine of registry.engines) {
    const tool = engine.tools.find(t => t.name === toolName);
    if (tool) return { engine, tool };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Name set helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Return the set of all engine tool names currently in the registry.
 * Used in loop.ts to decide whether an unknown tool call should be
 * dispatched to the engine bridge.
 */
export function engineToolNameSet(registry: EngineRegistry): Set<string> {
  const names = new Set<string>();
  for (const engine of registry.engines) {
    for (const tool of engine.tools) {
      names.add(tool.name);
    }
  }
  return names;
}
