import { ScrollArea, Table } from "@mantine/core";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./DataTable.module.css";

export interface DataTableColumn<Row> {
	key: string;
	header: ReactNode;
	render: (row: Row) => ReactNode;
	mobileLabel?: string;
	textAlign?: "left" | "center" | "right";
	width?: number | string;
}

type DataAttributeValue = boolean | number | string | undefined;
type DataTableRowProps = Omit<ComponentPropsWithoutRef<"tr">, "children"> & {
	[key: `data-${string}`]: DataAttributeValue;
};

interface DataTableProps<Row> {
	columns: DataTableColumn<Row>[];
	rows: Row[];
	rowKey: (row: Row) => string | number;
	onRowClick?: (row: Row) => void;
	isRowClickable?: (row: Row) => boolean;
	getRowProps?: (row: Row, index: number) => DataTableRowProps;
	"data-testid"?: string;
}

export function DataTable<Row>({
	columns,
	rows,
	rowKey,
	onRowClick,
	isRowClickable,
	getRowProps,
	"data-testid": dataTestId,
}: DataTableProps<Row>) {
	return (
		<ScrollArea className={styles.scrollArea}>
			<Table
				className={styles.table}
				horizontalSpacing="md"
				verticalSpacing="sm"
				withTableBorder
				data-testid={dataTestId}
			>
				<Table.Thead className={styles.head}>
					<Table.Tr className={styles.headRow}>
						{columns.map((column) => (
							<Table.Th
								key={column.key}
								className={styles.headCell}
								style={{ textAlign: column.textAlign, width: column.width }}
							>
								{column.header}
							</Table.Th>
						))}
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody className={styles.body}>
					{rows.map((row, index) => {
						const clickable = typeof onRowClick === "function" && (isRowClickable?.(row) ?? true);
						const rowProps = getRowProps?.(row, index) ?? {};
						const rowClassName = [styles.bodyRow, clickable ? styles.clickableRow : "", rowProps.className]
							.filter(Boolean)
							.join(" ");
						const handleRowClick: ComponentPropsWithoutRef<"tr">["onClick"] = (event) => {
							rowProps.onClick?.(event);
							if (!event.defaultPrevented) onRowClick?.(row);
						};
						const handleRowKeyDown: ComponentPropsWithoutRef<"tr">["onKeyDown"] = (event) => {
							rowProps.onKeyDown?.(event);
							if (event.defaultPrevented) return;
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							onRowClick?.(row);
						};

						return (
							<Table.Tr
								{...rowProps}
								key={rowKey(row)}
								className={rowClassName}
								data-striped={index % 2 === 0 ? "odd" : "even"}
								onClick={clickable ? handleRowClick : rowProps.onClick}
								onKeyDown={clickable ? handleRowKeyDown : rowProps.onKeyDown}
								role={clickable ? (rowProps.role ?? "button") : rowProps.role}
								tabIndex={clickable ? (rowProps.tabIndex ?? 0) : rowProps.tabIndex}
							>
								{columns.map((column) => {
									const mobileLabel =
										column.mobileLabel ?? (typeof column.header === "string" ? column.header : undefined);
									return (
										<Table.Td
											key={column.key}
											className={styles.bodyCell}
											data-column-key={column.key}
											data-label={mobileLabel}
											style={{ textAlign: column.textAlign }}
										>
											{column.render(row)}
										</Table.Td>
									);
								})}
							</Table.Tr>
						);
					})}
				</Table.Tbody>
			</Table>
		</ScrollArea>
	);
}
