import { amountInMinorUnits, dateInTimezone } from "../../lib/finance";
import type { Budget, LifeEventCost, LifeEventPlan, PurchaseScenario, RecurringPayment, Transaction } from "../../types";

export type ScenarioProjection = {
  month: string;
  limit: number;
  actualSpent: number;
  recurringExpense: number;
  plannedLifeEventCosts: number;
  projectedRemaining: number;
  categoryLimit: number | null;
  categorySpent: number | null;
  categoryRemaining: number | null;
  recurringIncome: number;
};

export type LifeEventProgress = {
  expectedCosts: number;
  recordedAmount: number;
  goalRemaining: number;
  remainingAfterExpectedCosts: number;
  overGoalBy: number;
  progressPercent: number;
};

export function calculateLifeEventProgress(
  plan: Pick<LifeEventPlan, "target_amount" | "amount_set_aside">,
  costs: LifeEventCost[],
  transactions: Transaction[],
): LifeEventProgress {
  const recordedAmountMinor = costs.reduce((sum, cost) => {
    if (cost.status !== "recorded") return sum;
    const actual = cost.recorded_transaction_id
      ? transactions.find((transaction) => transaction.id === cost.recorded_transaction_id)?.amount
      : undefined;
    return sum + amountInMinorUnits(actual ?? cost.amount);
  }, 0);
  const expectedCostsMinor = costs.reduce(
    (sum, cost) => sum + (cost.status === "planned" ? amountInMinorUnits(cost.amount) : 0),
    0,
  );
  const goalRemainingMinor = amountInMinorUnits(plan.target_amount)
    - amountInMinorUnits(plan.amount_set_aside)
    - recordedAmountMinor;
  const remainingAfterExpectedCostsMinor = goalRemainingMinor - expectedCostsMinor;
  const progressMinor = amountInMinorUnits(plan.amount_set_aside) + recordedAmountMinor;
  const targetMinor = amountInMinorUnits(plan.target_amount);
  return {
    expectedCosts: expectedCostsMinor / 100,
    recordedAmount: recordedAmountMinor / 100,
    goalRemaining: goalRemainingMinor / 100,
    remainingAfterExpectedCosts: remainingAfterExpectedCostsMinor / 100,
    overGoalBy: Math.max(0, -remainingAfterExpectedCostsMinor) / 100,
    progressPercent: targetMinor > 0 ? Math.min(100, Math.max(0, progressMinor / targetMinor * 100)) : 0,
  };
}

function monthOf(date: string, timezone: string): string {
  return date.length === 10 ? date.slice(0, 7) : dateInTimezone(date, timezone).slice(0, 7);
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function daysInMonth(month: string): number {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}

export function nextRecurringDate(schedule: RecurringPayment, dueOn: string): string {
  if (schedule.frequency === "weekly") return addDays(dueOn, 7);
  const [year, month] = dueOn.split("-").map(Number);
  const next = schedule.frequency === "monthly"
    ? new Date(Date.UTC(year, month, 1))
    : new Date(Date.UTC(year + 1, schedule.anchor_month - 1, 1));
  const nextYear = next.getUTCFullYear();
  const nextMonth = next.getUTCMonth() + 1;
  const day = Math.min(schedule.anchor_day, new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate());
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function recurringOccurrencesInMonth(schedule: RecurringPayment, month: string): string[] {
  if (!schedule.enabled) return [];
  const firstDay = monthStart(month);
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  let date = schedule.next_due_on;
  let guard = 0;
  while (date < firstDay && guard++ < 1200) date = nextRecurringDate(schedule, date);
  const occurrences: string[] = [];
  while (date <= lastDay && guard++ < 1300) {
    occurrences.push(date);
    date = nextRecurringDate(schedule, date);
  }
  return occurrences;
}

export function projectPurchaseScenario(
  scenario: Pick<PurchaseScenario, "amount" | "planned_on" | "category_id">,
  transactions: Transaction[],
  schedules: RecurringPayment[],
  budgets: Budget[],
  monthlyBudget: number,
  lifeEventCosts: LifeEventCost[],
  lifeEventPlans: LifeEventPlan[],
  timezone: string,
): ScenarioProjection {
  const month = monthOf(scenario.planned_on, timezone);
  const actualExpense = transactions.filter(
    (item) => item.type === "expense" && monthOf(item.occurred_at, timezone) === month,
  );
  const categoryActual = scenario.category_id
    ? actualExpense.filter((item) => item.category_id === scenario.category_id)
    : [];
  const recurringInMonth = schedules.flatMap((schedule) =>
    recurringOccurrencesInMonth(schedule, month).map(() => schedule),
  );
  const recurringExpenses = recurringInMonth.filter((schedule) => schedule.type === "expense");
  const recurringCategoryExpenses = recurringExpenses.filter((schedule) => schedule.category_id === scenario.category_id);
  const activePlanIds = new Set(lifeEventPlans.filter((plan) => plan.status === "active").map((plan) => plan.id));
  const plannedCosts = lifeEventCosts.filter(
    (cost) => cost.status === "planned" && activePlanIds.has(cost.plan_id) && monthOf(cost.planned_on, timezone) === month,
  );
  const relevantPlannedCosts = scenario.category_id
    ? plannedCosts.filter((cost) => cost.category_id === scenario.category_id)
    : plannedCosts;
  const monthlyLimit = budgets.find((item) => item.month_start === monthStart(month) && item.category_id === null)?.amount ?? monthlyBudget;
  const actualSpent = actualExpense.reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0);
  const recurringExpense = recurringExpenses.reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0);
  const plannedLifeEventCosts = plannedCosts.reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0);
  const projectedRemaining = amountInMinorUnits(monthlyLimit) - actualSpent - recurringExpense - plannedLifeEventCosts - amountInMinorUnits(scenario.amount);
  const categoryBudget = scenario.category_id
    ? budgets.find((item) => item.month_start === monthStart(month) && item.category_id === scenario.category_id)
    : undefined;
  const categorySpent = categoryActual.reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0)
    + recurringCategoryExpenses.reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0)
    + relevantPlannedCosts.reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0);
  return {
    month,
    limit: monthlyLimit,
    actualSpent: actualSpent / 100,
    recurringExpense: recurringExpense / 100,
    plannedLifeEventCosts: plannedLifeEventCosts / 100,
    projectedRemaining: projectedRemaining / 100,
    categoryLimit: categoryBudget?.amount ?? null,
    categorySpent: scenario.category_id ? categorySpent / 100 : null,
    categoryRemaining: categoryBudget ? (amountInMinorUnits(categoryBudget.amount) - categorySpent - amountInMinorUnits(scenario.amount)) / 100 : null,
    recurringIncome: recurringInMonth.filter((item) => item.type === "income")
      .reduce((sum, item) => sum + amountInMinorUnits(item.amount), 0) / 100,
  };
}
