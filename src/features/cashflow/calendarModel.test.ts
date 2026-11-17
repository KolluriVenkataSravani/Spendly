import { describe, expect, it } from "vitest";
import type { Group, LifeEventCost, LifeEventPlan, RecurringPayment, Transaction } from "../../types";
import { buildCashflowEvents, calculateOpenSharedBalances, cashflowDayTotals } from "./calendarModel";

const schedule: RecurringPayment = {
  id: "rent",
  owner_id: "me",
  title: "Rent",
  amount: 1200,
  type: "expense",
  payment_method: "debit_card",
  category_id: null,
  payment_source_id: null,
  frequency: "monthly",
  next_due_on: "2026-11-30",
  anchor_day: 30,
  anchor_month: 11,
  autopay: true,
  enabled: true,
  notes: null,
  created_at: "",
  updated_at: "",
};

const plans: LifeEventPlan[] = [{
  id: "trip",
  owner_id: "me",
  name: "Trip",
  target_amount: 2000,
  target_on: "2026-12-20",
  amount_set_aside: 0,
  status: "active",
  created_at: "",
  updated_at: "",
}];

const costs: LifeEventCost[] = [{
  id: "hotel",
  plan_id: "trip",
  title: "Hotel",
  amount: 400,
  planned_on: "2026-11-20",
  category_id: null,
  status: "planned",
  recorded_transaction_id: null,
  created_at: "",
  updated_at: "",
}];

const transaction: Transaction = {
  id: "paid",
  owner_id: "me",
  title: "Coffee",
  amount: 5,
  type: "expense",
  payment_method: "cash",
  category_id: null,
  payment_source_id: null,
  occurred_at: "2026-11-14T10:00:00Z",
  notes: null,
  receipt_path: null,
  shared_expense_id: null,
  recurring_payment_id: null,
  recurring_occurrence_date: null,
  life_event_cost_id: null,
};

describe("cash-flow calendar model", () => {
  it("keeps actual transactions completed and recurring and life-event entries expected", () => {
    const events = buildCashflowEvents({
      from: "2026-11-01",
      to: "2026-11-30",
      timezone: "UTC",
      transactions: [transaction],
      schedules: [schedule],
      costs,
      plans,
      settlements: [],
      groups: [],
    });
    expect(events.map((event) => [event.source, event.status, event.date])).toEqual([
      ["transaction", "completed", "2026-11-14"],
      ["life-event", "expected", "2026-11-20"],
      ["recurring", "expected", "2026-11-30"],
    ]);
    expect(cashflowDayTotals(events)["2026-11-30"].outgoing).toBe(120000);
  });

  it("does not show costs from archived plans", () => {
    const events = buildCashflowEvents({
      from: "2026-11-01",
      to: "2026-11-30",
      timezone: "UTC",
      transactions: [],
      schedules: [],
      costs,
      plans: [{ ...plans[0], status: "archived" }],
      settlements: [],
      groups: [],
    });
    expect(events).toHaveLength(0);
  });

  it("calculates a user's share and subtracts settlements without treating them as expenses", () => {
    const groups: Group[] = [{ id: "g1", name: "Roommates", created_by: "me", created_at: "" }];
    const balances = calculateOpenSharedBalances(
      "me",
      groups,
      [
        { group_id: "g1", user_id: "me", role: "owner" },
        { group_id: "g1", user_id: "friend", role: "member", profile: { id: "friend", display_name: "Friend" } },
      ],
      [{ id: "expense", group_id: "g1", created_by: "me", paid_by: "friend", title: "Dinner", amount: 100, occurred_at: "", category_id: null }],
      [
        { id: "me-split", expense_id: "expense", user_id: "me", amount_owed: 50 },
        { id: "friend-split", expense_id: "expense", user_id: "friend", amount_owed: 50 },
      ],
      [],
    );
    expect(balances).toEqual([{ groupId: "g1", groupName: "Roommates", counterpartyId: "friend", counterpartyName: "Friend", amount: 50, direction: "pay" }]);
  });
});
