/**
 * Parses CSV (RFC 4180): Fields are separated by commas, rows by line breaks.
 * A field in double quotes may contain commas, line breaks, and "" for a double quote.
 * @returns the rows, each with its fields
 */
export function parseCSV(csv: string): string[][] {
  let rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let isQuoted = false;
  for (let i = 0; i < csv.length; i++) {
    let char = csv[i];
    if (isQuoted) {
      if (char != '"') {
        field += char;
      } else if (csv[i + 1] == '"') {
        field += '"';
        i++;
      } else {
        isQuoted = false;
      }
    } else if (char == '"') {
      isQuoted = true;
    } else if (char == ",") {
      row.push(field);
      field = "";
    } else if (char == "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char != "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
