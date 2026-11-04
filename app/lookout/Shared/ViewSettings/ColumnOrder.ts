export class ColumnOrder<T> {
  columns: T[];
  readonly allColumns: readonly T[];
  readonly requiredColumn: T | null;

  constructor(columns: readonly T[], allColumns: readonly T[], requiredColumn: T | null = null) {
    this.allColumns = allColumns;
    this.requiredColumn = requiredColumn;
    this.columns = columns.filter((column, i) => allColumns.includes(column) && columns.indexOf(column) == i);
    if (requiredColumn != null && !this.columns.includes(requiredColumn)) {
      this.columns.unshift(requiredColumn);
    }
  }

  available(from: readonly T[] = this.allColumns): T[] {
    return from.filter(column => this.allColumns.includes(column) && !this.columns.includes(column));
  }

  add(column: T, after: T | null = null) {
    if (column == null || this.columns.includes(column) || !this.allColumns.includes(column)) {
      return;
    }
    let pos = after != null && this.columns.includes(after) ? this.columns.indexOf(after) + 1 : this.columns.length;
    this.columns = [ ...this.columns.slice(0, pos), column, ...this.columns.slice(pos) ];
  }

  canRemove(column: T): boolean {
    return column != null && column != this.requiredColumn && this.columns.includes(column);
  }

  remove(column: T) {
    if (this.canRemove(column)) {
      this.columns = this.columns.filter(shown => shown != column);
    }
  }

  canMove(column: T, offset: number): boolean {
    let pos = this.columns.indexOf(column);
    return pos >= 0 && pos + offset >= 0 && pos + offset < this.columns.length;
  }

  move(column: T, offset: number) {
    if (!this.canMove(column, offset)) {
      return;
    }
    let columns = this.columns.filter(shown => shown != column);
    columns.splice(this.columns.indexOf(column) + offset, 0, column);
    this.columns = columns;
  }

  moveBefore(column: T, before: T | null) {
    if (!this.columns.includes(column) || column == before) {
      return;
    }
    let columns = this.columns.filter(shown => shown != column);
    let pos = before != null && columns.includes(before) ? columns.indexOf(before) : columns.length;
    columns.splice(pos, 0, column);
    this.columns = columns;
  }
}
