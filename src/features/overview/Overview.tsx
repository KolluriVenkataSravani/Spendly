import { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronRight, Plus, Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, Empty, PageHeading } from "../../components/ui/FinancePrimitives";
import {
  amountInMinorUnits, budgetProgress, categorySpending, dateInTimezone, formatCurrency,
  monthBounds, sumByType, transactionsInMonth,
} from "../../lib/finance";
import type { Budget, Category, ExpenseSplit, Group, PageKey, PaymentSource, Profile, Settlement, SharedExpense, Transaction, TransactionPaymentMethod, TransactionType } from "../../types";

const methodLabels: Record<TransactionPaymentMethod, string> = {
  cash: "Cash", credit_card: "Credit card", debit_card: "Debit card", upi: "UPI", shared: "Shared split",
};

function monthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function addMonth(month: string, delta: number) {
  const date = new Date(`${month}T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  return monthInput(date);
}

function dateLabel(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(value));
}

export function Overview({ profile, userId, transactions, categories, sources, budgets, expenses, splits, settlements, groups, openTransaction, setPage }: {
  profile: Profile;
  userId: string;
  transactions: Transaction[];
  categories: Category[];
  sources: PaymentSource[];
  budgets: Budget[];
  expenses: SharedExpense[];
  splits: ExpenseSplit[];
  settlements: Settlement[];
  groups: Group[];
  openTransaction: () => void;
  setPage: (page: PageKey) => void;
}) {
  const [range, setRange] = useState("7d");
  const [chartType, setChartType] = useState<TransactionType>("expense");
  const now = new Date();
  const { start } = monthBounds(now, profile.timezone);
  const previousMonth = addMonth(start, -1);
  const thisMonthItems = transactionsInMonth(transactions, start, profile.timezone);
  const previousMonthSpent = sumByType(transactionsInMonth(transactions, previousMonth, profile.timezone), "expense");
  const spent = sumByType(thisMonthItems, "expense");
  const income = sumByType(thisMonthItems, "income");
  const budget = budgets.find((item) => item.month_start === start && !item.category_id);
  const totalBudget = budget?.amount ?? profile.monthly_budget;
  const remaining = totalBudget - spent;
  const savings = previousMonthSpent ? (spent - previousMonthSpent) / previousMonthSpent * 100 : null;
  const chartData = useMemo(() => makeTrend(transactions, range, profile.timezone, chartType), [transactions, range, profile.timezone, chartType]);
  const breakdown = categorySpending(thisMonthItems, categories, chartType).slice(0, 5);
  const sharedBalances = new Map<string, number>();
  for (const expense of expenses) {
    for (const split of splits.filter((entry) => entry.expense_id === expense.id)) sharedBalances.set(`${expense.group_id}:${split.user_id}`, (sharedBalances.get(`${expense.group_id}:${split.user_id}`) ?? 0) + amountInMinorUnits(split.amount_owed));
    if (expense.paid_by) sharedBalances.set(`${expense.group_id}:${expense.paid_by}`, (sharedBalances.get(`${expense.group_id}:${expense.paid_by}`) ?? 0) - amountInMinorUnits(expense.amount));
  }
  for (const settlement of settlements) {
    sharedBalances.set(`${settlement.group_id}:${settlement.payer_id}`, (sharedBalances.get(`${settlement.group_id}:${settlement.payer_id}`) ?? 0) - amountInMinorUnits(settlement.amount));
    sharedBalances.set(`${settlement.group_id}:${settlement.payee_id}`, (sharedBalances.get(`${settlement.group_id}:${settlement.payee_id}`) ?? 0) + amountInMinorUnits(settlement.amount));
  }
  const upcoming = [...sharedBalances]
    .filter(([key, value]) => key.endsWith(`:${userId}`) && value > 0)
    .slice(0, 3)
    .map(([key, balance]) => {
      const groupId = key.slice(0, key.lastIndexOf(":"));
      return { id: groupId, title: groups.find((group) => group.id === groupId)?.name ?? "Shared group", amount: balance / 100 };
    });
  const amount = (value: number) => formatCurrency(value, profile.currency);
  return <>
    <PageHeading eyebrow={new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(now)} title="Your money, at a glance" description="A little clarity for the choices ahead." action={<button onClick={openTransaction} className="hidden items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#17573f] sm:flex"><Plus size={17} /> Add transaction</button>} />
    {transactions.length === 0 && <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#d8e9dc] bg-[#edf6ef] p-5"><div><p className="font-semibold">Your first step is the easiest.</p><p className="mt-1 text-sm text-[#667d6c]">Add a transaction to start seeing your money story take shape.</p></div><button onClick={openTransaction} className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white">Add your first transaction</button></div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Spent this month" value={amount(spent)} icon={ArrowUpRight} iconTone="peach" foot={savings === null ? "Your month is just getting started" : `${Math.abs(savings).toFixed(0)}% ${savings <= 0 ? "less" : "more"} than last month`} positive={savings === null || savings <= 0} />
      <Metric title="Budget remaining" value={amount(remaining)} icon={Wallet} iconTone="mint" foot={`${amount(totalBudget)} monthly target`} positive={remaining >= 0} />
      <Metric title="Income this month" value={amount(income)} icon={ArrowDownLeft} iconTone="mint" foot="Recorded income" positive />
      <Metric title="Previous month" value={amount(previousMonthSpent)} icon={CalendarDays} iconTone="lavender" foot="Total expenses" />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <Card>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-base font-bold">{chartType === "expense" ? "Spending over time" : "Income over time"}</h2><p className="mt-1 text-xs text-muted">Your daily {chartType === "expense" ? "expenses" : "income"}, in {profile.currency}</p></div><div className="flex items-center gap-2"><select aria-label="Chart transaction type" value={chartType} onChange={(event) => setChartType(event.target.value as TransactionType)} className="rounded-lg border-line py-1.5 pl-3 pr-8 text-xs font-medium text-[#5b685f]"><option value="expense">Expenses</option><option value="income">Income</option></select><select aria-label="Spending chart date range" value={range} onChange={(event) => setRange(event.target.value)} className="rounded-lg border-line py-1.5 pl-3 pr-8 text-xs font-medium text-[#5b685f]"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select></div></div>
        <div className="h-[245px] w-full">
          {!chartData.some((item) => item.amount > 0) ? <Empty title={`No ${chartType === "expense" ? "spending" : "income"} in this range`} body={`Add an ${chartType === "expense" ? "expense" : "income"} transaction to see it here.`} /> :
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 3, left: -20, bottom: 0 }}><defs><linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartType === "expense" ? "#4a9a70" : "#6f83b1"} stopOpacity={0.18} /><stop offset="95%" stopColor={chartType === "expense" ? "#4a9a70" : "#6f83b1"} stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0ed" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} minTickGap={20} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} tickFormatter={(value: number) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value)} /><Tooltip formatter={(value: number) => [amount(value), chartType === "expense" ? "Spent" : "Income"]} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 12 }} /><Area type="monotone" dataKey="amount" stroke={chartType === "expense" ? "#35825a" : "#6f83b1"} strokeWidth={2.2} fill="url(#spendFill)" activeDot={{ r: 4, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer>}
        </div>
      </Card>
      <Card>
        <div className="mb-4 flex items-start justify-between"><div><h2 className="font-display text-base font-bold">{chartType === "expense" ? "Where it goes" : "Income sources"}</h2><p className="mt-1 text-xs text-muted">This month's {chartType === "expense" ? "spending" : "income"}</p></div><button onClick={() => setPage("Analytics")} aria-label="View all analytics" className="rounded-lg p-1.5 text-muted hover:bg-canvas"><ChevronRight size={17} /></button></div>
        {!breakdown.length ? <Empty title={`No categorized ${chartType === "expense" ? "spending" : "income"} yet`} body="Categorize a transaction to see the breakdown." /> : <>
          <div className="h-[165px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="amount" nameKey="category.name" innerRadius={48} outerRadius={72} paddingAngle={3} stroke="none">{breakdown.map((item) => <Cell key={item.category.id} fill={item.category.color} />)}</Pie><Tooltip formatter={(value: number) => amount(value)} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 12 }} /></PieChart></ResponsiveContainer></div>
          <div className="space-y-3">{breakdown.slice(0, 4).map(({ category, amount: total }) => <div key={category.id} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</span><span className="font-semibold">{amount(total)}</span></div>)}</div>
        </>}
      </Card>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card className="!p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6"><div><h2 className="font-display text-base font-bold">Recent transactions</h2><p className="mt-1 text-xs text-muted">Your latest money moves</p></div><button onClick={() => setPage("Transactions")} className="text-xs font-semibold text-forest hover:underline">See all</button></div>
        <div className="divide-y divide-line">{transactions.slice(0, 5).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} category={categories.find((category) => category.id === transaction.category_id)} source={sources.find((source) => source.id === transaction.payment_source_id)?.label} currency={profile.currency} timezone={profile.timezone} />)}
          {!transactions.length && <Empty title="No transactions yet" body="Add your first purchase or income to see it here." action={<button onClick={openTransaction} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">Add transaction</button>} />}
        </div>
      </Card>
      <Card>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-base font-bold">Budget check-in</h2><p className="mt-1 text-xs text-muted">A gentle look at your limits</p></div><button onClick={() => setPage("Budgets")} className="text-xs font-semibold text-forest hover:underline">Manage</button></div>
        <div className="mb-5"><BudgetLine title="Overall monthly budget" spent={spent} limit={totalBudget} currency={profile.currency} /></div>
        {budgets.filter((item) => item.month_start === start && item.category_id).slice(0, 3).map((item) => <div className="mb-4" key={item.id}><BudgetLine title={categories.find((category) => category.id === item.category_id)?.name ?? "Category"} spent={budgetProgress(transactions, item, item.category_id, profile.timezone).spent} limit={item.amount} currency={profile.currency} /></div>)}
        {budgets.filter((item) => item.month_start === start && item.category_id).length === 0 && <p className="border-t border-line pt-4 text-xs leading-5 text-muted">Set category limits to keep an eye on the areas that matter most.</p>}
      </Card>
    </div>
    {!!upcoming.length && <Card className="mt-5"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-display text-base font-bold">Shared expenses to settle</h2><p className="mt-1 text-xs text-muted">A friendly reminder for your groups</p></div><button onClick={() => setPage("Shared expenses")} className="text-xs font-semibold text-forest hover:underline">Open groups</button></div>{upcoming.map((expense) => <div key={expense.id} className="flex items-center justify-between border-t border-line py-3 text-sm"><span>{expense.title}</span><span className="font-semibold">{amount(expense.amount)}</span></div>)}</Card>}
  </>;
}

function makeTrend(transactions: Transaction[], range: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, type: TransactionType = "expense") {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const todayKey = dateInTimezone(new Date().toISOString(), timezone);
  const [year, month, day] = todayKey.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const values = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== type) continue;
    const key = dateInTimezone(transaction.occurred_at, timezone);
    values.set(key, (values.get(key) ?? 0) + amountInMinorUnits(transaction.amount));
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (days - 1 - index));
    const key = date.toISOString().slice(0, 10);
    return { label: new Intl.DateTimeFormat("en", { month: "short", day: days > 30 ? undefined : "numeric", timeZone: "UTC" }).format(date), amount: (values.get(key) ?? 0) / 100 };
  });
}

export function makeAnalyticsTrend(transactions: Transaction[], days: number, timezone: string, type: TransactionType) {
  if (days <= 90) return makeTrend(transactions, days <= 30 ? "30d" : "90d", timezone, transactions[0]?.type ?? "expense");
  const currentMonth = monthBounds(new Date(), timezone).start;
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== type) continue;
    const key = dateInTimezone(transaction.occurred_at, timezone).slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + amountInMinorUnits(transaction.amount));
  }
  return Array.from({ length: 12 }, (_, index) => {
    const key = addMonth(currentMonth, index - 11).slice(0, 7);
    const date = new Date(`${key}-01T12:00:00Z`);
    return { label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date), amount: (totals.get(key) ?? 0) / 100 };
  });
}

export function Metric({ title, value, icon: Icon, iconTone, foot, positive }: { title: string; value: string; icon: LucideIcon; iconTone: string; foot: string; positive?: boolean }) {
  return <Card className="!p-4 sm:!p-5"><div className="flex items-start justify-between"><p className="text-xs font-medium text-muted">{title}</p><span className={`grid h-8 w-8 place-items-center rounded-xl ${iconTone === "mint" ? "bg-mint text-forest" : iconTone === "peach" ? "bg-peach text-[#b27044]" : "bg-[#f0eef9] text-[#8171aa]"}`}><Icon size={16} /></span></div><p className="mt-3 font-display text-[23px] font-bold tracking-tight">{value}</p><p className={`mt-1 text-[10px] ${positive === false ? "text-[#be7658]" : "text-muted"}`}>{foot}</p></Card>;
}

export function TransactionRow({ transaction, category, source, currency, timezone }: { transaction: Transaction; category?: Category; source?: string; currency: string; timezone?: string }) {
  return <div className="grid min-w-0 w-full grid-cols-[2.25rem_minmax(0,1fr)_minmax(6.5rem,auto)] items-center gap-3 px-4 py-3.5 sm:px-5">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm" style={{ background: category?.color ? `${category.color}20` : "#f1f3f1", color: category?.color ?? "#718077" }}>{category?.icon ?? (transaction.type === "income" ? "↙" : "◦")}</span>
    <div className="min-w-0 flex-1"><p className="flex items-center gap-1.5 truncate text-xs font-semibold">{transaction.title}{(transaction.shared_expense_id || transaction.recurring_payment_id) && <span className="rounded-full bg-[#f2f4f2] px-1.5 py-0.5 text-[8px] font-medium text-muted">{transaction.shared_expense_id ? "Shared" : "Recurring"}</span>}</p><p className="mt-0.5 truncate text-[10px] text-muted">{category?.name ?? "Uncategorized"} · {methodLabels[transaction.payment_method]}{source ? ` · ${source}` : ""}</p></div>
    <div className="min-w-0 text-right"><p className={`truncate text-xs font-semibold ${transaction.type === "income" ? "text-forest" : "text-ink"}`}>{transaction.type === "income" ? "+" : "−"}{formatCurrency(transaction.amount, currency)}</p><p className="mt-0.5 truncate text-[10px] text-muted">{dateLabel(transaction.occurred_at, timezone)}</p></div>
  </div>;
}

export function BudgetLine({ title, spent, limit, currency }: { title: string; spent: number; limit: number; currency: string }) {
  const percent = limit > 0 ? Math.min(100, spent / limit * 100) : 0;
  const exceeded = spent > limit;
  return <div><div className="mb-1.5 flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium">{title}</span><span className="shrink-0 text-muted">{formatCurrency(spent, currency)} <span className="text-[#b0b8b2]">/</span> {formatCurrency(limit, currency)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#edf0ed]"><div className={`h-full rounded-full transition-all ${exceeded ? "bg-[#d47c61]" : percent >= 80 ? "bg-[#d6a25f]" : "bg-[#5a9a70]"}`} style={{ width: `${percent}%` }} /></div><p className={`mt-1 text-[10px] ${exceeded ? "text-[#bc6950]" : "text-muted"}`}>{exceeded ? `${formatCurrency(spent - limit, currency)} over target` : `${Math.round(percent)}% used`}</p></div>;
}
