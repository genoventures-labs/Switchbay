export const DEFAULTS = {
  // Use the explicit fast default here so ORI Code doesn't depend on a
  // server-side alias that may lag behind Oracle routing changes.
  model: "gpt-5-mini",
  surface: "dev",
  profile: "ori_code",
  mode: "build",
  apiBase: "https://glm.thynaptic.com/v1",
  wsBase: "wss://glm.thynaptic.com/v1/stream",
} as const;

export type DefaultSurface = typeof DEFAULTS.surface;
export type DefaultProfile = typeof DEFAULTS.profile;
