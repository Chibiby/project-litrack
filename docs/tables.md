# Tables

Every data table in LITRACK is built from two files:

- `src/components/ui/table.tsx` — the desktop table and its six rules.
- `src/components/ui/responsive-table.tsx` — the phone layout and the switch
  between the two.

Read this before adding or changing a table.

## Desktop: six rules

| # | Rule | How |
|---|------|-----|
| 1 | **Align.** Text left. Numbers right, with tabular figures so digits line up. | `<TableHead numeric>` and `<TableCell numeric>` |
| 2 | **Rows.** One hairline between rows. No zebra stripes. The row under the pointer highlights. | Built into `TableRow` |
| 3 | **Density.** Row height is a choice: 40 / 48 / 56px. | `<Table density="compact" \| "default" \| "comfortable">` |
| 4 | **Sticky.** The header stays while the body scrolls; the identity column stays while the table scrolls sideways. | `stickyHeader` (needs a capped height in `containerClassName`), `stickyFirstColumn` |
| 5 | **Cells.** A missing value is a dash, never blank. Long text is one line with the full text on hover. Numbers never truncate. | `<NoValue />` (reads "Not set" to screen readers), `<CellText>` |
| 6 | **Actions.** Row actions appear when the row is hovered or focused. Touch screens always show them. A sort arrow shows only on the sorted column. | `<RowActions>` |

Exception to rule 6: when the action **is** the list's job (approve/decline a
pending teacher, Update a MOSY decision, Complete a profile), keep the button
visible. Hiding the only thing a person came to do costs more than the clutter
it saves.

## Phone: six moves

`<StackedList>` holds one `<StackedRow>` per record.

| # | Move | `StackedRow` prop |
|---|------|-------------------|
| 1 | **Rank.** Show columns by use, not by position: identity, value, state. | `title`, `value`, `state` |
| 2 | **Stack.** Two lines. Identity left, value right on the first; state and facts on the second. | `meta` for the second line |
| 3 | **Slot.** The value always sits in the same right-hand slot with tabular figures, so the list still reads as a column of numbers. | `value` |
| 4 | **Label.** Give an ambiguous fact a word ("Updated Mar 04", "12 IP"). A value whose unit is obvious needs none. | inside `meta` / `value` |
| 5 | **Reveal.** Fields that do not fit expand in place under the row. Never a new page. | `details: { label, value }[]` |
| 6 | **Breakpoint.** The table decides, not the screen. | `ResponsiveTable` |

Other props: `leading` (avatar, checkbox, row number), `href` (makes the
identity a link), `actions` (end of the row, always visible), `children` (a
primary inline control such as a select — full width, always visible).

## The breakpoint

`<ResponsiveTable table={…} stacked={…} />` is a CSS size container. It shows
the table when **its own box** is at least `breakpoint` pixels wide and the
stacked rows below that. A table in a narrow side panel on a desktop gets rows
too, instead of a sideways scroll.

- `700` (default) — most tables.
- `900` — a table with wide inline controls (Kinder checklist).
- `1100` — a wide roster (the ten-column learner list).

Both views are in the DOM; CSS picks one. Tests that query a row's button by
name scope to the desktop table:

```ts
const desktopTable = () => document.querySelector("table") as HTMLElement;
within(desktopTable()).getByRole("button", { name: "Revoke" });
```

Collapsed `details` stay mounted with `hidden`, so they are out of the
accessibility tree until opened, and `aria-controls` always resolves.

## What does not stack

- **Pivot / matrix tables** (Division Summary counts × buckets): stacking a
  matrix loses the comparison. Keep the table, pin the first column, let it
  scroll sideways inside its own box.
- **Editable grids** (weekly attendance, monthly reading level, term grades):
  keep the table on desktop with the learner column pinned. Their phone views
  are purpose-built lists already.
- **Short tables** (three narrow columns): they fit a phone. Apply the desktop
  rules only.
- **Printable reports**: print layout, not screen layout. Leave them alone.

## Recipe

```tsx
<ResponsiveTable
  table={
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead numeric>Learners</TableHead>
          <TableHead>Status</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-[16rem] font-medium">
              <CellText>{row.name}</CellText>
            </TableCell>
            <TableCell numeric>{row.learners}</TableCell>
            <TableCell>{row.status ?? <NoValue />}</TableCell>
            <TableCell><RowActions>{actions(row)}</RowActions></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  }
  stacked={
    <StackedList aria-label="Schools">
      {rows.map((row) => (
        <StackedRow
          key={row.id}
          title={row.name}
          value={row.learners}
          state={<StatusBadge status={row.status} />}
          details={[{ label: "District", value: row.district ?? <NoValue /> }]}
          actions={actions(row)}
        />
      ))}
    </StackedList>
  }
/>
```

Build the row's actions once (`const actions = (row) => …`) and use them in
both views, so the two can never drift.
