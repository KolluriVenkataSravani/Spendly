import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Clock3, Pencil, Wallet } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { Card, Empty, PageHeading } from "../../components/ui/FinancePrimitives";
import { dateInTimezone, formatCurrency } from "../../lib/finance";
import { supabase } from "../../lib/supabase";
import type {
  ExpenseSplit, Group, GroupMember, LifeEventCost, LifeEventPlan, PageKey, PaymentSource,
  Profile, RecurringPayment, Settlement, SharedExpense, Transaction,
} from "../../types";
import { buildCashflowEvents, calculateOpenSharedBalances, cashflowDayTotals, type CashflowEvent } from "./calendarModel";
import MarkRecurringPaymentDialog from "./MarkRecurringPaymentDialog";

type Props = {
  profile: Profile;
  userId: string;
  transactions: Transaction[];
  schedules: RecurringPayment[];
  sources: PaymentSource[];
  groups: Group[];
  members: GroupMember[];
  expenses: SharedExpense[];
  splits: ExpenseSplit[];
  settlements: Settlement[];
  setPage: (page: PageKey) => void;
  openTransaction: (transaction: Transaction) => void;
  reload: () => Promise<void>;
  notify: (message: string) => void;
};

function monthDate(month: string, day = 1) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day, 12));
}

