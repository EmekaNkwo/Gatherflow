"use client";

import { useState, type ReactNode } from "react";
import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "cn";

/**
 * The feature set every directory in GatherFlow uses: sorting, pagination
 * and column visibility. Declared once, outside the component, as the
 * TanStack Table docs recommend.
 */
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

export type GatherFlowColumn<TData extends RowData> = ColumnDef<typeof features, TData>;

interface DataTableProps<TData extends RowData> {
  columns: GatherFlowColumn<TData>[];
  data: TData[];
  /** Rendered in place of the table when there are no rows. */
  emptyState: ReactNode;
  /** Controls above the table: filters, search, bulk actions. */
  toolbar?: ReactNode;
  initialPageSize?: number;
  getRowId?: (row: TData) => string;
  /** Column ids hidden by default but available from the column menu. */
  hiddenByDefault?: readonly string[];
  /** Accessible description of the table contents. */
  label: string;
}

/**
 * Shared table so every directory behaves the same way.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways on a phone. Calm by default: roomy rows, a soft warm header and
 * page controls large enough to tap.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyState,
  toolbar,
  initialPageSize = 15,
  getRowId,
  hiddenByDefault = [],
  label,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    Object.fromEntries(hiddenByDefault.map((id) => [id, false])),
  );

  const table = useTable({
    features,
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    initialState: { pagination: { pageSize: initialPageSize, pageIndex: 0 } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="min-h-11 gap-1.5 self-end rounded-full sm:self-auto">
                <Columns3Icon />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                  >
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rows.length === 0 ? (
        emptyState
      ) : (
        <>
          <div className="overflow-x-auto rounded-3xl border bg-card">
            <Table aria-label={label}>
              <TableHeader className="bg-warm/60">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      return (
                        <TableHead
                          key={header.id}
                          className="h-12 px-4 whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5"
                          aria-sort={
                            sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                          }
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={() => header.column.toggleSorting()}
                              className="-mx-2 flex min-h-9 items-center gap-1 rounded-full px-2 font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === "asc" ? (
                                <ArrowUpIcon className="size-3.5" />
                              ) : sorted === "desc" ? (
                                <ArrowDownIcon className="size-3.5" />
                              ) : null}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-4 py-3 align-middle first:pl-5 last:pr-5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {rows.length} of {data.length}
            </p>
            {table.getPageCount() > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="rounded-full"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon />
                </Button>
                <span className="px-1 text-sm tabular-nums text-muted-foreground">
                  Page {table.state.pagination.pageIndex + 1} of {table.getPageCount()}
                </span>
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="rounded-full"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Next page"
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Small helper for the plain text cells used across the directories. */
export function TextCell({ value }: { value?: string | number | null }) {
  return (
    <span className={cn(!value && "text-muted-foreground")}>
      {value === undefined || value === null || value === "" ? "—" : value}
    </span>
  );
}
