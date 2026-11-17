import { useState, type FormEvent } from "react";
import { CalendarClock, Pencil, Plus, ReceiptText, Trash2 } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { Card, Empty, Field } from "../../components/ui/FinancePrimitives";
import { formatCurrency } from "../../lib/finance";
import { supabase } from "../../lib/supabase";
import type { Budget, Category, LifeEventCost, LifeEventPlan, Profile, PurchaseScenario, RecurringPayment, Transaction } from "../../types";
import { projectPurchaseScenario } from "./planningModel";

type Props = {
  profile: Profile;
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  schedules: RecurringPayment[];
  plans: LifeEventPlan[];
  costs: LifeEventCost[];
  scenarios: PurchaseScenario[];
  loading: boolean;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  recordPurchase: (scenario: PurchaseScenario) => void;
};

function nextMonthDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}-01T12:00:00Z`));
}

export default function PurchasePlanner(props: Props) {
  const { profile, categories, transactions, budgets, schedules, plans, costs, scenarios, loading, reload, notify, recordPurchase } = props;
  const [editing, setEditing] = useState<PurchaseScenario | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const amount = Number(form.get("amount"));
    const plannedOn = String(form.get("planned_on") ?? "");
    const categoryId = String(form.get("category_id") ?? "") || null;
    if (!title || !Number.isFinite(amount) || amount <= 0 || !plannedOn || !supabase) {
      setError("Enter a description, a positive amount, and a planned date.");
      return;
    }
    setBusy(true);
    setError("");
    const update = {
      title,
      amount: Math.round(amount * 100) / 100,
      planned_on: plannedOn,
      category_id: categoryId,
    };
    const result = editing
      ? await supabase.from("purchase_scenarios").update(update).eq("id", editing.id)
      : await supabase.from("purchase_scenarios").insert({ ...update, owner_id: profile.id });
    setBusy(false);
    if (result.error) {
      setError(`Scenario couldn't be saved: ${result.error.message}`);
      return;
    }
    setEditing(null);
    setFormOpen(false);
    await reload();
    notify(editing ? "Scenario updated." : "Purchase scenario saved.");
  }

  async function deleteScenario(scenario: PurchaseScenario) {
    if (!window.confirm(`Delete the “${scenario.title}” scenario? This won't affect transactions.`) || !supabase) return;
    const { error: deleteError } = await supabase.from("purchase_scenarios").delete().eq("id", scenario.id);
    if (deleteError) {
      notify(`Scenario couldn't be deleted: ${deleteError.message}`);
      return;
    }
    await reload();
    notify("Scenario deleted.");
  }

  const openNew = () => {
    setEditing(null);
    setError("");
    setFormOpen(true);
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Purchase “what if?”</h2>
          <p className="mt-1 text-xs text-muted">Explore a purchase before it becomes a transaction.</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 rounded-xl bg-forest px-3.5 py-2.5 text-xs font-semibold text-white">
          <Plus size={15} /> New scenario
        </button>
      </div>
      <p className="mb-4 rounded-xl border border-[#e5e9e4] bg-[#f7f9f6] p-3 text-xs leading-5 text-muted">
        Estimates use recorded spending in the selected month, enabled recurring entries due that month, planned costs from active life-event plans, and the monthly/category targets you set. These are estimates, not a bank balance or guaranteed forecast. Scenarios never change transactions or budgets.
      </p>
      {loading ? (
        <Card><div role="status" className="animate-pulse space-y-3"><div className="h-4 w-40 rounded bg-[#edf0ed]" /><div className="h-24 rounded-xl bg-[#f4f6f3]" /></div></Card>
      ) : scenarios.length ? (
        <div className="space-y-4">
          {scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              profile={profile}
              categories={categories}
              projection={(comparison) => projectPurchaseScenario(comparison, transactions, schedules, budgets, profile.monthly_budget, costs, plans, profile.timezone)}
              onEdit={() => { setEditing(scenario); setError(""); setFormOpen(true); }}
              onDelete={() => void deleteScenario(scenario)}
              onRecord={() => recordPurchase(scenario)}
            />
          ))}
        </div>
      ) : (
        <Card><Empty title="Try a purchase before you make it" body="Create a scenario to see its estimated effect on your monthly and category budgets." action={<button onClick={openNew} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">Create a scenario</button>} /></Card>
      )}
      {formOpen && (
        <Modal title={editing ? "Edit purchase scenario" : "Plan a purchase"} description="This stays separate from your real spending." close={() => setFormOpen(false)}>
          <form onSubmit={(event) => void saveScenario(event)} className="space-y-4">
            <Field label="Description"><input name="title" required maxLength={120} defaultValue={editing?.title ?? ""} placeholder="e.g. New headphones" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Purchase amount (${profile.currency})`}><input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editing?.amount ?? ""} /></Field>
              <Field label="Planned date"><input name="planned_on" type="date" required defaultValue={editing?.planned_on ?? new Date().toISOString().slice(0, 10)} /></Field>
            </div>
            <Field label="Category (optional)">
              <select name="category_id" defaultValue={editing?.category_id ?? ""}>
                <option value="">No category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
              </select>
            </Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button>
              <button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save scenario"}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ScenarioCard({ scenario, profile, categories, projection, onEdit, onDelete, onRecord }: {
  scenario: PurchaseScenario;
  profile: Profile;
  categories: Category[];
  projection: (scenario: Pick<PurchaseScenario, "amount" | "planned_on" | "category_id">) => ReturnType<typeof projectPurchaseScenario>;
  onEdit: () => void;
  onDelete: () => void;
  onRecord: () => void;
}) {
  const [alternateAmount, setAlternateAmount] = useState(String(scenario.amount));
  const [alternateDate, setAlternateDate] = useState(nextMonthDate(scenario.planned_on));
  const currentEstimate = projection(scenario);
  const comparisonAmount = Number(alternateAmount);
  const alternateEstimate = Number.isFinite(comparisonAmount) && comparisonAmount > 0
    ? projection({ ...scenario, amount: comparisonAmount, planned_on: alternateDate })
    : null;
  const category = categories.find((item) => item.id === scenario.category_id);
  const scenarioAsAlternate = alternateEstimate && comparisonAmount === scenario.amount && alternateDate !== scenario.planned_on;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf4ee] text-forest"><CalendarClock size={18} /></span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{scenario.title}</h3>
            <p className="mt-1 text-[11px] text-muted">{category?.name ?? "Uncategorized"} · {scenario.planned_on}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} aria-label={`Edit ${scenario.title}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><Pencil size={15} /></button>
          <button onClick={onDelete} aria-label={`Delete ${scenario.title}`} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ProjectionResult amount={scenario.amount} projection={currentEstimate} currency={profile.currency} label={`Planned scenario · ${monthLabel(currentEstimate.month)}`} />
        {alternateEstimate && <ProjectionResult amount={comparisonAmount} projection={alternateEstimate} currency={profile.currency} label={`${scenarioAsAlternate ? "Same purchase, different month" : "Alternative"} · ${monthLabel(alternateEstimate.month)}`} />}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label={`Compare amount (${profile.currency})`}><input aria-label="Alternative purchase amount" type="number" min="0.01" step="0.01" value={alternateAmount} onChange={(event) => setAlternateAmount(event.target.value)} className="w-full sm:w-40" /></Field>
        <Field label="Compare date"><input aria-label="Alternative purchase date" type="date" value={alternateDate} onChange={(event) => setAlternateDate(event.target.value)} /></Field>
        <button onClick={onRecord} className="ml-auto flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-xs font-semibold text-forest hover:bg-[#f4f8f4]">
          <ReceiptText size={14} /> Record as transaction
        </button>
      </div>
    </Card>
  );
}

