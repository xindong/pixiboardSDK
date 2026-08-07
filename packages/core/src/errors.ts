export class PixiBoardCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NodeNotFoundError extends PixiBoardCoreError {
  constructor(nodeId: string) {
    super(`Node not found: ${nodeId}`);
  }
}

export class NodeTypeNotRegisteredError extends PixiBoardCoreError {
  constructor(type: string) {
    super(`Node type is not registered: ${type}`);
  }
}

export class NodeValidationError extends PixiBoardCoreError {
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: { nodeId?: string; nodeType?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.nodeId = options.nodeId;
    this.nodeType = options.nodeType;
    this.cause = options.cause;
  }
}

export class DocumentValidationError extends PixiBoardCoreError {
  readonly cause?: unknown;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.cause = options.cause;
  }
}

export class TransactionConflictError extends PixiBoardCoreError {}