function monthString(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, amount: number) {
  const date = monthDate(month);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return monthString(date);
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function displayDate(date: string) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

export default function CashflowCalendarPage({
  profile, userId, transactions, schedules, sources, groups, members, expenses, splits, settlements,
  setPage, openTransaction, reload, notify,
}: Props) {
  const today = dateInTimezone(new Date().toISOString(), profile.timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [plans, setPlans] = useState<LifeEventPlan[]>([]);
  const [costs, setCosts] = useState<LifeEventCost[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [error, setError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<CashflowEvent | null>(null);
  const [recurringToRecord, setRecurringToRecord] = useState<{ schedule: RecurringPayment; date: string } | null>(null);

  const reloadPlanningData = useCallback(async () => {
    if (!supabase) {
      setError("Supabase isn't configured.");
      setLoadingPlans(false);
      return;
    }
    setError("");
    setLoadingPlans(true);
    const [planResult, costResult] = await Promise.all([
      supabase.from("life_event_plans").select("*"),
      supabase.from("life_event_costs").select("*"),
    ]);
    const failure = planResult.error ?? costResult.error;
    if (failure) {
      setError(`Planned calendar items couldn't be loaded: ${failure.message}. Apply migration 005 to enable planning and the cash-flow calendar.`);
      setLoadingPlans(false);
      return;
    }
    setPlans(planResult.data ?? []);
    setCosts(costResult.data ?? []);
    setLoadingPlans(false);
  }, []);

  useEffect(() => { void reloadPlanningData(); }, [reloadPlanningData]);

  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const events = useMemo(() => buildCashflowEvents({
    from, to, timezone: profile.timezone, transactions, schedules, costs, plans, settlements, groups,
  }), [from, to, profile.timezone, transactions, schedules, costs, plans, settlements, groups]);
  const totals = useMemo(() => cashflowDayTotals(events), [events]);
  const selectedEvents = events.filter((event) => event.date === selectedDate);
  const openBalances = useMemo(
    () => calculateOpenSharedBalances(userId, groups, members, expenses, splits, settlements),
    [userId, groups, members, expenses, splits, settlements],
  );
  const monthExpectedIncome = events.filter((event) => event.status === "expected" && event.flow === "income").reduce((sum, event) => sum + event.amount, 0);
  const monthExpectedExpenses = events.filter((event) => event.status === "expected" && event.flow === "expense").reduce((sum, event) => sum + event.amount, 0);
  const monthRecordedIncome = events.filter((event) => event.status === "completed" && event.flow === "income").reduce((sum, event) => sum + event.amount, 0);
  const monthRecordedExpenses = events.filter((event) => event.status === "completed" && event.flow === "expense").reduce((sum, event) => sum + event.amount, 0);
  const overdueSchedules = schedules.filter((schedule) => schedule.enabled && schedule.next_due_on < today);
  const firstWeek = today;
  const lastWeek = shiftDay(today, 6);
  const nextSevenDays = events.filter((event) => event.status === "expected" && event.date >= firstWeek && event.date <= lastWeek);
  const firstWeekDay = monthDate(month).getUTCDay();
  const daysInMonth = Number(to.slice(8));
  const cellCount = Math.ceil((firstWeekDay + daysInMonth) / 7) * 7;
  const calendarCells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekDay + 1;
    return day > 0 && day <= daysInMonth ? `${month}-${String(day).padStart(2, "0")}` : null;
  });

  function changeMonth(value: string) {
    setMonth(value);
    const newLastDay = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0)).getUTCDate();
    const datePart = Math.min(Number(selectedDate.slice(8)), newLastDay);
    setSelectedDate(`${value}-${String(datePart).padStart(2, "0")}`);
  }

  async function recordSettlement(balance: (typeof openBalances)[number]) {
    if (!supabase) return;
    const confirmed = window.confirm(`Record ${formatCurrency(balance.amount, profile.currency)} paid to ${balance.counterpartyName} in ${balance.groupName}?`);
    if (!confirmed) return;
    const { error: settlementError } = await supabase.rpc("record_settlement", {
      p_group_id: balance.groupId,
      p_payee_id: balance.counterpartyId,
      p_amount: balance.amount,
      p_paid_at: new Date().toISOString(),
      p_note: "Recorded from cash-flow calendar",
    });
    if (settlementError) {
      notify(`Settlement couldn't be recorded: ${settlementError.message}`);
      return;
    }
    await reload();
    notify("Shared settlement recorded.");
  }

  function selectEvent(event: CashflowEvent) {
    setSelectedEvent(event);
  }

  function navigateForEvent(event: CashflowEvent) {
    setSelectedEvent(null);
    if (event.source === "life-event") setPage("Planning");
    else if (event.source === "recurring") setPage("Transactions");
    else if (event.source === "settlement") setPage("Shared expenses");
    else {
      const transactionId = event.id.replace("transaction:", "");
      const transaction = transactions.find((item) => item.id === transactionId);
      if (transaction) openTransaction(transaction);
    }
  }

  return (
    <>
      <PageHeading eyebrow="DATES, NOT GUESSES" title="Cash flow calendar" description="A view of money dates you've entered or scheduled. It is not a bank balance or guaranteed forecast." />
      {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-800"><span>{error}</span><button onClick={() => void reloadPlanningData()} className="font-semibold underline">Try again</button></div>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Expected income" value={formatCurrency(monthExpectedIncome, profile.currency)} note="Recurring income schedules" icon={ArrowDownLeft} tone="mint" />
        <SummaryCard title="Expected expenses" value={formatCurrency(monthExpectedExpenses, profile.currency)} note="Recurring and planned costs" icon={ArrowUpRight} tone="peach" />
        <SummaryCard title="Recorded income" value={formatCurrency(monthRecordedIncome, profile.currency)} note="Actual transactions in month" icon={Check} tone="mint" />
        <SummaryCard title="Recorded expenses" value={formatCurrency(monthRecordedExpenses, profile.currency)} note="Actual transactions in month" icon={Wallet} tone="lavender" />
      </div>
      {overdueSchedules.length > 0 && <Card className="mb-5 border-[#f0dfda]">
        <div className="mb-3"><h2 className="font-display text-sm font-bold">Past-due scheduled items</h2><p className="mt-1 text-[10px] text-muted">They remain expected until you confirm payment or receipt.</p></div>
        <div className="divide-y divide-line">{overdueSchedules.map((schedule) => <div key={schedule.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-[140px] flex-1"><p className="text-xs font-semibold">{schedule.title}</p><p className="mt-1 text-[10px] text-muted">Due {schedule.next_due_on} · {schedule.type}</p></div>
          <p className="text-xs font-semibold">{formatCurrency(schedule.amount, profile.currency)}</p>
          <button onClick={() => setRecurringToRecord({ schedule, date: schedule.next_due_on })} className="rounded-lg bg-forest px-3 py-2 text-[10px] font-semibold text-white">{schedule.type === "income" ? "Record received" : "Record paid"}</button>
        </div>)}</div>
      </Card>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(310px,.7fr)]">
        <Card className="!p-4 sm:!p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <button onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded-lg p-2 text-muted hover:bg-canvas"><ArrowLeft size={17} /></button>
            <h2 className="font-display text-base font-bold">{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthDate(month))}</h2>
            <button onClick={() => changeMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded-lg p-2 text-muted hover:bg-canvas"><ArrowRight size={17} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="py-2 text-center text-[10px] font-semibold text-muted">{day}</div>)}
            {calendarCells.map((date, index) => {
              const dateTotals = date ? totals[date] : undefined;
              const dayNum = date ? Number(date.slice(8)) : "";
              return (
                <button
                  key={date ?? `blank-${index}`}
                  disabled={!date}
                  onClick={() => date && setSelectedDate(date)}
                  aria-label={date ? `${displayDate(date)}${dateTotals ? `, ${dateTotals.incoming / 100} incoming, ${dateTotals.outgoing / 100} outgoing` : ""}` : undefined}
                  aria-pressed={date === selectedDate}
                  className={`min-h-[74px] rounded-xl border p-1.5 text-left transition sm:min-h-[86px] sm:p-2 ${!date ? "border-transparent" : date === selectedDate ? "border-forest bg-[#edf4ee]" : "border-line bg-white hover:bg-[#f8faf7]"} ${date === today ? "ring-1 ring-forest/40" : ""}`}
                >
                  {date && <>
                    <span className={`text-xs ${date === today ? "font-bold text-forest" : "font-medium"}`}>{dayNum}</span>
                    {dateTotals && <span className="mt-1 flex flex-col gap-0.5">
                      {dateTotals.incoming > 0 && <span className="truncate text-[8px] font-semibold text-forest sm:text-[9px]">+{formatCurrency(dateTotals.incoming / 100, profile.currency)}</span>}
                      {dateTotals.outgoing > 0 && <span className="truncate text-[8px] font-semibold text-[#b7654f] sm:text-[9px]">−{formatCurrency(dateTotals.outgoing / 100, profile.currency)}</span>}
                      {dateTotals.settlements > 0 && <span className="truncate text-[8px] text-muted sm:text-[9px]">{formatCurrency(dateTotals.settlements / 100, profile.currency)} settle</span>}
                    </span>}
                  </>}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-4 text-[10px] text-muted">
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#5b9b74]" /> Expected/received income</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#c8735b]" /> Expected/paid expense</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#8e96a0]" /> Settlements (not budget spending)</span>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <div className="mb-4 flex items-center justify-between gap-2">
              <div><h2 className="font-display text-base font-bold">{displayDate(selectedDate)}</h2><p className="mt-1 text-[10px] text-muted">Items due, planned, or recorded on this date</p></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf4ee] text-forest"><CalendarDays size={17} /></span>
            </div>
            {selectedEvents.length ? <div className="divide-y divide-line">{selectedEvents.map((event) => <EventRow key={event.id} event={event} currency={profile.currency} onOpen={() => selectEvent(event)} />)}</div> : <Empty title="Nothing scheduled" body="Recurring entries, planned costs, transactions, and settlements show up here when they have a date." />}
          </Card>
          <Card>
            <div className="mb-3 flex items-center gap-2"><Clock3 size={16} className="text-forest" /><div><h2 className="font-display text-sm font-bold">Coming up this week</h2><p className="mt-1 text-[10px] text-muted">Expected items only</p></div></div>
            {nextSevenDays.length ? <div className="divide-y divide-line">{nextSevenDays.slice(0, 5).map((event) => <EventRow key={event.id} event={event} currency={profile.currency} onOpen={() => selectEvent(event)} compact />)}</div> : <p className="py-5 text-center text-xs text-muted">No expected items in the next 7 days.</p>}
          </Card>
        </div>
      </div>
      <Card className="mt-5">
        <div className="mb-3"><h2 className="font-display text-base font-bold">Shared balances to settle</h2><p className="mt-1 text-xs text-muted">These have no due date unless your group agreed on one. Recording a payment adds a settlement record, not an income/expense.</p></div>
        {openBalances.length ? <div className="divide-y divide-line">{openBalances.map((balance) => <div key={`${balance.groupId}:${balance.counterpartyId}:${balance.direction}`} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-[140px] flex-1"><p className="text-xs font-semibold">{balance.direction === "pay" ? `You owe ${balance.counterpartyName}` : `${balance.counterpartyName} owes you`}</p><p className="mt-1 text-[10px] text-muted">{balance.groupName}</p></div>
          <p className="text-xs font-semibold">{formatCurrency(balance.amount, profile.currency)}</p>
          {balance.direction === "pay" ? <button onClick={() => void recordSettlement(balance)} className="rounded-lg bg-[#edf4ee] px-3 py-2 text-[10px] font-semibold text-forest">Record paid</button> : <button onClick={() => setPage("Shared expenses")} className="rounded-lg border border-line px-3 py-2 text-[10px] font-semibold text-muted">View group</button>}
        </div>)}</div> : <p className="py-5 text-center text-xs text-muted">No outstanding shared balances.</p>}
      </Card>
      {loadingPlans && <p className="mt-3 text-[10px] text-muted" role="status">Loading planned costs…</p>}
      {selectedEvent && <EventDetails event={selectedEvent} currency={profile.currency} transactions={transactions} schedules={schedules} canMarkPaid={selectedEvent.source === "recurring" && selectedEvent.date <= today} onClose={() => setSelectedEvent(null)} onManage={() => navigateForEvent(selectedEvent)} onMarkPaid={(schedule) => { setRecurringToRecord({ schedule, date: selectedEvent.date }); setSelectedEvent(null); }} />}
      {recurringToRecord && <MarkRecurringPaymentDialog schedule={recurringToRecord.schedule} occurrenceOn={recurringToRecord.date} sources={sources} currency={profile.currency} reload={async () => { await reload(); await reloadPlanningData(); }} notify={notify} close={() => setRecurringToRecord(null)} />}
    </>
  );
}

function SummaryCard({ title, value, note, icon: Icon, tone }: { title: string; value: string; note: string; icon: typeof Wallet; tone: string }) {
  return <Card className="!p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-muted">{title}</p><p className="mt-2 font-display text-xl font-bold">{value}</p><p className="mt-1 text-[10px] text-muted">{note}</p></div><span className={`grid h-9 w-9 place-items-center rounded-xl ${tone === "mint" ? "bg-[#edf4ee] text-forest" : tone === "peach" ? "bg-peach text-[#b27044]" : "bg-[#f0eef9] text-[#8171aa]"}`}><Icon size={17} /></span></div></Card>;
}

function EventRow({ event, currency, onOpen, compact = false }: { event: CashflowEvent; currency: string; onOpen: () => void; compact?: boolean }) {
  const income = event.flow === "income";
  return (
    <button onClick={onOpen} className={`flex w-full items-center gap-3 text-left hover:bg-[#fafbf9] ${compact ? "py-2.5" : "py-3"}`}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${event.status === "completed" ? "bg-[#edf4ee] text-forest" : "bg-[#f5f2e9] text-[#a17d3d]"}`}>
        {event.status === "completed" ? <Check size={14} /> : <Clock3 size={14} />}
      </span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{event.title}</span><span className="mt-1 block truncate text-[10px] text-muted">{event.note ?? event.source.replace("-", " ")} · {event.status}</span></span>
      <span className={`shrink-0 text-xs font-semibold ${income ? "text-forest" : event.flow === "settlement" ? "text-muted" : "text-ink"}`}>{income ? "+" : event.flow === "expense" ? "−" : ""}{formatCurrency(event.amount, currency)}</span>
    </button>
  );
}

function EventDetails({ event, currency, transactions, schedules, canMarkPaid, onClose, onManage, onMarkPaid }: {
  event: CashflowEvent;
  currency: string;
  transactions: Transaction[];
  schedules: RecurringPayment[];
  canMarkPaid: boolean;
  onClose: () => void;
  onManage: () => void;
  onMarkPaid: (schedule: RecurringPayment) => void;
}) {
  const scheduleId = event.source === "recurring" ? event.id.split(":")[1] : "";
  const schedule = schedules.find((item) => item.id === scheduleId);
  const transactionId = event.source === "transaction" ? event.id.replace("transaction:", "") : "";
  const transaction = transactions.find((item) => item.id === transactionId);
  return (
    <Modal title={event.title} description={displayDate(event.date)} close={onClose}>
      <div className="rounded-xl bg-[#f7f9f6] p-4">
        <p className="text-[10px] uppercase tracking-wide text-muted">{event.status} · {event.source.replace("-", " ")}</p>
        <p className="mt-1 font-display text-2xl font-bold">{formatCurrency(event.amount, currency)}</p>
        {event.note && <p className="mt-2 text-xs text-muted">{event.note}</p>}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted">
        {event.status === "expected" ? "This is an amount you entered or scheduled. It is not included in recorded transactions until you confirm it." : "This is an actual transaction or settlement you recorded."}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {event.source === "recurring" && schedule && canMarkPaid && event.date === schedule.next_due_on && (
          <button onClick={() => onMarkPaid(schedule)} className="flex items-center gap-2 rounded-lg bg-forest px-3 py-2.5 text-xs font-semibold text-white"><Check size={14} /> Mark as paid/received</button>
        )}
        {event.source === "transaction" && transaction && <button onClick={onManage} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-xs font-semibold text-forest"><Pencil size={14} /> Edit transaction</button>}
        {(event.source === "life-event" || event.source === "recurring" || event.source === "settlement") && <button onClick={onManage} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-xs font-semibold text-forest"><Pencil size={14} /> {event.source === "life-event" ? "Manage in Planning" : event.source === "recurring" ? "Manage schedule" : "Open shared expenses"}</button>}
      </div>
    </Modal>
  );
}
