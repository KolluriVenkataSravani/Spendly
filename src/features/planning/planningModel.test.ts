import { describe, expect, it } from "vitest";
import type { Budget, LifeEventCost, LifeEventPlan, PurchaseScenario, RecurringPayment, Transaction } from "../../types";
import { calculateLifeEventProgress, projectPurchaseScenario } from "./planningModel";

const transaction: Transaction = {
  id: "tx-1",
  owner_id: "user-1",
  title: "Groceries",
  amount: 125,
  type: "expense",
  payment_method: "cash",
  category_id: "food",
  payment_source_id: null,
  occurred_at: "2026-11-12T10:00:00.000Z",
  notes: null,
  receipt_path: null,
  shared_expense_id: null,
  recurring_payment_id: null,
  recurring_occurrence_date: null,
  life_event_cost_id: null,
};

const schedule: RecurringPayment = {
  id: "schedule-1",
  owner_id: "user-1",
  title: "Rent",
  amount: 400,
  type: "expense",
  payment_method: "debit_card",
  category_id: "home",
  payment_source_id: null,
  frequency: "monthly",
  next_due_on: "2026-11-30",
  anchor_day: 30,
  anchor_month: 11,
  autopay: false,
  enabled: true,
  notes: null,
  created_at: "",
  updated_at: "",
};

const activePlan: LifeEventPlan = {
  id: "trip",
  owner_id: "user-1",
  name: "Trip",
  target_amount: 1000,
  target_on: "2026-12-20",
  amount_set_aside: 0,
  status: "active",
  created_at: "",
  updated_at: "",
};

const plannedCost: LifeEventCost = {
  id: "hotel",
  plan_id: "trip",
  title: "Hotel",
  amount: 250,
  planned_on: "2026-11-22",
  category_id: "home",
  status: "planned",
  recorded_transaction_id: null,
  created_at: "",
  updated_at: "",
};

const recordedCost: LifeEventCost = { ...plannedCost, id: "ticket", amount: 300, status: "recorded", recorded_transaction_id: "tx-ticket" };
const overallBudget: Budget = { id: "budget", owner_id: "user-1", month_start: "2026-11-01", category_id: null, amount: 1200 };
const categoryBudget: Budget = { id: "category", owner_id: "user-1", month_start: "2026-11-01", category_id: "home", amount: 700 };

describe("purchase scenario projection", () => {
  it("uses recorded expenses, due recurring costs, active planned costs, and the selected budgets", () => {
    const scenario: Pick<PurchaseScenario, "amount" | "planned_on" | "category_id"> = {
      amount: 100,
      planned_on: "2026-11-14",
      category_id: "home",
    };
    const result = projectPurchaseScenario(
      scenario,
      [transaction],
      [schedule],
      [overallBudget, categoryBudget],
      900,
      [plannedCost, recordedCost],
      [activePlan],
      "UTC",
    );
    expect(result.actualSpent).toBe(125);
    expect(result.recurringExpense).toBe(400);
    expect(result.plannedLifeEventCosts).toBe(250);
    expect(result.projectedRemaining).toBe(325);
    expect(result.categoryRemaining).toBe(-50);
  });

  describe("life-event progress", () => {
    it("warns when remaining expected costs exceed goal funding remaining", () => {
      const plan = { ...activePlan, amount_set_aside: 200 };
      const actualTransaction = { ...transaction, id: "tx-ticket", amount: 350 };
      const result = calculateLifeEventProgress(
        plan,
        [plannedCost, recordedCost],
        [actualTransaction],
      );

      expect(result.recordedAmount).toBe(350);
      expect(result.expectedCosts).toBe(250);
      expect(result.goalRemaining).toBe(450);
      expect(result.overGoalBy).toBe(0);

      const overBudget = calculateLifeEventProgress(
        plan,
        [{ ...plannedCost, amount: 600 }, recordedCost],
        [actualTransaction],
      );
      expect(overBudget.remainingAfterExpectedCosts).toBe(-150);
      expect(overBudget.overGoalBy).toBe(150);
    });

    it("keeps an earmarked amount separate from actual transaction spend", () => {
      const result = calculateLifeEventProgress(
        { ...activePlan, target_amount: 1000, amount_set_aside: 300 },
        [{ ...plannedCost, amount: 200 }],
        [],
      );
      expect(result.goalRemaining).toBe(700);
      expect(result.expectedCosts).toBe(200);
      expect(result.progressPercent).toBe(30);
    });
  });

  it("excludes planned costs for completed plans and does not apply the current month's actuals to another month", () => {
    const result = projectPurchaseScenario(
      { amount: 100, planned_on: "2026-12-15", category_id: null },
      [transaction],
      [schedule],
      [],
      900,
      [plannedCost],
      [{ ...activePlan, status: "completed" }],
      "UTC",
    );
    expect(result.actualSpent).toBe(0);
    expect(result.recurringExpense).toBe(400);
    expect(result.plannedLifeEventCosts).toBe(0);
    expect(result.projectedRemaining).toBe(400);
    expect(result.limit).toBe(900);
  });
});
