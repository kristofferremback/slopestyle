// Resets closer together than minGapMs read as one moment, so they form a
// group that shares a label. Resets arrive in any order and leave sorted.
export function groupResets<T extends { end_ms: number }>(resets: T[], minGapMs: number): T[][] {
  const groups: T[][] = [];
  for (const reset of [...resets].sort((a, b) => a.end_ms - b.end_ms)) {
    const group = groups.at(-1);
    if (group && reset.end_ms - group[group.length - 1]!.end_ms < minGapMs) group.push(reset);
    else groups.push([reset]);
  }
  return groups;
}

export interface ResetMark {
  // Pixels from the chart's left edge to the line, and the label's width.
  x: number;
  width: number;
  // Weekly resets matter more than 5-hour ones and take their space first.
  important: boolean;
  // A label the view does not want at all still keeps its line.
  wanted: boolean;
}

export interface ResetLabel {
  show: boolean;
  align: "left" | "right";
}

// Lays reset labels out across a chart chartPx wide so none overprint. A label
// hangs right of its line in the left half and left of it in the right half,
// flips sides when the preferred side is taken, and hides when neither fits.
export function placeResetLabels(marks: ResetMark[], chartPx: number): ResetLabel[] {
  const placed: [number, number][] = [];
  const labels: ResetLabel[] = marks.map(() => ({ show: false, align: "left" }));
  const order = marks.map((mark, index) => ({ mark, index })).sort((a, b) => Number(b.mark.important) - Number(a.mark.important) || a.mark.x - b.mark.x);
  for (const { mark, index } of order) {
    if (!mark.wanted) continue;
    const preferred = mark.x > chartPx / 2 ? "right" : "left";
    for (const align of [preferred, preferred === "left" ? "right" : "left"] as const) {
      const [from, to] = align === "left" ? [mark.x, mark.x + mark.width] : [mark.x - mark.width, mark.x];
      if (from < 0 || to > chartPx || placed.some(([start, end]) => from < end && to > start)) continue;
      placed.push([from, to]);
      labels[index] = { show: true, align };
      break;
    }
  }
  return labels;
}
