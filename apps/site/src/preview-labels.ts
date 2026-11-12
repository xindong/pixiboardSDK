import { previewStatusLabel, type PreviewNode } from "@pixi-board/core";

/** Host-side format knowledge: an archive without a model is shown as ZIP, not as 3D. */
export function previewTypeLabelFor(node: Pick<PreviewNode, "type" | "name" | "props">, typeLabel: string): string {
  const props = (typeof node.props === "object" && node.props !== null ? node.props : {}) as Record<string, unknown>;
  const name = typeof props.name === "string" ? props.name : node.name ?? "";
  const isZip = (typeof props.fileExtension === "string" && props.fileExtension.toLowerCase() === "zip") || /\.zip$/i.test(name);
  if (isZip && (node.type !== "model" ||
    (typeof props.previewError === "string" && /ZIP_NO_MODEL/.test(props.previewError)))) {
    typeLabel = "ZIP";
  }
  return previewStatusLabel(node, typeLabel);
}