function ProjectionResult({ amount, projection, currency, label }: {
  amount: number;
  projection: ReturnType<typeof projectPurchaseScenario>;
  currency: string;
  label: string;
}) {
  return (
    <div className="rounded-xl bg-[#f7f9f6] p-4">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{label}</p><p className="text-xs font-semibold">{formatCurrency(amount, currency)} purchase</p></div>
      <p className="mt-3 text-[10px] text-muted">Estimated monthly budget remaining after purchase</p>
      <p className={`mt-1 text-lg font-bold ${projection.projectedRemaining < 0 ? "text-[#bd634e]" : "text-forest"}`}>{formatCurrency(projection.projectedRemaining, currency)}</p>
      <p className="mt-2 text-[10px] leading-4 text-muted">
        Includes {formatCurrency(projection.actualSpent, currency)} recorded expenses, {formatCurrency(projection.recurringExpense, currency)} recurring expenses, and {formatCurrency(projection.plannedLifeEventCosts, currency)} planned life-event costs. Recurring income estimated: {formatCurrency(projection.recurringIncome, currency)}.
      </p>
      {projection.categoryLimit !== null && projection.categoryRemaining !== null && (
        <p className={`mt-2 border-t border-line pt-2 text-[10px] font-medium ${projection.categoryRemaining < 0 ? "text-[#bd634e]" : "text-muted"}`}>
          {formatCurrency(projection.categoryRemaining, currency)} remaining in category budget ({formatCurrency(projection.categoryLimit, currency)} limit; {formatCurrency(projection.categorySpent ?? 0, currency)} before purchase)
        </p>
      )}
      <p className="mt-2 text-[9px] text-[#929c94]">Monthly target used: {formatCurrency(projection.limit, currency)}. No unentered income or bank balances are assumed.</p>
    </div>
  );
}
