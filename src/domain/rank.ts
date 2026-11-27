import type { ModelRecord, ModelStatus } from "../schema/models.js";

export const MODIFIER_TOKENS = new Set([
  "pro",
  "max",
  "ultra",
  "mini",
  "nano",
  "lite",
  "flash",
  "preview",
  "latest",
  "exp",
  "experimental",
  "highspeed",
  "codex",
  "chat",
  "turbo",
  "thinking",
  "search",
  "audio",
  "image",
  "live",
  "realtime",
  "tts",
  "plus",
  "flashx",
  "air",
  "airx",
  "beta",
  "reasoning",
  "instruct",
  "omni",
  "vl",
]);

export const FLAGSHIP_MODEL_REGEX =
  /^(?:gemini-\d|claude-(?:opus|sonnet|haiku|fable|mythos)|gpt-\d|o[134]|codex-|chatgpt-|deepseek-(?:v\d|r\d|flash)|kimi-k\d|grok-\d|glm-\d|qwen(?:\d|-(?:max|plus|flash|turbo|coder))|qwq-)/i;

const VARIANT_TOKENS = new Set([
  "preview",
  "exp",
  "experimental",
  "speciale",
  "highspeed",
  "customtools",
  "healthcare",
  "law",
  "search",
  "beta",
  "latest",
  "legal",
]);

const AUXILIARY_TOKENS = new Set([
  "embedding",
  "tts",
  "transcribe",
  "whisper",
  "realtime",
  "live",
  "audio",
  "image",
  "imagen",
  "veo",
  "lyria",
  "robotics",
  "translate",
  "imagine",
  "voice",
  "asr",
  "ocr",
  "rerank",
]);

export interface ModelShape {
  lineageSegments: string[];
  generation: number[];
  tierRank: number;
  variantRank: 0 | 1 | 2;
  isSnapshot: boolean;
  isAuxiliary: boolean;
  segmentCount: number;
}

export function parseModelShape(canonicalId: string): ModelShape {
  const segments = canonicalId.toLowerCase().split("-").filter(Boolean);
  const core = [...segments];
  let isSnapshot = false;

  // Strip trailing date and build suffixes in linear time before parsing generation tuples
  while (core.length > 1) {
    const len = core.length;
    if (
      len >= 4 &&
      /^20\d{2}$/.test(core[len - 3]) &&
      /^(?:0[1-9]|1[0-2])$/.test(core[len - 2]) &&
      /^(?:0[1-9]|[12]\d|3[01])$/.test(core[len - 1])
    ) {
      core.splice(len - 3, 3);
      isSnapshot = true;
      continue;
    }
    if (len >= 3 && /^(?:0[1-9]|1[0-2])$/.test(core[len - 2]) && /^20\d{2}$/.test(core[len - 1])) {
      core.splice(len - 2, 2);
      isSnapshot = true;
      continue;
    }
    const last = core[len - 1];
    if (
      /^20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(last) ||
      /^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(last) ||
      /^\d{3}$/.test(last)
    ) {
      core.pop();
      isSnapshot = true;
      continue;
    }
    break;
  }

  // Strip mid-ID MMDD snapshot segments (e.g., grok-4.20-0309-reasoning, glm-4-32b-0414-128k)
  if (core.length > 1) {
    const filteredCore: string[] = [core[0]];
    for (let i = 1; i < core.length; i += 1) {
      if (/^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(core[i])) {
        isSnapshot = true;
      } else {
        filteredCore.push(core[i]);
      }
    }
    core.splice(0, core.length, ...filteredCore);
  }

  const generation: number[] = [];
  const lineageSegments: string[] = [];
  let parsedGen = false;

  for (let i = 0; i < core.length; i += 1) {
    const seg = core[i];
    if (i === 0) {
      const attached = /^(qwen|qwq)(\d+(?:\.\d+)*)$/.exec(seg);
      if (attached) {
        lineageSegments.push(attached[1]);
        for (const part of attached[2].split(".")) {
          generation.push(Number.parseInt(part, 10));
        }
        parsedGen = true;
        continue;
      }
    }
    if (!parsedGen && /^(?:[vrko]?\d+(?:\.\d+)*|\d+(?:\.\d+)*[ov])$/.test(seg)) {
      parsedGen = true;
      const numericPart = seg.replace(/^[vrko]/, "").replace(/[ov]$/, "");
      for (const part of numericPart.split(".")) {
        generation.push(Number.parseInt(part, 10));
      }
      while (i + 1 < core.length && /^\d{1,2}$/.test(core[i + 1])) {
        i += 1;
        generation.push(Number.parseInt(core[i], 10));
      }
      continue;
    }
    lineageSegments.push(seg);
  }

  const coreSet = new Set(core);

  let tierRank = 1;
  if (core[0] === "claude") {
    if (coreSet.has("fable") || coreSet.has("mythos") || coreSet.has("opus")) {
      tierRank = 0;
    } else if (coreSet.has("sonnet")) {
      tierRank = 1;
    } else if (coreSet.has("haiku")) {
      tierRank = 2;
    }
  } else if (core[0]?.startsWith("qwen") || core[0] === "qwq") {
    if (coreSet.has("lite") || coreSet.has("mini") || coreSet.has("nano")) {
      tierRank = 3;
    } else if (coreSet.has("flash") || coreSet.has("turbo")) {
      tierRank = 2;
    } else if (coreSet.has("plus")) {
      tierRank = 1;
    } else if (coreSet.has("max") || coreSet.has("pro") || coreSet.has("ultra")) {
      tierRank = 0;
    }
  } else if (
    coreSet.has("lite") ||
    coreSet.has("mini") ||
    coreSet.has("nano") ||
    coreSet.has("air") ||
    coreSet.has("airx")
  ) {
    tierRank = 3;
  } else if (coreSet.has("flash") || coreSet.has("flashx") || coreSet.has("turbo")) {
    tierRank = 2;
  } else if (coreSet.has("pro") || coreSet.has("max") || coreSet.has("ultra")) {
    tierRank = 0;
  } else if (coreSet.has("plus")) {
    tierRank = 1;
  }

  let variantRank: 0 | 1 | 2 = 0;
  if (isSnapshot) {
    variantRank = 2;
  } else if (core.some((seg) => VARIANT_TOKENS.has(seg))) {
    variantRank = 1;
  }

  const isAuxiliary = core.some((seg) => AUXILIARY_TOKENS.has(seg));

  return {
    lineageSegments,
    generation,
    tierRank,
    variantRank,
    isSnapshot,
    isAuxiliary,
    segmentCount: segments.length,
  };
}

