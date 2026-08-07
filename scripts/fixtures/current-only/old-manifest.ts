const PLUGIN_API_VERSION = "3" as const;

export function acceptOldManifest(manifest: { apiVersion: string }) {
  if (manifest.apiVersion !== PLUGIN_API_VERSION) return { ...manifest, apiVersion: PLUGIN_API_VERSION };
  return manifest;
}
