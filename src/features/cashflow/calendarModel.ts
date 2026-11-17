import { amountInMinorUnits, dateInTimezone } from "../../lib/finance";
import { nextRecurringDate } from "../planning/planningModel";
import type { ExpenseSplit, Group, GroupMember, LifeEventCost, LifeEventPlan, RecurringPayment, Settlement, SharedExpense, Transaction } from "../../types";

export type CashflowEvent = {
  id: string;
  title: string;
  date: string;
  amount: number;
  flow: "income" | "expense" | "settlement";
  status: "expected" | "completed";
  source: "transaction" | "recurring" | "life-event" | "settlement";
  note?: string;
};

export type OpenSharedBalance = {
  groupId: string;
  groupName: string;
  counterpartyId: string;
  counterpartyName: string;
  amount: number;
  direction: "pay" | "receive";
};

type CashflowInput = {
  from: string;
  to: string;
  timezone: string;
  transactions: Transaction[];
  schedules: RecurringPayment[];
  costs: LifeEventCost[];
  plans: LifeEventPlan[];
  settlements: Settlement[];
  groups: Group[];
};

function dateOnly(value: string, timezone: string): string {
  return value.length === 10 ? value : dateInTimezone(value, timezone);
}

export function buildCashflowEvents(input: CashflowInput): CashflowEvent[] {
  const events: CashflowEvent[] = [];
  const inRange = (date: string) => date >= input.from && date <= input.to;

  for (const transaction of input.transactions) {
    const date = dateOnly(transaction.occurred_at, input.timezone);
    if (!inRange(date)) continue;
    events.push({
      id: `transaction:${transaction.id}`,
      title: transaction.title,
      date,
      amount: transaction.amount,
      flow: transaction.type,
      status: "completed",
      source: "transaction",
      note: transaction.shared_expense_id ? "Shared expense share" : transaction.recurring_payment_id ? "Recurring entry" : undefined,
    });
  }

  for (const schedule of input.schedules) {
    if (!schedule.enabled) continue;
    let occurrence = schedule.next_due_on;
    let guard = 0;
    while (occurrence < input.from && guard++ < 1200) occurrence = nextRecurringDate(schedule, occurrence);
    while (occurrence <= input.to && guard++ < 1300) {
      events.push({
        id: `recurring:${schedule.id}:${occurrence}`,
        title: schedule.title,
        date: occurrence,
        amount: schedule.amount,
        flow: schedule.type,
        status: "expected",
        source: "recurring",
        note: `${schedule.frequency}${schedule.autopay ? " · autopay label" : ""}`,
      });
      occurrence = nextRecurringDate(schedule, occurrence);
    }
  }

  const activePlans = new Set(input.plans.filter((plan) => plan.status === "active").map((plan) => plan.id));
  for (const cost of input.costs) {
    if (cost.status !== "planned" || !activePlans.has(cost.plan_id) || !inRange(cost.planned_on)) continue;
    events.push({
      id: `life-event:${cost.id}`,
      title: cost.title,
      date: cost.planned_on,
      amount: cost.amount,
      flow: "expense",
      status: "expected",
      source: "life-event",
      note: input.plans.find((plan) => plan.id === cost.plan_id)?.name,
    });
  }

  for (const settlement of input.settlements) {
    const date = dateOnly(settlement.paid_at, input.timezone);
    if (!inRange(date)) continue;
    const relatedGroup = input.groups.find((group) => group.id === settlement.group_id);
    events.push({
      id: `settlement:${settlement.id}`,
      title: relatedGroup ? `Shared settlement · ${relatedGroup.name}` : "Shared expense settlement",
      date,
      amount: settlement.amount,
      flow: "settlement",
      status: "completed",
      source: "settlement",
      note: settlement.note ?? undefined,
    });
  }

  return events.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

export function cashflowDayTotals(events: CashflowEvent[]) {
  return events.reduce<Record<string, { incoming: number; outgoing: number; settlements: number }>>((totals, event) => {
    const day = totals[event.date] ?? { incoming: 0, outgoing: 0, settlements: 0 };
    const amount = amountInMinorUnits(event.amount);
    if (event.flow === "income") day.incoming += amount;
    else if (event.flow === "expense") day.outgoing += amount;
    else day.settlements += amount;
    totals[event.date] = day;
    return totals;
  }, {});
}

export function calculateOpenSharedBalances(
  userId: string,
  groups: Group[],
  members: GroupMember[],
  expenses: SharedExpense[],
  splits: ExpenseSplit[],
  settlements: Settlement[],
): OpenSharedBalance[] {
  const result: OpenSharedBalance[] = [];
  for (const group of groups) {
    const balances = new Map<string, number>();
    const add = (memberId: string, value: number) => balances.set(memberId, (balances.get(memberId) ?? 0) + value);
    for (const expense of expenses.filter((item) => item.group_id === group.id)) {
      for (const split of splits.filter((item) => item.expense_id === expense.id)) {
        add(split.user_id, amountInMinorUnits(split.amount_owed));
      }
      if (expense.paid_by) add(expense.paid_by, -amountInMinorUnits(expense.amount));
    }
    for (const settlement of settlements.filter((item) => item.group_id === group.id)) {
      add(settlement.payer_id, -amountInMinorUnits(settlement.amount));
      add(settlement.payee_id, amountInMinorUnits(settlement.amount));
    }

    const debtors = [...balances].filter(([, balance]) => balance > 0).sort(([left], [right]) => left.localeCompare(right));
    const creditors = [...balances].filter(([, balance]) => balance < 0).map(([id, balance]) => [id, -balance] as const).sort(([left], [right]) => left.localeCompare(right));
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const [debtorId, debtorBalance] = debtors[debtorIndex];
      const [creditorId, creditorBalance] = creditors[creditorIndex];
      const matchedAmount = Math.min(debtorBalance, creditorBalance);
      if (debtorId === userId || creditorId === userId) {
        const counterpartyId = debtorId === userId ? creditorId : debtorId;
        const counterparty = members.find((member) => member.group_id === group.id && member.user_id === counterpartyId);
        result.push({
          groupId: group.id,
          groupName: group.name,
          counterpartyId,
          counterpartyName: counterparty?.profile?.display_name ?? "Group member",
          amount: matchedAmount / 100,
          direction: debtorId === userId ? "pay" : "receive",
        });
      }
      debtors[debtorIndex][1] -= matchedAmount;
      creditors[creditorIndex] = [creditorId, creditorBalance - matchedAmount];
      if (debtors[debtorIndex][1] === 0) debtorIndex++;
      if (creditors[creditorIndex][1] === 0) creditorIndex++;
    }
  }
  return result;
}