export interface RankableModelEntry {
  model: ModelRecord;
  effectiveStatus: ModelStatus;
}

export function compareModelsForListing(a: RankableModelEntry, b: RankableModelEntry): number {
  const aActive = a.effectiveStatus === "active" ? 0 : 1;
  const bActive = b.effectiveStatus === "active" ? 0 : 1;
  if (aActive !== bActive) return aActive - bActive;

  const aVerified = a.model.source_origin === "live_verified" ? 0 : 1;
  const bVerified = b.model.source_origin === "live_verified" ? 0 : 1;
  if (aVerified !== bVerified) return aVerified - bVerified;

  const aLiteLlmOnly = a.model.official_url.includes("BerriAI/litellm") ? 1 : 0;
  const bLiteLlmOnly = b.model.official_url.includes("BerriAI/litellm") ? 1 : 0;
  if (aLiteLlmOnly !== bLiteLlmOnly) return aLiteLlmOnly - bLiteLlmOnly;

  const aFlagship = FLAGSHIP_MODEL_REGEX.test(a.model.canonical_id) ? 0 : 1;
  const bFlagship = FLAGSHIP_MODEL_REGEX.test(b.model.canonical_id) ? 0 : 1;
  if (aFlagship !== bFlagship) return aFlagship - bFlagship;

  const aShape = parseModelShape(a.model.canonical_id);
  const bShape = parseModelShape(b.model.canonical_id);

  const aAux = aShape.isAuxiliary ? 1 : 0;
  const bAux = bShape.isAuxiliary ? 1 : 0;
  if (aAux !== bAux) return aAux - bAux;

  if (aShape.variantRank !== bShape.variantRank) {
    return aShape.variantRank - bShape.variantRank;
  }

  const aHasGen = aShape.generation.length > 0 ? 0 : 1;
  const bHasGen = bShape.generation.length > 0 ? 0 : 1;
  if (aHasGen !== bHasGen) return aHasGen - bHasGen;

  const maxGenLen = Math.max(aShape.generation.length, bShape.generation.length);
  for (let i = 0; i < maxGenLen; i += 1) {
    const diff = (bShape.generation[i] ?? 0) - (aShape.generation[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (aShape.tierRank !== bShape.tierRank) {
    return aShape.tierRank - bShape.tierRank;
  }

  if (aShape.segmentCount !== bShape.segmentCount) {
    return aShape.segmentCount - bShape.segmentCount;
  }

  return a.model.canonical_id.localeCompare(b.model.canonical_id, "en", { numeric: true });
}
