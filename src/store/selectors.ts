// 记录层选择器：页面通过这些只读视图访问记录，不直接拼业务数据。
import { useMemo } from "react";

import { isCalibrationValid } from "../domain/rules";
import type { Batch, InspectionSheet, SheetStatus, StationState } from "../domain/types";
import { today, useStation } from "./store";

export interface BatchView {
  batch: Batch;
  /** 该批当前未结束检测单（同批至多一张） */
  openSheet: InspectionSheet | null;
  /** 最近一张检测单（含已放行） */
  latestSheet: InspectionSheet | null;
  sheets: InspectionSheet[];
}

export const STATUS_TEXT: Record<SheetStatus, string> = {
  open: "检测中",
  review: "待复核",
  released: "已放行",
};

export function useStationState(): StationState {
  return useStation((s) => s);
}

export function useBatches(): BatchView[] {
  const state = useStationState();
  return useMemo(() => {
    return state.batches.map((batch) => {
      const sheets = state.sheets
        .filter((x) => x.batchId === batch.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return {
        batch,
        sheets,
        latestSheet: sheets[0] ?? null,
        openSheet: sheets.find((x) => x.status === "open" || x.status === "review") ?? null,
      };
    });
  }, [state]);
}

export function useReviewQueue(): InspectionSheet[] {
  const state = useStationState();
  return useMemo(
    () =>
      state.sheets
        .filter((x) => x.status === "review")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [state]
  );
}

export function useBalances() {
  const state = useStationState();
  return useMemo(() => {
    const t = today();
    return state.balances.map((b) => ({ ...b, valid: isCalibrationValid(b, t) }));
  }, [state]);
}

export function useMetrics() {
  const state = useStationState();
  return useMemo(() => {
    const sheets = state.sheets;
    const open = sheets.filter((x) => x.status === "open").length;
    const review = sheets.filter((x) => x.status === "review").length;
    const released = sheets.filter((x) => x.status === "released").length;
    const invalidated = sheets.reduce((n, x) => n + x.archivedConclusions.length, 0);
    return { batches: state.batches.length, open, review, released, invalidated };
  }, [state]);
}
