/**
 * Pure "which cell is next" arithmetic for a 2D score grid (ARAL Term Grades
 * and any future grid that adopts the same `data-grid-row`/`data-grid-col`
 * convention). Kept free of the DOM so it is unit-testable on its own; the
 * component resolves `{ row, col }` to an actual input and focuses it.
 *
 * `row`/`col` are 0-based indices into whatever is *rendered* right now — a
 * phone window that only shows five of twelve subjects has `cols` = 5, not
 * 12, so navigation never lands on a column that isn't on screen.
 */

export type GridPos = { row: number; col: number };
export type GridSize = { rows: number; cols: number };

/**
 * Returns the next position for a single keystroke, or `null` when the key
 * isn't a navigation key or the move would fall outside the grid — including
 * Enter on the last row and Shift+Enter on the first, which the caller must
 * treat as a no-op rather than letting the keystroke do anything else (e.g.
 * submit a form).
 *
 * | key                | shiftKey | at edge                         | result |
 * |--------------------|----------|----------------------------------|--------|
 * | Enter              | false    | last row (`row === rows - 1`)    | null   |
 * | Enter              | false    | otherwise                        | `{ row: row + 1, col }` |
 * | Enter              | true     | first row (`row === 0`)          | null   |
 * | Enter              | true     | otherwise                        | `{ row: row - 1, col }` |
 * | ArrowDown          | —        | last row                         | null   |
 * | ArrowDown          | —        | otherwise                        | `{ row: row + 1, col }` |
 * | ArrowUp            | —        | first row                        | null   |
 * | ArrowUp            | —        | otherwise                        | `{ row: row - 1, col }` |
 * | ArrowLeft          | —        | first col (`col === 0`)          | null   |
 * | ArrowLeft          | —        | otherwise                        | `{ row, col: col - 1 }` |
 * | ArrowRight         | —        | last col (`col === cols - 1`)    | null   |
 * | ArrowRight         | —        | otherwise                        | `{ row, col: col + 1 }` |
 * | anything else      | —        | —                                | null   |
 *
 * The caller is responsible for only invoking ArrowLeft/ArrowRight when the
 * caret sits at the start/end of the cell's value — this function has no
 * notion of caret position, and always returns a move for those keys.
 */
export function nextGridCell(
  key: string,
  shiftKey: boolean,
  pos: GridPos,
  size: GridSize
): GridPos | null {
  switch (key) {
    case "Enter": {
      const row = shiftKey ? pos.row - 1 : pos.row + 1;
      if (row < 0 || row >= size.rows) return null;
      return { row, col: pos.col };
    }
    case "ArrowDown": {
      const row = pos.row + 1;
      if (row >= size.rows) return null;
      return { row, col: pos.col };
    }
    case "ArrowUp": {
      const row = pos.row - 1;
      if (row < 0) return null;
      return { row, col: pos.col };
    }
    case "ArrowLeft": {
      const col = pos.col - 1;
      if (col < 0) return null;
      return { row: pos.row, col };
    }
    case "ArrowRight": {
      const col = pos.col + 1;
      if (col >= size.cols) return null;
      return { row: pos.row, col };
    }
    default:
      return null;
  }
}
