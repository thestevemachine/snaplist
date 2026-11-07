import { AI_MODELS } from "./ai-catalog";
export const RESELLER_MODELS = [
  ...AI_MODELS.map((m) => ({ id: m.id, name: m.name, provider: m.provider })),
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
];
export const RESELLER_PROVIDER_LABELS: Record<string, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
};
