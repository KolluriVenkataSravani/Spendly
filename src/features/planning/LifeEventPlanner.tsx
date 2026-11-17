import { useMemo, useState, type FormEvent } from "react";
import { Archive, CalendarDays, Check, Pencil, Plus, Trash2 } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { Card, Empty, Field } from "../../components/ui/FinancePrimitives";
import { formatCurrency } from "../../lib/finance";
import { supabase } from "../../lib/supabase";
import type { Category, LifeEventCost, LifeEventPlan, PaymentSource, Profile, Transaction } from "../../types";
import RecordLifeEventCostDialog from "./RecordLifeEventCostDialog";
import { calculateLifeEventProgress } from "./planningModel";

type Props = {
  profile: Profile;
  categories: Category[];
  sources: PaymentSource[];
  transactions: Transaction[];
  plans: LifeEventPlan[];
  costs: LifeEventCost[];
  loading: boolean;
  reload: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  notify: (message: string) => void;
};

type PlanDraft = Pick<LifeEventPlan, "name" | "target_amount" | "target_on">;
type CostDraft = Pick<LifeEventCost, "title" | "amount" | "planned_on" | "category_id">;

export default function LifeEventPlanner({ profile, categories, sources, transactions, plans, costs, loading, reload, refreshTransactions, notify }: Props) {
  const [planEditor, setPlanEditor] = useState<LifeEventPlan | "new" | null>(null);
  const [costEditor, setCostEditor] = useState<{ planId: string; cost: LifeEventCost | null } | null>(null);
  const [recordingCost, setRecordingCost] = useState<LifeEventCost | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const costsByPlan = useMemo(() => {
    const map = new Map<string, LifeEventCost[]>();
    for (const cost of costs) map.set(cost.plan_id, [...(map.get(cost.plan_id) ?? []), cost]);
    return map;
  }, [costs]);

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const data = new FormData(event.currentTarget);
    const plan: PlanDraft = {
      name: String(data.get("name") ?? "").trim(),
      target_amount: Math.round(Number(data.get("target_amount")) * 100) / 100,
      target_on: String(data.get("target_on") ?? ""),
    };
    if (!plan.name || !Number.isFinite(plan.target_amount) || plan.target_amount <= 0 || !plan.target_on) {
      setError("Enter a plan name, positive target, and target date.");
      return;
    }
    setBusy(true);
    setError("");
    const current = planEditor !== "new" ? planEditor : null;
    const result = current
      ? await supabase.from("life_event_plans").update(plan).eq("id", current.id)
      : await supabase.from("life_event_plans").insert({ ...plan, owner_id: profile.id });
    setBusy(false);
    if (result.error) {
      setError(`The plan couldn't be saved: ${result.error.message}`);
      return;
    }
    setPlanEditor(null);
    await reload();
    notify(current ? "Life-event plan updated." : "Life-event plan created.");
  }

  async function saveCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !costEditor) return;
    const data = new FormData(event.currentTarget);
    const cost: CostDraft = {
      title: String(data.get("title") ?? "").trim(),
      amount: Math.round(Number(data.get("amount")) * 100) / 100,
      planned_on: String(data.get("planned_on") ?? ""),
      category_id: String(data.get("category_id") ?? "") || null,
    };
    if (!cost.title || !Number.isFinite(cost.amount) || cost.amount <= 0 || !cost.planned_on) {
      setError("Enter a cost description, positive estimate, and date.");
      return;
    }
    setBusy(true);
    setError("");
    const result = costEditor.cost
      ? await supabase.from("life_event_costs").update(cost).eq("id", costEditor.cost.id).eq("status", "planned")
      : await supabase.from("life_event_costs").insert({ ...cost, plan_id: costEditor.planId });
    setBusy(false);
    if (result.error) {
      setError(`The planned cost couldn't be saved: ${result.error.message}`);
      return;
    }
    setCostEditor(null);
    await reload();
    notify(costEditor.cost ? "Planned cost updated." : "Planned cost added.");
  }

  async function deleteCost(cost: LifeEventCost) {
    if (!window.confirm(`Remove “${cost.title}” from this plan?`) || !supabase) return;
    const { error: deleteError } = await supabase.from("life_event_costs").delete().eq("id", cost.id).eq("status", "planned");
    if (deleteError) {
      notify(`The planned cost couldn't be removed: ${deleteError.message}`);
      return;
    }
    await reload();
    notify("Planned cost removed.");
  }

  async function updatePlan(plan: LifeEventPlan, updates: Partial<LifeEventPlan>, successMessage: string) {
    if (!supabase) return;
    const { error: updateError } = await supabase.from("life_event_plans").update(updates).eq("id", plan.id);
    if (updateError) {
      notify(`The plan couldn't be updated: ${updateError.message}`);
      return;
    }
    await reload();
    notify(successMessage);
  }

  const activePlans = plans.filter((plan) => plan.status === "active");
  const archivedPlans = plans.filter((plan) => plan.status !== "active");
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Life-event plans</h2>
          <p className="mt-1 text-xs text-muted">Shape the costs of a trip, move, wedding, education, or other milestone.</p>
        </div>
        <button onClick={() => { setError(""); setPlanEditor("new"); }} className="flex items-center gap-2 rounded-xl bg-forest px-3.5 py-2.5 text-xs font-semibold text-white"><Plus size={15} /> New plan</button>
      </div>
      <p className="mb-4 rounded-xl border border-[#e5e9e4] bg-[#f7f9f6] p-3 text-xs leading-5 text-muted">
        Estimates and set-aside amounts are planning notes, not account balances. Costs stay out of transactions and cash-flow totals until you explicitly record an actual expense.
      </p>
      {error && !planEditor && !costEditor && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {loading ? (
        <Card><div role="status" className="animate-pulse space-y-3"><div className="h-4 w-40 rounded bg-[#edf0ed]" /><div className="h-24 rounded-xl bg-[#f4f6f3]" /></div></Card>
      ) : activePlans.length ? (
        <div className="space-y-4">
          {activePlans.map((plan) => (
            <LifeEventCard
              key={plan.id}
              plan={plan}
              costs={costsByPlan.get(plan.id) ?? []}
              transactions={transactions}
              currency={profile.currency}
              editPlan={() => { setError(""); setPlanEditor(plan); }}
              addCost={() => { setError(""); setCostEditor({ planId: plan.id, cost: null }); }}
              editCost={(cost) => { setError(""); setCostEditor({ planId: plan.id, cost }); }}
              deleteCost={deleteCost}
              recordCost={setRecordingCost}
              updateSetAside={(amount_set_aside) => void updatePlan(plan, { amount_set_aside }, "Set-aside amount updated.")}
              complete={() => void updatePlan(plan, { status: "completed" }, "Plan marked complete.")}
              archive={() => void updatePlan(plan, { status: "archived" }, "Plan archived.")}
            />
          ))}
        </div>
      ) : (
        <Card><Empty title="Start a life-event plan" body="Create a plan, list expected costs, and track what you have set aside." action={<button onClick={() => setPlanEditor("new")} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">Create a plan</button>} /></Card>
      )}
      {archivedPlans.length > 0 && (
        <details className="mt-5 rounded-2xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Completed and archived plans ({archivedPlans.length})</summary>
          <div className="mt-3 divide-y divide-line">
            {archivedPlans.map((plan) => <div key={plan.id} className="flex items-center justify-between gap-3 py-3 text-xs"><span className="truncate font-medium">{plan.name}</span><span className="rounded-full bg-[#f1f3f1] px-2 py-1 text-[10px] capitalize text-muted">{plan.status}</span><button onClick={() => void updatePlan(plan, { status: "active" }, "Plan restored.")} className="font-semibold text-forest">Restore</button></div>)}
          </div>
        </details>
      )}
      {planEditor && (
        <Modal title={planEditor === "new" ? "Create life-event plan" : "Edit life-event plan"} close={() => setPlanEditor(null)}>
          <form onSubmit={(event) => void savePlan(event)} className="space-y-4">
            <Field label="Plan name"><input name="name" required maxLength={100} defaultValue={planEditor === "new" ? "" : planEditor.name} placeholder="e.g. Summer trip" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Target amount (${profile.currency})`}><input name="target_amount" type="number" min="0.01" step="0.01" required defaultValue={planEditor === "new" ? "" : planEditor.target_amount} /></Field>
              <Field label="Target date"><input name="target_on" type="date" required defaultValue={planEditor === "new" ? "" : planEditor.target_on} /></Field>
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            <div className="flex gap-2"><button type="button" onClick={() => setPlanEditor(null)} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button><button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save plan"}</button></div>
          </form>
        </Modal>
      )}
      {costEditor && (
        <Modal title={costEditor.cost ? "Edit planned cost" : "Add expected cost"} description="This is an estimate, not a transaction." close={() => setCostEditor(null)}>
          <form onSubmit={(event) => void saveCost(event)} className="space-y-4">
            <Field label="Cost description"><input name="title" required maxLength={120} defaultValue={costEditor.cost?.title ?? ""} placeholder="e.g. Accommodation" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Estimated amount (${profile.currency})`}><input name="amount" type="number" min="0.01" step="0.01" required defaultValue={costEditor.cost?.amount ?? ""} /></Field>
              <Field label="Expected date"><input name="planned_on" type="date" required defaultValue={costEditor.cost?.planned_on ?? ""} /></Field>
            </div>
            <Field label="Category (optional)"><select name="category_id" defaultValue={costEditor.cost?.category_id ?? ""}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}</select></Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            <div className="flex gap-2"><button type="button" onClick={() => setCostEditor(null)} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button><button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save expected cost"}</button></div>
          </form>
        </Modal>
      )}
      {recordingCost && <RecordLifeEventCostDialog cost={recordingCost} sources={sources} reload={reload} refreshTransactions={refreshTransactions} notify={notify} close={() => setRecordingCost(null)} />}
    </>
  );
}

