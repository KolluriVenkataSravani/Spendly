import { describe, expect, it } from "vitest";
import { amountInMinorUnits, budgetProgress, monthBounds, splitAmount, sumByType, sumMoneyAmounts, transactionsInMonth } from "./finance";
import type { Budget, Transaction } from "../types";

const transactions = [
  { type: "expense", amount: 10.1, occurred_at: "2025-03-02T10:00:00Z", category_id: "food" },
  { type: "expense", amount: 9.9, occurred_at: "2025-03-20T10:00:00Z", category_id: "food" },
  { type: "income", amount: 100, occurred_at: "2025-03-20T10:00:00Z", category_id: null },
  { type: "expense", amount: 500, occurred_at: "2025-02-28T10:00:00Z", category_id: "food" },
] as Transaction[];

describe("finance calculations", () => {
  it("uses calendar month boundaries", () => {
    expect(monthBounds(new Date(2025, 2, 17))).toEqual({ start: "2025-03-01", end: "2025-04-01" });
  });

  it("sums expense and income without mixing types", () => {
    expect(sumByType(transactions, "expense")).toBe(520);
    expect(sumByType(transactions, "income")).toBe(100);
  });

  it("calculates budget progress from only matching month and category", () => {
    const budget = { month_start: "2025-03-01", category_id: "food", amount: 50 } as Budget;
    expect(budgetProgress(transactions, budget, "food")).toEqual({ spent: 20, remaining: 30, percent: 40 });
  });

  it("counts categorized expenses in an overall budget", () => {
    const budget = { month_start: "2025-03-01", category_id: null, amount: 15 } as Budget;
    expect(budgetProgress(transactions, budget, null)).toEqual({ spent: 20, remaining: -5, percent: 20 / 15 * 100 });
  });

  it("filters months in the selected timezone", () => {
    const nearMonthBoundary = [
      { type: "expense", amount: 10, occurred_at: "2025-03-01T07:30:00Z", category_id: null },
      { type: "expense", amount: 20, occurred_at: "2025-03-01T08:30:00Z", category_id: null },
    ] as Transaction[];
    expect(transactionsInMonth(nearMonthBoundary, "2025-03-01", "America/Los_Angeles")).toHaveLength(1);
    expect(monthBounds(new Date("2025-03-01T03:00:00Z"), "America/Los_Angeles").start).toBe("2025-02-01");
  });

  it("splits remainder cents deterministically and rejects invalid weights", () => {
    expect(splitAmount("10.00", [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(splitAmount("10.00", [0.1, 0.2])).toEqual([3.33, 6.67]);
    expect(() => splitAmount(10, [0, 0])).toThrow();
  });

  it("aggregates decimal currency values in integer minor units", () => {
    expect(amountInMinorUnits("0.29")).toBe(29);
    expect(amountInMinorUnits(".5")).toBe(50);
    expect(sumMoneyAmounts(["0.10", "0.20", "0.70"])).toBe(1);
    expect(() => amountInMinorUnits("90071992547409.92")).toThrow();
  });
});
