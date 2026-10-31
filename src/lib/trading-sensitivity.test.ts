import { describe, expect, it } from "vitest";
import type { Asset } from "../types";
import { defaultTradingLedger } from "./trading";
import { buildSensitivityGrid, sensitivityValue } from "./trading-sensitivity";

const asset: Asset = {
  symbol: "sh600519",
  code: "600519",
  name: "贵州茅台",
  kind: "stock",
  market: "sh",
  typeLabel: "A股",
  addedAt: 1,
};

describe("strategy parameter sensitivity", () => {
  const points = Array.from({ length: 90 }, (_, index) => ({
    label: String(index),
    value: 100 + Math.sin(index / 5) * 9 + index * 0.12,
  }));
  const ledger = defaultTradingLedger(1, asset.symbol);

  it("builds a matrix and marks impossible moving-average pairs", () => {
    const grid = buildSensitivityGrid(
      points,
      ledger.strategy,
      asset,
      ledger.risk,
      100_000,
      [5, 20],
      [10, 30],
    );

    expect(grid.cells).toHaveLength(4);
    expect(grid.cells.find((cell) => cell.shortWindow === 20 && cell.longWindow === 10)?.valid).toBe(false);
    expect(grid.best?.valid).toBe(true);
  });

  it("exposes return, drawdown and composite score consistently", () => {
    const grid = buildSensitivityGrid(
      points,
      ledger.strategy,
      asset,
      ledger.risk,
      100_000,
      [5],
      [20],
    );
    const cell = grid.cells[0];
    expect(sensitivityValue(cell, "return")).toBeCloseTo(cell.result?.totalReturn ?? 0);
    expect(sensitivityValue(cell, "drawdown")).toBeCloseTo(-(cell.result?.maxDrawdown ?? 0));
    expect(sensitivityValue(cell, "score")).toBeCloseTo(cell.score);
  });
});