function LifeEventCard({ plan, costs, transactions, currency, editPlan, addCost, editCost, deleteCost, recordCost, updateSetAside, complete, archive }: {
  plan: LifeEventPlan;
  costs: LifeEventCost[];
  transactions: Transaction[];
  currency: string;
  editPlan: () => void;
  addCost: () => void;
  editCost: (cost: LifeEventCost) => void;
  deleteCost: (cost: LifeEventCost) => void;
  recordCost: (cost: LifeEventCost) => void;
  updateSetAside: (amount: number) => void;
  complete: () => void;
  archive: () => void;
}) {
  const [setAside, setSetAside] = useState(String(plan.amount_set_aside));
  const progressSummary = calculateLifeEventProgress(plan, costs, transactions);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf4ee] text-forest"><CalendarDays size={18} /></span>
          <div><h3 className="text-sm font-semibold">{plan.name}</h3><p className="mt-1 text-[11px] text-muted">Target {plan.target_on} · goal {formatCurrency(plan.target_amount, currency)}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={editPlan} aria-label={`Edit ${plan.name}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><Pencil size={15} /></button>
          <button onClick={complete} aria-label={`Complete ${plan.name}`} className="rounded-lg p-2 text-forest hover:bg-[#edf4ee]"><Check size={15} /></button>
          <button onClick={archive} aria-label={`Archive ${plan.name}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><Archive size={15} /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Summary title="Expected costs" value={formatCurrency(progressSummary.expectedCosts, currency)} />
        <Summary title="Set aside" value={formatCurrency(plan.amount_set_aside, currency)} />
        <Summary title="Recorded toward plan" value={formatCurrency(progressSummary.recordedAmount, currency)} />
        <Summary title="Goal remaining" value={formatCurrency(progressSummary.goalRemaining, currency)} emphasis={progressSummary.goalRemaining < 0} />
      </div>
      {progressSummary.overGoalBy > 0 && <div role="status" className="mt-3 rounded-xl border border-[#f0d7b6] bg-[#fff9ee] px-3.5 py-3 text-xs leading-5 text-[#78531d]">
        Expected costs exceed the goal amount remaining by <strong>{formatCurrency(progressSummary.overGoalBy, currency)}</strong>. Increase the goal, add more to set aside, or adjust the planned costs.
      </div>}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#edf0ed]"><div className="h-full rounded-full bg-[#5b9b74] transition-all" style={{ width: `${progressSummary.progressPercent}%` }} /></div>
      <div className="mt-4 flex flex-wrap items-end gap-2 border-b border-line pb-4">
        <Field label={`Update set-aside amount (${currency})`}><input type="number" min="0" step="0.01" value={setAside} onChange={(event) => setSetAside(event.target.value)} className="w-full sm:w-44" /></Field>
        <button onClick={() => { const amount = Number(setAside); if (Number.isFinite(amount) && amount >= 0) updateSetAside(Math.round(amount * 100) / 100); }} className="rounded-lg border border-line px-3 py-2.5 text-xs font-semibold text-forest">Save amount</button>
        <button onClick={addCost} className="ml-auto flex items-center gap-1.5 rounded-lg bg-forest px-3 py-2.5 text-xs font-semibold text-white"><Plus size={14} /> Add cost</button>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted">Set aside is a manual note for money you have earmarked outside Spendly; it does not move money or create a transaction. Record an actual cost when you spend it, then update set aside to the amount still reserved so the same funds are not counted twice.</p>
      {costs.length ? (
        <div className="divide-y divide-line">
          {costs.map((cost) => {
            const actual = cost.recorded_transaction_id
              ? transactions.find((transaction) => transaction.id === cost.recorded_transaction_id)?.amount
              : null;
            return (
              <div key={cost.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-[140px] flex-1">
                  <p className="text-xs font-semibold">{cost.title}</p>
                  <p className="mt-1 text-[10px] text-muted">{cost.planned_on} · {cost.status === "recorded" ? `Recorded ${formatCurrency(actual ?? cost.amount, currency)}` : `Expected ${formatCurrency(cost.amount, currency)}`}</p>
                </div>
                {cost.status === "planned" ? (
                  <>
                    <button onClick={() => recordCost(cost)} className="rounded-lg bg-[#edf4ee] px-2.5 py-2 text-[10px] font-semibold text-forest">Record actual</button>
                    <button onClick={() => editCost(cost)} aria-label={`Edit ${cost.title}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><Pencil size={14} /></button>
                    <button onClick={() => void deleteCost(cost)} aria-label={`Remove ${cost.title}`} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                  </>
                ) : <span className="rounded-full bg-[#edf4ee] px-2.5 py-1 text-[9px] font-semibold text-forest">In transactions</span>}
              </div>
            );
          })}
        </div>
      ) : <Empty title="No expected costs yet" body="Add the pieces that make up this plan's estimated total." action={<button onClick={addCost} className="text-xs font-semibold text-forest">Add the first cost</button>} />}
    </Card>
  );
}

function Summary({ title, value, emphasis = false }: { title: string; value: string; emphasis?: boolean }) {
  return <div className="rounded-xl bg-[#f7f9f6] p-3"><p className="text-[10px] text-muted">{title}</p><p className={`mt-1 text-sm font-bold ${emphasis ? "text-[#bd634e]" : "text-ink"}`}>{value}</p></div>;
}
