"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Search, Download } from "lucide-react";

interface DataTableProps<T> {
  data: T[];
  columns: {
    key: string;
    header: string;
    render?: (item: T) => React.ReactNode;
    searchable?: boolean;
  }[];
  filterColumn?: keyof T;
  filterOptions?: { value: string; label: string }[];
  itemsPerPage?: number;
  searchable?: boolean;
  exportable?: boolean;
  emptyMessage?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  filterColumn,
  filterOptions,
  itemsPerPage = 10,
  searchable = true,
  exportable = true,
  emptyMessage = "No data found",
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValue, setFilterValue] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredData = useMemo(() => {
    let result = [...data];

    if (filterColumn && filterValue && filterValue !== "all") {
      result = result.filter((item) => String(item[filterColumn]) === filterValue);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        columns
          .filter((col) => col.searchable !== false)
          .some((col) => {
            const value = item[col.key];
            return String(value).toLowerCase().includes(query);
          })
      );
    }

    return result;
  }, [data, searchQuery, filterValue, filterColumn, columns]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  const handleExport = () => {
    const headers = columns.map((col) => col.header).join(",");
    const rows = filteredData.map((item) =>
      columns.map((col) => `"${String(item[col.key]).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [headers, ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleFilterChange = (value: string) => {
    setFilterValue(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        {searchable && (
          <div className="relative w-full sm:w-72">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              aria-label="Search table"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {filterOptions && filterColumn && (
            <div className="space-y-1">
              <Label htmlFor="data-table-filter" className="sr-only">
                Filter
              </Label>
              <Select value={filterValue} onValueChange={handleFilterChange}>
                <SelectTrigger id="data-table-filter" className="w-[160px]" aria-label="Filter table">
                  <SelectValue placeholder="Filter by..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {filterOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {exportable && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Export
            </Button>
          )}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to{" "}
        {Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} results
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={String(col.key)}>{col.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((item, idx) => (
                <TableRow key={idx}>
                  {columns.map((col) => (
                    <TableCell key={String(col.key)}>
                      {col.render ? col.render(item) : String(item[col.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
