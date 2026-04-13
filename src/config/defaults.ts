export const DEFAULTS = {
  model: "oricli-oracle",
  surface: "dev",
  profile: "ori_code",
  mode: "build",
  apiBase: "https://glm.thynaptic.com/v1",
  wsBase: "wss://glm.thynaptic.com/v1/stream",
} as const;

export type DefaultSurface = typeof DEFAULTS.surface;
export type DefaultProfile = typeof DEFAULTS.profile;
