const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const geometry = obj({ x: { type: "number" }, y: { type: "number" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" }, zIndex: { type: "number" } });
const jsonValue = {};
const source = { oneOf: [
  obj({ type: { const: "content" }, content: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" }, relativePath: { type: "string" }, rootPath: { type: "string" }, baseUrl: { type: "string" } }, ["type", "content"]),
  obj({ type: { const: "file" }, path: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" }, relativePath: { type: "string" }, rootPath: { type: "string" }, baseUrl: { type: "string" } }, ["type", "path"]),
  obj({ type: { const: "url" }, url: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" }, relativePath: { type: "string" }, baseUrl: { type: "string" } }, ["type", "url"]),
] };
const importFields = {
  content: { type: "string" }, path: { type: "string" }, source,
  fileName: { type: "string" }, mimeType: { type: "string" }, relativePath: { type: "string" },
  rootPath: { type: "string" }, baseUrl: { type: "string" },
  fit: { enum: ["contain", "cover", "stretch"] },
};
const nodeCreate = obj({ id: { type: "string" }, type: { type: "string" }, name: { type: "string" }, ...importFields, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, rotation: { type: "number" }, zIndex: { type: "number" }, locked: { type: "boolean" }, visible: { type: "boolean" }, props: jsonValue }, ["type"]);
const nodeUpdate = obj({ id: { type: "string" }, name: { type: "string" }, ...importFields, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, rotation: { type: "number" }, zIndex: { type: "number" }, locked: { type: "boolean" }, visible: { type: "boolean" }, props: jsonValue }, ["id"]);
export const canvasReadSchema = { oneOf: [obj({ type: { const: "nodes" }, ids: { type: "array", items: { type: "string" } }, types: { type: "array", items: { type: "string" } }, fields: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "string" } }, ["type"]), obj({ type: { const: "assets" }, ids: { type: "array", items: { type: "string" } }, kinds: { type: "array", items: { type: "string" } }, fields: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "string" } }, ["type"]), obj({ type: { const: "preview" }, id: { type: "string" }, maxWidth: { type: "number" }, maxHeight: { type: "number" }, frameNumber: { type: "number" }, fps: { type: "number" } }, ["type", "id"]) ] };
export const canvasWriteSchema = { oneOf: [obj({ type: { const: "create" }, nodes: { type: "array", minItems: 1, items: nodeCreate } }, ["type", "nodes"]), obj({ type: { const: "update" }, nodes: { type: "array", minItems: 1, items: nodeUpdate } }, ["type", "nodes"]), obj({ type: { const: "delete" }, nodeIds: { type: "array", minItems: 1, items: { type: "string" } } }, ["type", "nodeIds"]) ] };
