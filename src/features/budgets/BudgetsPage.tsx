import { useState, type FormEvent } from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, Wallet, X } from "lucide-react";
import { Card, Empty, PageHeading } from "../../components/ui/FinancePrimitives";
import { BudgetLine, Metric } from "../overview/Overview";
import { budgetProgress, formatCurrency, monthBounds, sumByType, transactionsInMonth } from "../../lib/finance";
import { supabase } from "../../lib/supabase";
import type { Budget, Category, Profile, Transaction } from "../../types";

function monthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function addMonth(month: string, delta: number) {
  const date = new Date(`${month}T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  return monthInput(date);
}

export default function BudgetsPage({ profile, updateProfile, budgets, transactions, categories, currency, reload, notify }: {
  profile: Profile;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  budgets: Budget[];
  transactions: Transaction[];
  categories: Category[];
  currency: string;
  reload: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [month, setMonth] = useState(monthBounds(new Date(), profile.timezone).start);
  const [overallValue, setOverallValue] = useState("");
  const [categoryValue, setCategoryValue] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = budgets.find((item) => item.month_start === month && !item.category_id);
  const overallLimit = Number(current?.amount ?? profile.monthly_budget);
  const monthTransactions = transactionsInMonth(transactions, month, profile.timezone);
  const overall = budgetProgress(transactions, { month_start: month, category_id: null, amount: overallLimit } as Budget, null, profile.timezone);
  const categoriesWithBudgets = budgets.filter((item) => item.month_start === month && item.category_id);
  const monthTitle = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(`${month}T00:00:00`));
  const spent = sumByType(monthTransactions, "expense");
  const income = sumByType(monthTransactions, "income");
  const previousMonthSpent = sumByType(transactionsInMonth(transactions, addMonth(month, -1), profile.timezone), "expense");
  const monthChange = previousMonthSpent > 0 ? (spent - previousMonthSpent) / previousMonthSpent * 100 : null;

  async function saveOverall(event: FormEvent) {
    event.preventDefault();
    const value = Number(overallValue);
    if (!Number.isFinite(value) || value <= 0 || !supabase) { setError("Enter a monthly target above zero."); return; }
    setBusy(true); setError("");
    try {
      if (current) {
        const { error: saveError } = await supabase.from("budgets").update({ amount: value }).eq("id", current.id);
        if (saveError) throw saveError;
      } else {
        const { error: saveError } = await supabase.from("budgets").insert({ owner_id: profile.id, month_start: month, category_id: null, amount: value });
        if (saveError) throw saveError;
      }
      if (month.slice(0, 7) === monthInput(new Date()).slice(0, 7)) await updateProfile({ monthly_budget: value });
      setOverallValue(""); await reload(); notify("Monthly budget updated.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The budget couldn't be saved."); }
    finally { setBusy(false); }
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    const value = Number(categoryValue);
    if (!categoryId || !Number.isFinite(value) || value <= 0 || !supabase) { setError("Choose a category and set a limit above zero."); return; }
    setBusy(true); setError("");
    const existing = categoriesWithBudgets.find((item) => item.category_id === categoryId);
    const result = existing
      ? await supabase.from("budgets").update({ amount: value }).eq("id", existing.id)
      : await supabase.from("budgets").insert({ owner_id: profile.id, month_start: month, category_id: categoryId, amount: value });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    setCategoryValue(""); setCategoryId(""); await reload(); notify("Category limit saved.");
  }

  async function removeCategoryBudget(budget: Budget) {
    if (!window.confirm("Remove this category limit? Your transactions will not be affected.")) return;
    if (!supabase) return;
    const { error: deleteError } = await supabase.from("budgets").delete().eq("id", budget.id);
    if (deleteError) { setError(deleteError.message); return; }
    await reload(); notify("Category limit removed.");
  }

  const remaining = overallLimit - spent;
  return <>
    <PageHeading eyebrow="PLAN WITH INTENTION" title="Budgets" description="Set a gentle guardrail. Your actual spending always comes from your transactions." action={<div className="flex items-center gap-1 rounded-xl border border-line bg-white p-1"><button onClick={() => setMonth((value) => addMonth(value, -1))} aria-label="Previous month" className="rounded-lg p-2 text-muted hover:bg-canvas"><ChevronLeft size={17} /></button><span className="min-w-[118px] text-center text-xs font-semibold">{monthTitle}</span><button disabled={month >= monthInput(new Date())} onClick={() => setMonth((value) => addMonth(value, 1))} aria-label="Next month" className="rounded-lg p-2 text-muted hover:bg-canvas disabled:opacity-30"><ChevronRight size={17} /></button></div>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Spent this month" value={formatCurrency(spent, currency)} icon={ArrowUpRight} iconTone="peach" foot="Actual expense transactions" />
      <Metric title="Budget remaining" value={formatCurrency(remaining, currency)} icon={Wallet} iconTone="mint" foot={remaining < 0 ? `${formatCurrency(Math.abs(remaining), currency)} above target` : "Compared with your target"} positive={remaining >= 0} />
      <Metric title="Income recorded" value={formatCurrency(income, currency)} icon={ArrowDownLeft} iconTone="lavender" foot="Not counted against budget" positive />
      <Metric title="Compared with last month" value={monthChange === null ? "—" : `${Math.abs(monthChange).toFixed(0)}% ${monthChange <= 0 ? "less" : "more"}`} icon={Activity} iconTone="mint" foot={monthChange === null ? "No previous month activity" : `${formatCurrency(previousMonthSpent, currency)} last month`} positive={monthChange === null || monthChange <= 0} />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
      <div className="space-y-5">
        <Card><div className="mb-5 flex items-center justify-between"><div><h2 className="font-display text-base font-bold">Overall monthly limit</h2><p className="mt-1 text-xs text-muted">The target for all expense categories</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${overall.percent >= 100 ? "bg-red-50 text-red-700" : overall.percent >= 80 ? "bg-amber-50 text-amber-700" : "bg-mint text-forest"}`}>{overall.percent >= 100 ? "Over limit" : overall.percent >= 80 ? "Approaching" : "On track"}</span></div>
          <div className="mb-5"><BudgetLine title={monthTitle} spent={spent} limit={overallLimit} currency={currency} /></div>
          <form onSubmit={(event) => void saveOverall(event)} className="flex flex-wrap gap-2 border-t border-line pt-4"><label className="min-w-[170px] flex-1 text-xs font-semibold text-muted">Set {monthTitle} target<input type="number" step="0.01" min="0.01" value={overallValue} onChange={(event) => setOverallValue(event.target.value)} placeholder={String(overallLimit)} className="mt-1.5 block w-full rounded-lg border-line text-sm text-ink" /></label><button disabled={busy} className="self-end rounded-lg bg-forest px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60">Update target</button></form>
        </Card>
        <Card><div className="mb-4"><h2 className="font-display text-base font-bold">Category limits</h2><p className="mt-1 text-xs text-muted">Optional targets for the areas you care about most.</p></div>
          {categoriesWithBudgets.length ? <div className="mb-5 space-y-4">{categoriesWithBudgets.map((item) => {
            const category = categories.find((entry) => entry.id === item.category_id);
            const progress = budgetProgress(transactions, item, item.category_id, profile.timezone);
            return <div key={item.id} className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: `${category?.color ?? "#5B9B74"}20`, color: category?.color }}>{category?.icon ?? "✦"}</span><div className="min-w-0 flex-1"><BudgetLine title={category?.name ?? "Category"} spent={progress.spent} limit={item.amount} currency={currency} /></div><button onClick={() => void removeCategoryBudget(item)} aria-label={`Remove ${category?.name ?? "category"} budget`} className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"><X size={15} /></button></div>;
          })}</div> : <Empty title="No category limits yet" body="Create a focused limit for groceries, transport, or another category." />}
          <form onSubmit={(event) => void saveCategory(event)} className="flex flex-wrap gap-2 border-t border-line pt-4"><select aria-label="Choose category for a budget" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="min-w-[140px] flex-1 rounded-lg border-line text-xs"><option value="">Choose category</option>{categories.filter((category) => !categoriesWithBudgets.some((budget) => budget.category_id === category.id)).map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}</select><input aria-label="Category budget amount" type="number" min="0.01" step="0.01" placeholder="Limit amount" value={categoryValue} onChange={(event) => setCategoryValue(event.target.value)} className="w-32 rounded-lg border-line text-xs" /><button disabled={busy} className="rounded-lg bg-[#edf4ee] px-3 py-2 text-xs font-semibold text-forest">Add limit</button></form>
        </Card>
      </div>
      <Card><h2 className="font-display text-base font-bold">A note on budgets</h2><div className="mt-4 space-y-4 text-xs leading-5 text-muted"><p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-forest" /> Spent is calculated from expense transactions recorded in this month only.</p><p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-forest" /> Income is tracked separately and never reduces your spending total.</p><p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-forest" /> Category spending is included in the overall total—not added on top of it.</p><p className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-forest" /> Your monthly target is a guide, not a judgment. Adjust it as life changes.</p></div>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}</Card>
    </div>
  </>;
}
