/*
MIT License

Copyright (c) 2023 Leandro Facchinetti license@leafac.com (https://leafac.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/** This only has the sql`` template string function,
 * and exports the type `Database`.
 * All actual functions, which use better-sqlite3, are removed. */
import type BetterSQLite3Database from "better-sqlite3";

export interface Database {
  migrate(
    ...migrations: (Query | ((database: this) => void | Promise<void>))[]
  ): Promise<this>;

  /**
   * Execute DDL statements, for example, `CREATE TABLE`, `DROP INDEX`, and so forth. Multiple statements may be included in the same query.
   */
  execute(query: Query): this;

  /**
   * Run a DML statement, for example, `INSERT`, `UPDATE`, `DELETE`, and so forth.
   */
  run(query: Query): any;

  /**
   * Run several DML statements with one call to the backend, each with its bound parameters.
   * Not in `@radically-straightforward/sqlite`, but in our backend.
   */
  runMultiple(queries: Query[]): void;

  /**
   * Run a `SELECT` statement that returns a single result.
   *
   * > **Note:** If the `SELECT` statement returns multiple results, only the first result is returned, so it’s better to write statements that return a single result (for example, using `LIMIT`).
   *
   * > **Note:** You may also use `get()` to run an [`INSERT ... RETURNING ...` statement](https://www.sqlite.org/lang_returning.html), but you probably shouldn’t be using `RETURNING`, because it runs into issues in edge cases. Instead, you should use `run()`, get the `lastInsertRowid`, and perform a follow-up `SELECT`. See <https://github.com/WiseLibs/better-sqlite3/issues/654> and <https://github.com/WiseLibs/better-sqlite3/issues/657>.
   *
   * > **Note:** The `Type` parameter is [an assertion](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions). If you’d like to make sure that the values returned from the database are of a certain type, you must implement a runtime check instead. See <https://github.com/DefinitelyTyped/DefinitelyTyped/issues/50794>, <https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/62205>, and <https://github.com/DefinitelyTyped/DefinitelyTyped/pull/65035>. Note that the `get() as ___` pattern also works because by default `Type` is `unknown`.
   */
  get<Type>(query: Query): Type | undefined;

  /**
   * Run a `SELECT` statement that returns multiple results as an Array.
   *
   * > **Note:** We recommend including an explicit `ORDER BY` clause to specify the order of the results.
   *
   * > **Note:** If the results are big and you don’t want to load them all at once, then use `iterate()` instead.
   */
  all<Type>(query: Query): Type[];

  /**
   * Run a `SELECT` statement that returns multiple results as an iterator.
   *
   * > **Note:** If the results are small and you may load them all at once, then use `all()` instead.
   */
  iterate<Type>(query: Query): IterableIterator<Type>;

  /**
   * Run a `PRAGMA`. Similar to `better-sqlite3`’s `pragma()`, but includes the `Type` assertion similar to other methods.
   */
  pragma<Type>(
    source: string,
    options?: BetterSQLite3Database.PragmaOptions,
  ): Type;

  /**
   * Execute a function in a transaction. All the [caveats](https://github.com/WiseLibs/better-sqlite3/blob/bd55c76c1520c7796aa9d904fe65b3fb4fe7aac0/docs/api.md#caveats) about `better-sqlite3`’s transactions still apply. The type of transaction isn’t specified, so it defaults to `DEFERRED`.
   */
  executeTransaction<Type>(fn: () => Type): Type;

  /**
   * Execute a function in an `IMMEDIATE` transaction.
   */
  executeTransactionImmediate<Type>(fn: () => Type): Type;

  /**
   * Execute a function in an `EXCLUSIVE` transaction.
   */
  executeTransactionExclusive<Type>(fn: () => Type): Type;

  /**
   * An internal method that returns a `better-sqlite3` prepared statement for a given query. Normally you don’t have to use this, but it’s available for advanced use-cases in which you’d like to manipulate a prepared statement (for example, to set [`safeIntegers()`](https://github.com/WiseLibs/better-sqlite3/blob/bd55c76c1520c7796aa9d904fe65b3fb4fe7aac0/docs/integer.md#getting-bigints-from-the-database)).
   */
  getStatement(query: Query): BetterSQLite3Database.Statement;
}

