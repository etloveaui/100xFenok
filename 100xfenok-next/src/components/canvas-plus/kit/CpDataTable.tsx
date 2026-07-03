import type { ReactNode } from "react";

import { cpClassNames } from "./internal";

export type CpDataTableDensity = "compact" | "default" | "comfy" | "dense";

export type CpDataTableColumn<T> = {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  forecast?: boolean;
  render?: (row: T, rowIndex: number) => ReactNode;
};

export type CpDataTableProps<T> = {
  columns: readonly CpDataTableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string | number;
  density?: CpDataTableDensity;
  emphRowKeys?: ReadonlySet<string | number>;
  className?: string;
  caption?: ReactNode;
};

export default function CpDataTable<T extends object>({
  columns,
  rows,
  getRowKey,
  density = "default",
  emphRowKeys,
  className,
  caption,
}: CpDataTableProps<T>) {
  return (
    <div className={cpClassNames("cpw5-table-wrap", className)} data-density={density} data-cp-data-table>
      <table className="cpw5-table">
        {caption ? <caption className="cpw5-table__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column, columnIndex) => (
              <th key={column.key} data-align={column.align ?? (columnIndex === 0 ? "left" : "right")}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const rowKey = getRowKey(row, rowIndex);
            const emphasized = emphRowKeys?.has(rowKey) ?? false;
            return (
              <tr key={rowKey} className={emphasized ? "cpw5-table__row--emph" : undefined}>
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    data-align={column.align ?? (columnIndex === 0 ? "left" : "right")}
                    data-forecast={column.forecast ? "true" : undefined}
                  >
                    {column.render
                      ? column.render(row, rowIndex)
                      : ((row as Record<string, unknown>)[column.key] as ReactNode)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
