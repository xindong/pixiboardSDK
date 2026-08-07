export function normalizeDocument(input: Record<string, unknown>, sourceVersion: number) {
  if (sourceVersion < 3) return { ...input, schemaVersion: 3 };
  return input;
}
