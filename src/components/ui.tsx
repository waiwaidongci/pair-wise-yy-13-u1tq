import type { ReactNode } from "react";
import type { SheetStatus } from "../rules/types";

export function Notice({
  kind,
  children,
}: {
  kind: "ok" | "err" | "dup";
  children: ReactNode;
}) {
  if (!children) return null;
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

const STATUS_CLASS: Record<SheetStatus, string> = {
  open: "badge-open",
  review: "badge-review",
  released: "badge-released",
};
const STATUS_TEXT: Record<SheetStatus, string> = {
  open: "检测中",
  review: "待复核",
  released: "已放行",
};

export function StatusBadge({ status }: { status: SheetStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_TEXT[status]}</span>;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
