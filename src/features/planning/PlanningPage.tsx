import { useCallback, useEffect, useState } from "react";
import { Activity, CalendarDays } from "lucide-react";
import { Card, PageHeading } from "../../components/ui/FinancePrimitives";
import { supabase } from "../../lib/supabase";
import type { Budget, Category, LifeEventCost, LifeEventPlan, PaymentSource, Profile, PurchaseScenario, RecurringPayment, Transaction } from "../../types";
import LifeEventPlanner from "./LifeEventPlanner";
import PurchasePlanner from "./PurchasePlanner";

type Props = {
  profile: Profile;
  categories: Category[];
  sources: PaymentSource[];
  transactions: Transaction[];
  budgets: Budget[];
  schedules: RecurringPayment[];
  refreshTransactions: () => Promise<void>;
  notify: (message: string) => void;
  recordPurchase: (scenario: PurchaseScenario) => void;
};

type PlanningTab = "purchases" | "life-events";

export default function PlanningPage({ profile, categories, sources, transactions, budgets, schedules, refreshTransactions, notify, recordPurchase }: Props) {
  const [tab, setTab] = useState<PlanningTab>("purchases");
  const [scenarios, setScenarios] = useState<PurchaseScenario[]>([]);
  const [plans, setPlans] = useState<LifeEventPlan[]>([]);
  const [costs, setCosts] = useState<LifeEventCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(async () => {
    if (!supabase) {
      setLoadError("Planning requires a configured Supabase project.");
      setLoading(false);
      return;
    }
    setLoadError("");
    setLoading(true);
    const [scenarioResult, planResult, costResult] = await Promise.all([
      supabase.from("purchase_scenarios").select("*").order("planned_on"),
      supabase.from("life_event_plans").select("*").order("target_on"),
      supabase.from("life_event_costs").select("*").order("planned_on"),
    ]);
    const failure = scenarioResult.error ?? planResult.error ?? costResult.error;
    if (failure) {
      setLoadError(`Planning data couldn't be loaded: ${failure.message}. Apply migration 005 and confirm the planning-table RLS policies are active.`);
      setLoading(false);
      return;
    }
    setScenarios(scenarioResult.data ?? []);
    setPlans(planResult.data ?? []);
    setCosts(costResult.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      <PageHeading eyebrow="PLAN WITH CLARITY" title="Planning" description="Explore possible purchases and prepare for bigger moments." />
      {loadError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-800"><span>{loadError}</span><button onClick={() => void reload()} className="font-semibold underline">Try again</button></div>}
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Planning tools">
        <button role="tab" aria-selected={tab === "purchases"} onClick={() => setTab("purchases")} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ${tab === "purchases" ? "bg-forest text-white" : "border border-line bg-white text-muted"}`}><Activity size={15} /> Purchase scenarios</button>
        <button role="tab" aria-selected={tab === "life-events"} onClick={() => setTab("life-events")} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ${tab === "life-events" ? "bg-forest text-white" : "border border-line bg-white text-muted"}`}><CalendarDays size={15} /> Life events</button>
      </div>
      {loadError ? (
        <Card><p className="text-sm text-muted">Planning tools are unavailable until the required database setup is complete.</p></Card>
      ) : tab === "purchases" ? (
        <PurchasePlanner profile={profile} categories={categories} transactions={transactions} budgets={budgets} schedules={schedules} plans={plans} costs={costs} scenarios={scenarios} loading={loading} reload={reload} notify={notify} recordPurchase={recordPurchase} />
      ) : (
        <LifeEventPlanner profile={profile} categories={categories} sources={sources} transactions={transactions} plans={plans} costs={costs} loading={loading} reload={reload} refreshTransactions={refreshTransactions} notify={notify} />
      )}
    </>
  );
}
