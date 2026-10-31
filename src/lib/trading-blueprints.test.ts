import { describe, expect, it } from "vitest";
import { defaultTradingLedger } from "./trading";
import { activeTradingBlueprint, TRADING_BLUEPRINTS } from "./trading-blueprints";

describe("trading blueprints", () => {
  it("recognizes a complete matching blueprint", () => {
    const ledger = defaultTradingLedger(1, "sh600519");
    const balanced = TRADING_BLUEPRINTS.find((item) => item.key === "balanced");
    if (!balanced) throw new Error("missing balanced blueprint");
    ledger.strategy.shortWindow = balanced.shortWindow;
    ledger.strategy.longWindow = balanced.longWindow;
    ledger.strategy.orderNotional = balanced.orderNotional;
    ledger.risk = { ...balanced.risk };

    expect(activeTradingBlueprint(ledger.strategy, ledger.risk)).toBe("balanced");
  });

  it("does not claim a preset when any risk field differs", () => {
    const ledger = defaultTradingLedger(1, "sh600519");
    ledger.strategy.shortWindow = 10;
    ledger.strategy.longWindow = 30;
    ledger.strategy.orderNotional = 50_000;
    ledger.risk.maxPositionPct = 41;

    expect(activeTradingBlueprint(ledger.strategy, ledger.risk)).toBeNull();
  });
});
