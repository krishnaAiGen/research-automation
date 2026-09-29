/**
 * The models offered on the Email prompt page. Kept free of node imports so
 * the client page and the server routes can share one list.
 */
export type ModelChoice = {
  id: string;
  label: string;
  /** The tradeoff, in the terms that matter for a batch sender. */
  note: string;
};

export const MODEL_CHOICES: ModelChoice[] = [
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "NVIDIA Nemotron 3 Ultra (free)",
    note: "Free, but capped at 20 requests/minute and 50/day — 1,000/day once $10 of credits has ever been bought. One email is one request, so a few thousand addresses take days to weeks.",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    note: "Paid but very cheap (about $0.08 per million input tokens) with no daily cap, so a large batch is limited only by the delay between sends.",
  },
];

export const DEFAULT_MODEL = MODEL_CHOICES[0].id;

export function modelLabel(id: string): string {
  return MODEL_CHOICES.find((m) => m.id === id)?.label ?? id;
}

/**
 * How many research queries the model writes per email — what {{count}} in a
 * user prompt resolves to, and what fills {query 1}…{query N} in a template.
 * Fixed rather than configurable: the shipped templates have exactly this many
 * {query N} lines, and any other number either pays for queries the template
 * discards or leaves slot lines to be stripped out of the email.
 */
export const QUERIES_PER_EMAIL = 3;
