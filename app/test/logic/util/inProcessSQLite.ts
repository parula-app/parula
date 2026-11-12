import type { Query, Database } from "../../../../lib/rs-sqlite";
// Using Node's built-in SQLite in-process, instead of the backend's via JPC
import { DatabaseSync } from "node:sqlite";

/** In-process implementation of the rs-sqlite `Database` interface,
 * as returned by `appGlobal.remoteApp.getSQLiteDatabase()`, for tests.
 * Usage:
 * ```ts
 * appGlobal.remoteApp = {
 *   getSQLiteDatabase: (filename: string) =>
 *     new InProcessSQLiteDatabase(path.join(tempDir, filename)),
 * };
 * ``` */
export class InProcessSQLiteDatabase {
  db: DatabaseSync;

  constructor(filepath: string) {
    this.db = new DatabaseSync(filepath);
  }

  protected source(query: Query): string {
    return query.sourceParts.join("?");
  }

  protected parameters(query: Query): any[] {
    // JPC serializes undefined as null. node:sqlite rejects undefined.
    return query.parameters.map(p => p === undefined ? null : p);
  }

  async migrate(...migrations: (Query | ((database: Database) => void | Promise<void>))[]): Promise<this> {
    // Like @radically-straightforward/sqlite, so that a migration sees the same
    // database: its `ON DELETE CASCADE`s do not run.
    this.pragma("foreign_keys = false");
    try {
      // Always starts on a fresh test database, so no versioning needed
      for (let migration of migrations) {
        if (typeof (migration) == "function") {
          await migration(this as any as Database);
        } else {
          this.db.exec(this.source(migration));
        }
      }
    } finally {
      this.pragma("foreign_keys = true");
    }
    return this;
  }

  execute(query: Query): this {
    // `exec()` takes no parameters, so quote them into the source,
    // like @radically-straightforward/sqlite does
    let parameters = this.parameters(query);
    let source = query.sourceParts[0];
    for (let i = 0; i < parameters.length; i++) {
      let quoted = this.db.prepare("SELECT quote(?) AS quoted").get(parameters[i]) as any;
      source += quoted.quoted + query.sourceParts[i + 1];
    }
    this.db.exec(source);
    return this;
  }

  run(query: Query): any {
    return this.db.prepare(this.source(query)).run(...this.parameters(query));
  }

  /** Like the backend: one call, but each statement with its bound parameters */
  runMultiple(queries: Query[]): void {
    for (let query of queries) {
      this.db.prepare(this.source(query)).run(...this.parameters(query));
    }
  }

  get<Type>(query: Query): Type | undefined {
    return this.db.prepare(this.source(query)).get(...this.parameters(query)) as Type | undefined;
  }

  all<Type>(query: Query): Type[] {
    return this.db.prepare(this.source(query)).all(...this.parameters(query)) as Type[];
  }

  pragma<Type>(source: string): Type {
    return this.db.prepare("PRAGMA " + source).all() as Type;
  }

  close() {
    this.db.close();
  }
}
