const SUPPORTED_COUNTS = new Set([1_000, 10_000, 50_000, 100_000]);
const CARD_WIDTH = 320;
const CARD_HEIGHT = 180;
const WORLD_SIZE = 1_000_000;

function createPrng(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function assertCount(count) {
  if (!SUPPORTED_COUNTS.has(count)) {
    throw new RangeError(`synthetic-card count must be one of: ${[...SUPPORTED_COUNTS].join(", ")}`);
  }
}

/**
 * Generate a deterministic sparse-card dataset. This is data generation only;
 * it has no renderer or browser dependency.
 */
export function generateSyntheticCards({ count, seed = 42, sharedAssetCount = 8 } = {}) {
  assertCount(count);
  if (!Number.isInteger(sharedAssetCount) || sharedAssetCount < 1) {
    throw new RangeError("sharedAssetCount must be a positive integer");
  }

  const random = createPrng(seed);
  const sharedAssets = Array.from({ length: sharedAssetCount }, (_, index) => ({
    id: `synthetic-image-${index + 1}`,
    kind: "image",
    width: 512,
    height: 512,
  }));
  const nodes = new Array(count);

  for (let index = 0; index < count; index += 1) {
    nodes[index] = {
      id: `card-${String(index + 1).padStart(6, "0")}`,
      type: "card",
      x: Math.round(random() * WORLD_SIZE),
      y: Math.round(random() * WORLD_SIZE),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      zIndex: index,
      assetId: sharedAssets[index % sharedAssets.length].id,
      data: {
        title: `Synthetic card ${index + 1}`,
        body: "Deterministic benchmark fixture; not a production document.",
        tags: [`bucket-${index % 16}`],
      },
    };
  }

  return {
    name: "synthetic-card",
    count,
    seed,
    nodes,
    sharedAssets,
    metadata: {
      sparse: true,
      cardSize: [CARD_WIDTH, CARD_HEIGHT],
      worldBounds: [0, 0, WORLD_SIZE, WORLD_SIZE],
    },
  };
}

export { SUPPORTED_COUNTS, CARD_WIDTH, CARD_HEIGHT };
