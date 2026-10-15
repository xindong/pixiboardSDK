import type { AssetVariant } from "./types";

/** Named variants or a content-addressed preview with a lowercase SHA-256 digest. */
export function isAssetVariant(value: unknown): value is AssetVariant {
  return value === "original" || value === "preview" || value === "waveform" ||
    (typeof value === "string" && value.length === 72 && /^preview-[a-f0-9]{64}$/.test(value));
}