/**
 * An auxiliary type that represents a database query. This is what’s generated by the `` sql`___` `` tagged template.
 */
export type Query = {
  sourceParts: string[];
  parameters: any[];
};

/**
 * A tagged template to generate a database query.
 *
 * Interpolation is turned into binding parameters to protect from SQL injection, for example:
 *
 * ```javascript
 * sql`INSERT INTO "users" ("name") VALUES (${"Leandro Facchinetti"})`;
 * ```
 *
 * Arrays and Sets may be interpolated for `IN` clauses, for example:
 *
 * ```javascript
 * sql`SELECT "id", "name" FROM "users" WHERE "name" IN ${[
 *   "Leandro Facchinetti",
 *   "David Adler",
 * ]}`;
 * ```
 *
 * You may use the pattern `$${___}` (note the two `$`) to interpolate a clause within a query, for example:
 *
 * ```javascript
 * sql`SELECT "id", "name" FROM "users" WHERE "name" = ${"Leandro Facchinetti"}$${sql` AND "age" = ${33}`}`;
 * ```
 *
 * > **Note:** This is useful, for example, to build queries for advanced search forms by conditionally including clauses for fields that have been filled in.
 *
 * **SQL Style Guide**
 *
 * - Include `"id" INTEGER PRIMARY KEY AUTOINCREMENT` in every table.
 * - Quote table and column names (for example, `"users"."name"`), to avoid conflicts with SQL reserved keywords and to help with syntax highlighting.
 * - Put `` sql`___` `` on its own line because of a glitch in the syntax highlighting.
 */
export default function sql(
  templateStrings: TemplateStringsArray,
  ...substitutions: any[]
): Query {
  const templateParts = [...templateStrings];
  const query: Query = { sourceParts: [], parameters: [] };
  for (
    let substitutionsIndex = 0;
    substitutionsIndex < substitutions.length;
    substitutionsIndex++
  ) {
    let templatePart = templateParts[substitutionsIndex];
    let substitution = substitutions[substitutionsIndex];
    if (substitution instanceof Set) substitution = [...substitution];
    if (templatePart.endsWith("$")) {
      templatePart = templatePart.slice(0, -1);
      if (
        !Array.isArray(substitution.sourceParts) ||
        substitution.sourceParts.length === 0 ||
        substitution.sourceParts.some(
          (sourcePart: any) => typeof sourcePart !== "string",
        ) ||
        !Array.isArray(substitution.parameters) ||
        substitution.sourceParts.length !== substitution.parameters.length + 1
      )
        throw new Error(
          `Failed to interpolate raw query ‘${substitution}’ because it wasn’t created with the sql\`___\` tagged template.`,
        );
      const substitutionQuery = substitution as Query;
      if (substitutionQuery.sourceParts.length === 1)
        templateParts[substitutionsIndex + 1] = `${templatePart}${
          substitutionQuery.sourceParts[0]
        }${templateParts[substitutionsIndex + 1]}`;
      else {
        query.sourceParts.push(
          `${templatePart}${substitutionQuery.sourceParts[0]}`,
          ...substitutionQuery.sourceParts.slice(1, -1),
        );
        templateParts[substitutionsIndex + 1] =
          `${substitutionQuery.sourceParts.at(-1)}${
            templateParts[substitutionsIndex + 1]
          }`;
        query.parameters.push(...substitutionQuery.parameters);
      }
    } else if (Array.isArray(substitution)) {
      if (substitution.length === 0)
        templateParts[substitutionsIndex + 1] = `${templatePart}()${
          templateParts[substitutionsIndex + 1]
        }`;
      else {
        query.sourceParts.push(
          `${templatePart}(`,
          ...new Array(substitution.length - 1).fill(","),
        );
        templateParts[substitutionsIndex + 1] = `)${
          templateParts[substitutionsIndex + 1]
        }`;
        query.parameters.push(...substitution);
      }
    } else {
      query.sourceParts.push(templatePart);
      query.parameters.push(substitution);
    }
  }
  query.sourceParts.push(templateParts.at(-1)!);
  return query;
}
