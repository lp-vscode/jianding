export interface PortfolioPulseRow {
  name: string;
  weight: number;
  dayPnl: number | null;
}

export interface PortfolioPulse {
  mood: "等待建仓" | "升温" | "降温" | "平稳";
  concentration: string;
  contributorLabel: "今日贡献" | "最大拖累";
  contributorName: string;
}

export function buildPortfolioPulse(
  rows: PortfolioPulseRow[],
  dayPct: number,
): PortfolioPulse {
  if (!rows.length) {
    return {
      mood: "等待建仓",
      concentration: "--",
      contributorLabel: "今日贡献",
      contributorName: "--",
    };
  }

  const largestWeight = Math.max(...rows.map((row) => row.weight));
  const concentration =
    largestWeight >= 70
      ? `高集中 ${largestWeight.toFixed(0)}%`
      : largestWeight >= 45
        ? `偏集中 ${largestWeight.toFixed(0)}%`
        : `较均衡 ${largestWeight.toFixed(0)}%`;
  const leading = rows
    .filter((row) => row.dayPnl != null)
    .sort((left, right) => Math.abs(right.dayPnl ?? 0) - Math.abs(left.dayPnl ?? 0))[0];

  return {
    mood: dayPct > 0.5 ? "升温" : dayPct < -0.5 ? "降温" : "平稳",
    concentration,
    contributorLabel: leading && (leading.dayPnl ?? 0) < 0 ? "最大拖累" : "今日贡献",
    contributorName: leading?.name ?? "--",
  };
}
