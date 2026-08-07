import { DocumentValidationError, MigrationError } from "./errors";
import { cloneValue } from "./json";

export type DocumentMigration = {
  from: number;
  to: number;
  migrate(document: unknown): unknown;
};

export class DocumentMigrationRegistry {
  private readonly migrations = new Map<number, DocumentMigration>();

  register(migration: DocumentMigration): () => void {
    if (
      !Number.isInteger(migration.from) ||
      !Number.isInteger(migration.to) ||
      migration.from < 0 ||
      migration.to <= migration.from
    ) {
      throw new DocumentValidationError("Document migration versions must move forward");
    }
    if (this.migrations.has(migration.from)) {
      throw new DocumentValidationError(
        `A document migration from schema ${migration.from} is already registered`,
      );
    }
    this.migrations.set(migration.from, migration);
    return () => {
      if (this.migrations.get(migration.from) === migration) {
        this.migrations.delete(migration.from);
      }
    };
  }

  migrate(document: unknown, targetVersion: number): unknown {
    let current = cloneValue(document);
    let version = readSchemaVersion(current);
    let attempts = 0;

    while (version < targetVersion) {
      const migration = this.migrations.get(version);
      if (!migration) {
        throw new MigrationError(
          `No document migration is registered from schema ${version} to ${targetVersion}`,
        );
      }
      try {
        current = migration.migrate(cloneValue(current));
      } catch (cause) {
        throw new MigrationError(`Failed to migrate document schema ${version}`, { cause });
      }
      const nextVersion = readSchemaVersion(current);
      if (nextVersion !== migration.to) {
        throw new MigrationError(
          `Document migration from ${version} must produce schema ${migration.to}`,
        );
      }
      version = nextVersion;
      attempts += 1;
      if (attempts > 100 || version > targetVersion) {
        throw new MigrationError(`Document migration overshot schema ${targetVersion}`);
      }
    }
    return current;
  }
}

function readSchemaVersion(document: unknown): number {
  if (
    document === null ||
    typeof document !== "object" ||
    !Number.isInteger((document as { schemaVersion?: unknown }).schemaVersion)
  ) {
    throw new DocumentValidationError("Document schemaVersion must be an integer");
  }
  return (document as { schemaVersion: number }).schemaVersion;
}
