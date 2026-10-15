import { isAssetVariant } from "@pixi-board/core";
import type { AssetBinaryVariant } from "./types";

export function assertAssetVariant(value: unknown): asserts value is AssetBinaryVariant {
  if (!isAssetVariant(value)) throw new TypeError("Invalid asset binary variant");
}
