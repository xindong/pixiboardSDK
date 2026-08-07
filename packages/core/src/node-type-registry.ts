import {
  MigrationError,
  NodeTypeNotRegisteredError,
  NodeValidationError,
} from "./errors";
import { assertJsonValue, cloneValue, deepFreeze } from "./json";
import type {
  BoardNode,
  JsonValue,
  NodeTypeDefinition,
  WorldBounds,
} from "./types";

export type RegisterNodeTypeOptions = {
  replace?: boolean;
};

export type NodeTypeRegistryOptions = {
  development?: boolean;
};

type RegisteredDefinition = NodeTypeDefinition<JsonValue>;

export class NodeTypeRegistry {
  private readonly definitions = new Map<string, RegisteredDefinition>();
  private readonly development: boolean;

  constructor(options: NodeTypeRegistryOptions = {}) {
    this.development = options.development ?? false;
  }

  register<Props extends JsonValue>(
    definition: NodeTypeDefinition<Props>,
    options: RegisterNodeTypeOptions = {},
  ): () => void {
    assertDefinition(definition);
    const registered = freezeDefinition(definition);
    const existing = this.definitions.get(registered.type);
    if (existing && !options.replace) {
      throw new NodeValidationError(`Node type is already registered: ${registered.type}`);
    }
    if (existing && options.replace && !this.development) {
      throw new NodeValidationError(
        `Replacing node type definitions is only allowed in development: ${registered.type}`,
      );
    }

    this.definitions.set(registered.type, registered);
    return () => {
      if (this.definitions.get(registered.type) === registered) {
        this.definitions.delete(registered.type);
      }
    };
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  get<Props extends JsonValue = JsonValue>(type: string): NodeTypeDefinition<Props> | undefined {
    return this.definitions.get(type) as NodeTypeDefinition<Props> | undefined;
  }

  require<Props extends JsonValue = JsonValue>(type: string): NodeTypeDefinition<Props> {
    const definition = this.get<Props>(type);
    if (!definition) throw new NodeTypeNotRegisteredError(type);
    return definition;
  }

  list(): ReadonlyArray<NodeTypeDefinition<JsonValue>> {
    return [...this.definitions.values()];
  }

  createProps<Props extends JsonValue>(
    type: string,
    props: Props | undefined,
  ): { typeVersion: number; props: Props } {
    const definition = this.require<Props>(type);
    const input = mergeDefaults(definition.defaults, props);
    return {
      typeVersion: definition.version,
      props: this.runValidation(definition, input),
    };
  }

  validateNode<Props extends JsonValue>(
    node: BoardNode<Props>,
    options: { migrate?: boolean } = {},
  ): BoardNode<Props> {
    const definition = this.get<Props>(node.type);
    if (!definition) return cloneValue(node);

    let version = node.typeVersion;
    let props: unknown = cloneValue(node.props);
    if (version !== definition.version) {
      if (version > definition.version) {
        throw new MigrationError(
          `Node ${node.id} uses future ${node.type} version ${version}; registered version is ${definition.version}`,
        );
      }
      if (!options.migrate || !definition.migrate) {
        throw new MigrationError(
          `Node ${node.id} requires ${node.type} migration from version ${version} to ${definition.version}`,
        );
      }

      let attempts = 0;
      while (version < definition.version) {
        const result = runMigration(definition, node.id, version, props);
        if (!Number.isInteger(result.version) || result.version <= version) {
          throw new MigrationError(
            `Node ${node.id} migration must advance beyond version ${version}`,
          );
        }
        version = result.version;
        props = result.props;
        attempts += 1;
        if (attempts > 100 || version > definition.version) {
          throw new MigrationError(
            `Node ${node.id} migration did not resolve to registered version ${definition.version}`,
          );
        }
      }
    }

    return {
      ...cloneValue(node),
      typeVersion: version,
      props: this.runValidation(definition, props),
    };
  }

  getBounds<Props extends JsonValue>(node: BoardNode<Props>): WorldBounds {
    const definition = this.require<Props>(node.type);
    return definition.getBounds(cloneValue(node));
  }

  private runValidation<Props extends JsonValue>(
    definition: NodeTypeDefinition<Props>,
    value: unknown,
  ): Props {
    try {
      const validated = definition.validate(cloneValue(value));
      assertJsonValue(validated, `${definition.type}.props`);
      return cloneValue(validated);
    } catch (cause) {
      throw new NodeValidationError(`Invalid props for node type ${definition.type}`, {
        nodeType: definition.type,
        cause,
      });
    }
  }
}

function assertDefinition<Props extends JsonValue>(definition: NodeTypeDefinition<Props>): void {
  if (!definition.type.trim()) {
    throw new NodeValidationError("Node type must be a non-empty string");
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new NodeValidationError(`Node type ${definition.type} must have a positive version`);
  }
  if (typeof definition.validate !== "function" || typeof definition.getBounds !== "function") {
    throw new NodeValidationError(
      `Node type ${definition.type} must define validate() and getBounds()`,
    );
  }
  if (definition.defaults !== undefined) {
    assertJsonValue(definition.defaults, `${definition.type}.defaults`);
  }
}

function freezeDefinition<Props extends JsonValue>(
  definition: NodeTypeDefinition<Props>,
): RegisteredDefinition {
  const registered = {
    ...definition,
    ...(definition.defaults === undefined
      ? {}
      : { defaults: deepFreeze(cloneValue(definition.defaults)) }),
    ...(definition.resize === undefined
      ? {}
      : { resize: Object.freeze({ ...definition.resize }) }),
  };
  return Object.freeze(registered) as RegisteredDefinition;
}

function mergeDefaults<Props extends JsonValue>(
  defaults: Partial<Props> | undefined,
  props: Props | undefined,
): unknown {
  if (isPlainObject(defaults) || isPlainObject(props)) {
    return {
      ...(isPlainObject(defaults)
        ? cloneValue(defaults as Record<string, JsonValue>)
        : {}),
      ...(isPlainObject(props)
        ? cloneValue(props as Record<string, JsonValue>)
        : {}),
    };
  }
  return props ?? defaults ?? null;
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runMigration<Props extends JsonValue>(
  definition: NodeTypeDefinition<Props>,
  nodeId: string,
  fromVersion: number,
  props: unknown,
): { version: number; props: Props } {
  try {
    return definition.migrate!({ fromVersion, props: cloneValue(props) });
  } catch (cause) {
    throw new MigrationError(
      `Failed to migrate node ${nodeId} (${definition.type}) from version ${fromVersion}`,
      { cause },
    );
  }
}
