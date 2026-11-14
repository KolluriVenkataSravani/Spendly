import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, ChevronLeft,
  ChevronRight, CreditCard, Ellipsis, Filter, LayoutDashboard, Leaf, LogOut, Menu,
  MoreHorizontal, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Tag, Trash2, Users,
  Wallet, X, type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import Auth from "./Auth";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { amountInMinorUnits, budgetProgress, categorySpending, dateInTimezone, formatCurrency, monthBounds, splitAmount, sumByType, sumMoneyAmounts, transactionsInMonth } from "./lib/finance";
import type { Budget, Category, ExpenseSplit, Group, GroupInvitation, GroupMember, PageKey, PaymentMethod, PaymentSource, PaymentSourceKind, Profile, Settlement, SharedExpense, Transaction, TransactionType } from "./types";

const navigation: { name: PageKey; icon: LucideIcon }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Transactions", icon: ArrowLeftRight },
  { name: "Budgets", icon: Wallet },
  { name: "Analytics", icon: Activity },
  { name: "Shared expenses", icon: Users },
  { name: "Card Vault", icon: CreditCard },
  { name: "Settings", icon: Settings },
];

const methodLabels: Record<PaymentMethod, string> = { cash: "Cash", credit_card: "Credit card", debit_card: "Debit card", upi: "UPI" };

function formatSupabaseError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "Unknown Supabase error.";
  const details = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  return [
    typeof details.message === "string" ? details.message : "Supabase request failed.",
    typeof details.code === "string" ? `Code: ${details.code}.` : "",
    typeof details.details === "string" ? details.details : "",
    typeof details.hint === "string" ? `Hint: ${details.hint}` : "",
  ].filter(Boolean).join(" ");
}

function localDateTimeValue(value?: string) {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateLabel(value: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(value));
}

function App() {
  const [session, setSession] = useState<Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [page, setPage] = useState<PageKey>("Overview");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sources, setSources] = useState<PaymentSource[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [expenses, setExpenses] = useState<SharedExpense[]>([]);
  const [splits, setSplits] = useState<ExpenseSplit[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [toast, setToast] = useState("");
  const [transactionModal, setTransactionModal] = useState<Transaction | "new" | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    if (new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery") setRecoveryMode(true);
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("Could not restore the Supabase session:", error.message);
      if (active) {
        setSession(data.session);
        setAuthLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      if (!nextSession) { setProfile(null); setProfileLoaded(false); setRecoveryMode(false); }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase || !session?.user.id) return;
    setLoading(true);
    setLoadError("");
    try {
      const [profileResult, categoryResult, sourceResult, budgetResult, membershipResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", session.user.id).single(),
        supabase.from("categories").select("*").order("name"),
        supabase.from("payment_sources").select("*").order("created_at", { ascending: false }),
        supabase.from("budgets").select("*"),
        supabase.from("group_memberships").select("group_id,user_id,role").eq("user_id", session.user.id),
      ]);
      const initialError = profileResult.error
        ? { query: "profiles", error: profileResult.error }
        : categoryResult.error
          ? { query: "categories", error: categoryResult.error }
          : sourceResult.error
            ? { query: "payment_sources", error: sourceResult.error }
            : budgetResult.error
              ? { query: "budgets", error: budgetResult.error }
              : membershipResult.error
                ? { query: "group_memberships", error: membershipResult.error }
                : null;
      if (initialError) throw new Error(`${initialError.query}: ${formatSupabaseError(initialError.error)}`);
      if (!profileResult.data || !categoryResult.data || !sourceResult.data || !budgetResult.data || !membershipResult.data) {
        throw new Error("Supabase returned incomplete account data. Check the API response and Row Level Security policies.");
      }
      setProfile(profileResult.data);
      setCategories(categoryResult.data);
      setSources(sourceResult.data);
      const allTransactions: Transaction[] = [];
      for (let offset = 0; ; offset += 1000) {
        const transactionPage = await supabase.from("transactions").select("*").order("occurred_at", { ascending: false }).range(offset, offset + 999);
        if (transactionPage.error) throw new Error(`transactions: ${formatSupabaseError(transactionPage.error)}`);
        if (!transactionPage.data) throw new Error("transactions: Supabase returned no response data.");
        allTransactions.push(...transactionPage.data);
        if (transactionPage.data.length < 1000) break;
      }
      setTransactions(allTransactions);
      setBudgets(budgetResult.data);
      const groupIds = [...new Set(membershipResult.data.map((membership) => membership.group_id))];
      if (!groupIds.length) {
        setGroups([]); setMembers([]); setExpenses([]); setSplits([]); setSettlements([]); setInvitations([]);
      } else {
        const [groupResult, memberResult, expenseResult, settlementResult, invitationResult] = await Promise.all([
          supabase.from("groups").select("*").in("id", groupIds).order("created_at", { ascending: false }),
          supabase.from("group_memberships").select("group_id,user_id,role").in("group_id", groupIds),
          supabase.from("shared_expenses").select("*").in("group_id", groupIds).order("occurred_at", { ascending: false }),
          supabase.from("settlements").select("*").in("group_id", groupIds).order("paid_at", { ascending: false }),
          supabase.from("group_invitations").select("id,group_id,email,expires_at,accepted_at,created_at").in("group_id", groupIds).order("created_at", { ascending: false }),
        ]);
        const groupDataError = groupResult.error
          ? { query: "groups", error: groupResult.error }
          : memberResult.error
            ? { query: "group_memberships", error: memberResult.error }
            : expenseResult.error
              ? { query: "shared_expenses", error: expenseResult.error }
              : settlementResult.error
                ? { query: "settlements", error: settlementResult.error }
                : invitationResult.error
                  ? { query: "group_invitations", error: invitationResult.error }
                  : null;
        if (groupDataError) throw new Error(`${groupDataError.query}: ${formatSupabaseError(groupDataError.error)}`);
        if (!groupResult.data || !memberResult.data || !expenseResult.data || !settlementResult.data || !invitationResult.data) {
          throw new Error("Group API returned incomplete data. Check the group membership policies.");
        }
        const memberProfiles = await supabase.from("profiles").select("id,display_name").in("id", [...new Set(memberResult.data.map((member) => member.user_id))]);
        if (memberProfiles.error) throw new Error(`group member profiles: ${formatSupabaseError(memberProfiles.error)}`);
        if (!memberProfiles.data) throw new Error("group member profiles: Supabase returned no response data.");
        const profileById = new Map(memberProfiles.data.map((item) => [item.id, item]));
        setGroups(groupResult.data);
        setMembers(memberResult.data.map((member) => ({ ...member, profile: profileById.get(member.user_id) })));
        setExpenses(expenseResult.data);
        setSettlements(settlementResult.data);
        setInvitations(invitationResult.data);
        const expenseIds = expenseResult.data.map((expense) => expense.id);
        if (expenseIds.length) {
          const splitResult = await supabase.from("expense_splits").select("*").in("expense_id", expenseIds);
          if (splitResult.error) throw new Error(`expense_splits: ${formatSupabaseError(splitResult.error)}`);
          if (!splitResult.data) throw new Error("expense_splits: Supabase returned no response data.");
          setSplits(splitResult.data);
        } else setSplits([]);
      }
    } catch (error) {
      const detail = formatSupabaseError(error);
      console.error("Spendly data load failed:", detail);
      setLoadError(detail);
    } finally {
      setLoading(false);
      setProfileLoaded(true);
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (session) {
      setProfileLoaded(false);
      void loadData();
    }
  }, [session?.user.id, loadData]);

  useEffect(() => {
    if (!session || !supabase) return;
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    supabase.rpc("accept_group_invitation", { p_token: token }).then(async ({ error }) => {
      if (error) notify(`Invitation could not be accepted: ${error.message}`);
      else {
        window.history.replaceState({}, "", window.location.pathname);
        notify("You joined the shared expense group.");
        await loadData();
        setPage("Shared expenses");
      }
    });
  }, [session, loadData, notify]);

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!supabase || !session) throw new Error("Please sign in again.");
    const { data, error } = await supabase.from("profiles").update(updates).eq("id", session.user.id).select().single();
    if (error) throw error;
    setProfile(data);
  };

  if (!isSupabaseConfigured || !supabase) return <Auth configured={false} />;
  const client = supabase;
  const signOut = async () => {
    const { error } = await client.auth.signOut();
    if (error) notify(`Sign out failed: ${error.message}`);
  };
  if (authLoading) return <div className="grid min-h-screen place-items-center bg-canvas"><div className="h-8 w-8 animate-spin rounded-full border-2 border-forest border-t-transparent" aria-label="Loading Spendly" /></div>;
  if (recoveryMode && session) return <PasswordRecovery onComplete={() => setRecoveryMode(false)} />;
  if (!session) return <Auth configured />;
  if (!profileLoaded || (!profile && loading)) {
    if (loadError) return <ErrorScreen error={loadError} retry={() => void loadData()} />;
    return <AppSkeleton />;
  }
  if (!profile && loadError) return <ErrorScreen error={loadError} retry={() => void loadData()} />;
  if (!profile?.onboarding_complete) {
    return <Onboarding userName={session.user.user_metadata.display_name ?? ""} save={async (values) => {
      await updateProfile({ ...values, onboarding_complete: true });
      notify("Your Spendly space is ready.");
    }} signOut={() => { void signOut(); }} />;
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Sidebar page={page} setPage={setPage} profile={profile} open={mobileMenu} close={() => setMobileMenu(false)} signOut={() => { void signOut(); }} />
      <div className="min-h-screen lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-line/80 bg-canvas/90 px-4 backdrop-blur-md sm:px-7 lg:px-9">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenu(true)} aria-label="Open navigation" className="rounded-lg p-2 text-ink hover:bg-white lg:hidden"><Menu size={20} /></button>
            <div className="hidden text-sm text-muted sm:block">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, <span className="font-semibold text-ink">{profile.display_name.split(" ")[0] || "there"}</span></div>
            <div className="font-display text-base font-extrabold tracking-tight lg:hidden">spendly</div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setNotificationsOpen((value) => !value)} aria-label="Open notifications" aria-expanded={notificationsOpen} className="relative rounded-xl border border-line bg-white p-2.5 text-[#68756d] hover:text-forest"><Bell size={17} /></button>
            <button onClick={() => setPage("Settings")} className="flex items-center gap-2 rounded-xl border border-line bg-white py-1.5 pl-1.5 pr-2.5 hover:border-[#cbd6ce]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-mint text-xs font-bold text-forest">{profile.display_name.slice(0, 1).toUpperCase()}</span><span className="hidden max-w-24 truncate text-xs font-semibold sm:block">{profile.display_name}</span><ChevronDown size={14} className="hidden text-muted sm:block" /></button>
          </div>
        </header>
        {notificationsOpen && <NotificationPanel transactions={transactions} budgets={budgets} categories={categories} expenses={expenses} splits={splits} settlements={settlements} userId={session.user.id} currency={profile.currency} timezone={profile.timezone} close={() => setNotificationsOpen(false)} setPage={setPage} />}
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8 lg:px-9 lg:py-9">
          {loadError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{loadError}</span><button onClick={() => void loadData()} className="font-semibold underline">Try again</button></div>}
          {loading && <div aria-label="Refreshing data" className="fixed right-5 top-[82px] z-40 h-5 w-5 animate-spin rounded-full border-2 border-forest border-t-transparent" />}
          {page === "Overview" && <Overview profile={profile} userId={session.user.id} transactions={transactions} categories={categories} sources={sources} budgets={budgets} expenses={expenses} splits={splits} settlements={settlements} groups={groups} openTransaction={() => setTransactionModal("new")} setPage={setPage} />}
          {page === "Transactions" && <TransactionsPage transactions={transactions} categories={categories} sources={sources} currency={profile.currency} timezone={profile.timezone} userId={session.user.id} openTransaction={setTransactionModal} reload={loadData} notify={notify} />}
          {page === "Budgets" && <BudgetsPage profile={profile} updateProfile={updateProfile} budgets={budgets} transactions={transactions} categories={categories} currency={profile.currency} reload={loadData} notify={notify} />}
          {page === "Analytics" && <AnalyticsPage transactions={transactions} categories={categories} sources={sources} budgets={budgets} monthlyBudget={profile.monthly_budget} timezone={profile.timezone} currency={profile.currency} />}
          {page === "Shared expenses" && <SharedPage groups={groups} invitations={invitations} members={members} expenses={expenses} splits={splits} settlements={settlements} categories={categories} userId={session.user.id} currency={profile.currency} timezone={profile.timezone} reload={loadData} notify={notify} />}
          {page === "Card Vault" && <VaultPage sources={sources} transactions={transactions} currency={profile.currency} userId={session.user.id} reload={loadData} notify={notify} />}
          {page === "Settings" && <SettingsPage profile={profile} updateProfile={updateProfile} email={session.user.email ?? ""} notify={notify} signOut={() => { void signOut(); }} />}
        </main>
      </div>
      <button onClick={() => setTransactionModal("new")} aria-label="Add transaction" className="fixed bottom-20 right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-forest text-white shadow-lg transition hover:scale-105 hover:bg-[#17573f] sm:bottom-7 lg:hidden"><Plus size={23} /></button>
      {transactionModal && <TransactionDialog transaction={transactionModal === "new" ? null : transactionModal} categories={categories} sources={sources} currency={profile.currency} close={() => setTransactionModal(null)} saved={async (warning) => { setTransactionModal(null); await loadData(); notify(warning ?? "Transaction saved."); }} />}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden" aria-label="Mobile navigation">
        {navigation.slice(0, 5).map((item) => <button key={item.name} onClick={() => setPage(item.name)} className={`flex min-w-0 flex-col items-center gap-1 px-2 py-2 text-[10px] ${page === item.name ? "font-semibold text-forest" : "text-muted"}`}><item.icon size={18} /><span className="max-w-[72px] truncate">{item.name === "Shared expenses" ? "Shared" : item.name}</span></button>)}
      </nav>
      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} role="status" className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg sm:bottom-6">{toast}</motion.div>}</AnimatePresence>
    </div>
  );
}

export default App;

function Sidebar({ page, setPage, profile, open, close, signOut }: { page: PageKey; setPage: (page: PageKey) => void; profile: Profile; open: boolean; close: () => void; signOut: () => void }) {
  return <>
    {open && <button aria-label="Close navigation" onClick={close} className="fixed inset-0 z-40 bg-ink/30 lg:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-line bg-white px-4 py-6 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-10 flex items-center justify-between px-2">
        <button onClick={() => { setPage("Overview"); close(); }} className="flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><Leaf size={19} /></span>spendly<span className="text-[9px] font-semibold uppercase tracking-[.13em] text-[#98a49c]">BETA</span></button>
        <button onClick={close} aria-label="Close navigation" className="rounded-lg p-1 text-muted lg:hidden"><X size={18} /></button>
      </div>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#9ba49e]">Workspace</p>
      <nav className="space-y-1">
        {navigation.map(({ name, icon: Icon }) => <button key={name} onClick={() => { setPage(name); close(); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition ${page === name ? "bg-mint font-semibold text-forest" : "font-medium text-[#68756d] hover:bg-[#f5f7f5] hover:text-ink"}`}><Icon size={17} strokeWidth={page === name ? 2.2 : 1.8} />{name}{name === "Shared expenses" && <span className="ml-auto rounded-full bg-[#f0f3f0] px-2 py-0.5 text-[10px] text-muted">NEW</span>}</button>)}
      </nav>
      <div className="mt-auto rounded-2xl bg-[#f4f7f3] p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-forest"><ShieldCheck size={17} /></div>
        <p className="text-xs font-semibold">Your money stays yours</p>
        <p className="mt-1 text-[11px] leading-4 text-muted">Spendly never asks for bank passwords or card security codes.</p>
      </div>
      <button onClick={signOut} className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-[#68756d] hover:bg-[#f5f7f5]"><LogOut size={17} />Sign out</button>
      <div className="mt-1 flex items-center gap-2 border-t border-line px-2 pt-4">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e8eee8] text-xs font-bold text-forest">{profile.display_name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0"><p className="truncate text-xs font-semibold">{profile.display_name}</p><p className="text-[10px] text-muted">Personal space</p></div>
        <MoreHorizontal size={17} className="ml-auto text-muted" />
      </div>
    </aside>
  </>;
}

function NotificationPanel({ transactions, budgets, categories, expenses, splits, settlements, userId, currency, timezone, close, setPage }: { transactions: Transaction[]; budgets: Budget[]; categories: Category[]; expenses: SharedExpense[]; splits: ExpenseSplit[]; settlements: Settlement[]; userId: string; currency: string; timezone: string; close: () => void; setPage: (page: PageKey) => void }) {
  const monthStart = monthBounds(new Date(), timezone).start;
  const monthTransactions = transactionsInMonth(transactions, monthStart, timezone);
  const overall = budgets.find((item) => item.month_start === monthStart && !item.category_id);
  const overallLimit = Number(overall?.amount ?? 0);
  const overallSpent = sumByType(monthTransactions, "expense");
  const notices: { title: string; body: string; page: PageKey; tone: string }[] = [];
  if (overallLimit > 0 && overallSpent >= overallLimit) {
    notices.push({ title: "Monthly budget reached", body: `You've spent ${formatCurrency(overallSpent, currency)} of your ${formatCurrency(overallLimit, currency)} target.`, page: "Budgets", tone: "text-[#bd684d]" });
  } else if (overallLimit > 0 && overallSpent / overallLimit >= .8) {
    notices.push({ title: "Budget getting close", body: `${Math.round(overallSpent / overallLimit * 100)}% of your monthly target is used.`, page: "Budgets", tone: "text-[#ae8240]" });
  }
  for (const budget of budgets.filter((item) => item.month_start === monthStart && item.category_id)) {
    const progress = budgetProgress(monthTransactions, budget, budget.category_id, timezone);
    if (progress.percent >= 80) notices.push({
      title: `${categories.find((category) => category.id === budget.category_id)?.name ?? "Category"} ${progress.percent >= 100 ? "limit reached" : "limit approaching"}`,
      body: `${formatCurrency(progress.spent, currency)} spent of ${formatCurrency(budget.amount, currency)}.`,
      page: "Budgets",
      tone: progress.percent >= 100 ? "text-[#bd684d]" : "text-[#ae8240]",
    });
  }
  const sharedBalances = new Map<string, number>();
  for (const expense of expenses) {
    for (const split of splits.filter((entry) => entry.expense_id === expense.id)) sharedBalances.set(`${expense.group_id}:${split.user_id}`, (sharedBalances.get(`${expense.group_id}:${split.user_id}`) ?? 0) + amountInMinorUnits(split.amount_owed));
    if (expense.paid_by) sharedBalances.set(`${expense.group_id}:${expense.paid_by}`, (sharedBalances.get(`${expense.group_id}:${expense.paid_by}`) ?? 0) - amountInMinorUnits(expense.amount));
  }
  for (const settlement of settlements) {
    sharedBalances.set(`${settlement.group_id}:${settlement.payer_id}`, (sharedBalances.get(`${settlement.group_id}:${settlement.payer_id}`) ?? 0) - amountInMinorUnits(settlement.amount));
    sharedBalances.set(`${settlement.group_id}:${settlement.payee_id}`, (sharedBalances.get(`${settlement.group_id}:${settlement.payee_id}`) ?? 0) + amountInMinorUnits(settlement.amount));
  }
  const owedGroups = [...sharedBalances].filter(([key, balance]) => key.endsWith(`:${userId}`) && balance > 0).length;
  if (owedGroups) notices.push({ title: "Shared expenses need a look", body: `You have a balance to settle in ${owedGroups} group${owedGroups === 1 ? "" : "s"}.`, page: "Shared expenses", tone: "text-forest" });
  return <div className="fixed inset-0 z-40 bg-ink/15 lg:absolute lg:inset-auto lg:right-8 lg:top-[62px] lg:bg-transparent" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border border-line bg-white p-5 shadow-xl sm:left-auto sm:right-4 sm:top-2 sm:bottom-auto sm:w-[340px] sm:rounded-2xl lg:right-0" role="dialog" aria-label="Notifications">
      <div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-sm font-bold">Your check-in</h2><p className="mt-1 text-[10px] text-muted">Helpful reminders from your activity</p></div><button onClick={close} aria-label="Close notifications" className="rounded-lg p-1.5 text-muted hover:bg-canvas"><X size={16} /></button></div>
      {notices.length ? <div className="divide-y divide-line">{notices.map((notice, index) => <button key={`${notice.title}-${index}`} onClick={() => { setPage(notice.page); close(); }} className="block w-full py-3 text-left first:pt-0"><span className={`text-xs font-semibold ${notice.tone}`}>{notice.title}</span><span className="mt-1 block text-[11px] leading-4 text-muted">{notice.body}</span></button>)}</div> : <div className="py-5 text-center"><span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-mint text-forest"><Check size={17} /></span><p className="mt-2 text-xs font-semibold">All caught up</p><p className="mt-1 text-[10px] text-muted">No budget alerts or shared balances need attention.</p></div>}
    </section>
  </div>;
}

function Onboarding({ userName, save, signOut }: { userName: string; save: (values: Partial<Profile>) => Promise<void>; signOut: () => void }) {
  const [name, setName] = useState(userName);
  const [currency, setCurrency] = useState("INR");
  const [budget, setBudget] = useState("");
  const [balance, setBalance] = useState("0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const budgetAmount = Number(budget);
    const starting = Number(balance);
    if (!name.trim() || !Number.isFinite(budgetAmount) || budgetAmount <= 0 || !Number.isFinite(starting) || starting < 0) {
      setError("Enter your name, a monthly budget above zero, and a starting balance of zero or more.");
      return;
    }
    setBusy(true); setError("");
    try { await save({ display_name: name.trim(), currency, monthly_budget: budgetAmount, starting_balance: starting, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "We couldn't save your setup. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10"><div className="w-full max-w-[500px] rounded-3xl border border-line bg-white p-6 shadow-card sm:p-9">
    <div className="mb-7 flex items-center gap-2 font-display text-lg font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><Leaf size={18} /></span>spendly</div>
    <div className="mb-7"><p className="mb-2 text-xs font-bold uppercase tracking-[.13em] text-forest">A little setup</p><h1 className="font-display text-3xl font-bold tracking-tight">Welcome to a clearer money life.</h1><p className="mt-2 text-sm leading-6 text-muted">Tell us a little about your goals. You can update these anytime.</p></div>
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <Field label="What should we call you?"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Preferred currency"><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD"].map((item) => <option key={item}>{item}</option>)}</select><span className="mt-1 block text-[10px] text-muted">Two-decimal currencies</span></Field><Field label="Monthly budget"><input required type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="e.g. 50000" /></Field></div>
      <Field label="Starting balance (optional)"><input type="number" min="0" step="0.01" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="0.00" /><span className="mt-1 block text-xs text-muted">Just a reference point — no bank connection required.</span></Field>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest py-3.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : <>Continue <ChevronRight size={17} /></>}</button>
    </form>
    <div className="mt-5 flex items-center justify-between"><p className="text-xs text-muted">You can add your first transaction next.</p><button onClick={signOut} className="text-xs font-medium text-muted hover:text-ink">Sign out</button></div>
  </div></main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs font-semibold text-[#56645b]">{label}<div className="mt-1.5 [&_input]:block [&_input]:w-full [&_input]:rounded-xl [&_input]:border-line [&_input]:bg-white [&_input]:px-3.5 [&_input]:py-3 [&_input]:text-sm [&_input]:font-normal [&_select]:block [&_select]:w-full [&_select]:rounded-xl [&_select]:border-line [&_select]:bg-white [&_select]:px-3.5 [&_select]:py-3 [&_select]:text-sm [&_select]:font-normal">{children}</div></label>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-forest">{eyebrow}</p>}<h1 className="font-display text-[26px] font-bold tracking-[-.035em] sm:text-[30px]">{title}</h1>{description && <p className="mt-1.5 text-sm text-muted">{description}</p>}</div>{action}</div>;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6 ${className}`}>{children}</section>;
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center px-5 py-9 text-center"><div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#f2f5f2] text-[#769180]"><Sparkles size={19} /></div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-xs text-xs leading-5 text-muted">{body}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

function AppSkeleton() {
  return <main className="min-h-screen bg-canvas p-5 sm:p-8" role="status" aria-label="Loading your Spendly workspace">
    <div className="mx-auto max-w-6xl animate-pulse space-y-6"><div className="h-7 w-48 rounded-lg bg-[#e8ece8]" /><div className="h-10 w-72 rounded-lg bg-[#e8ece8]" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 rounded-2xl border border-line bg-white p-5"><div className="h-3 w-24 rounded bg-[#edf0ed]" /><div className="mt-6 h-6 w-32 rounded bg-[#edf0ed]" /></div>)}</div><div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]"><div className="h-80 rounded-2xl border border-line bg-white" /><div className="h-80 rounded-2xl border border-line bg-white" /></div></div>
  </main>;
}

function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError("Choose a password with at least 8 characters."); return; }
    if (password !== confirm) { setError("Those passwords don't match."); return; }
    if (!supabase) { setError("Supabase isn't available. Check your setup and try again."); return; }
    setBusy(true); setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    onComplete();
  }
  return <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10"><div className="w-full max-w-[430px] rounded-3xl border border-line bg-white p-6 shadow-card sm:p-9">
    <div className="mb-8 flex items-center gap-2 font-display text-lg font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><Leaf size={18} /></span>spendly</div>
    <p className="mb-2 text-xs font-bold uppercase tracking-[.13em] text-forest">Account recovery</p><h1 className="font-display text-2xl font-bold tracking-tight">Choose a new password</h1><p className="mt-2 text-sm leading-6 text-muted">Create a new password for your Spendly account.</p>
    <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4"><Field label="New password"><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></Field><Field label="Confirm new password"><input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-forest py-3.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Updating…" : "Update password"}</button></form>
  </div></main>;
}

function ErrorScreen({ error, retry }: { error: string; retry: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-canvas px-5"><div className="max-w-md rounded-2xl border border-line bg-white p-7 text-center"><h1 className="font-display text-xl font-bold">Couldn't load your account</h1><p role="alert" className="mt-2 text-sm text-muted">{error}</p><button onClick={retry} className="mt-5 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white">Try again</button></div></main>;
}

function Overview({ profile, userId, transactions, categories, sources, budgets, expenses, splits, settlements, groups, openTransaction, setPage }: { profile: Profile; userId: string; transactions: Transaction[]; categories: Category[]; sources: PaymentSource[]; budgets: Budget[]; expenses: SharedExpense[]; splits: ExpenseSplit[]; settlements: Settlement[]; groups: Group[]; openTransaction: () => void; setPage: (page: PageKey) => void }) {
  const [range, setRange] = useState("7d");
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
  const chartData = useMemo(() => makeTrend(transactions, range, profile.timezone), [transactions, range, profile.timezone]);
  const breakdown = categorySpending(thisMonthItems, categories).slice(0, 5);
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
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-base font-bold">Spending over time</h2><p className="mt-1 text-xs text-muted">Your daily expenses, in {profile.currency}</p></div><select aria-label="Spending chart date range" value={range} onChange={(event) => setRange(event.target.value)} className="rounded-lg border-line py-1.5 pl-3 pr-8 text-xs font-medium text-[#5b685f]"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select></div>
        <div className="h-[245px] w-full">
          {transactions.length === 0 ? <Empty title="Your spending story starts here" body="Once you add transactions, this chart will show how your spending moves over time." /> :
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 3, left: -20, bottom: 0 }}><defs><linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4a9a70" stopOpacity={0.18} /><stop offset="95%" stopColor="#4a9a70" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0ed" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} minTickGap={20} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} tickFormatter={(value: number) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value)} /><Tooltip formatter={(value: number) => [amount(value), "Spent"]} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 12 }} /><Area type="monotone" dataKey="amount" stroke="#35825a" strokeWidth={2.2} fill="url(#spendFill)" activeDot={{ r: 4, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer>}
        </div>
      </Card>
      <Card>
        <div className="mb-4 flex items-start justify-between"><div><h2 className="font-display text-base font-bold">Where it goes</h2><p className="mt-1 text-xs text-muted">This month's spending</p></div><button onClick={() => setPage("Analytics")} aria-label="View all analytics" className="rounded-lg p-1.5 text-muted hover:bg-canvas"><ChevronRight size={17} /></button></div>
        {!breakdown.length ? <Empty title="No categories yet" body="Categorize a transaction to see where your money is going." /> : <>
          <div className="h-[165px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="amount" nameKey="category.name" innerRadius={48} outerRadius={72} paddingAngle={3} stroke="none">{breakdown.map((item) => <Cell key={item.category.id} fill={item.category.color} />)}</Pie><Tooltip formatter={(value: number) => amount(value)} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 12 }} /></PieChart></ResponsiveContainer></div>
          <div className="space-y-3">{breakdown.slice(0, 4).map(({ category, amount: total }) => <div key={category.id} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</span><span className="font-semibold">{amount(total)}</span></div>)}</div>
        </>}
      </Card>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card className="!p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6"><div><h2 className="font-display text-base font-bold">Recent transactions</h2><p className="mt-1 text-xs text-muted">Your latest money moves</p></div><button onClick={() => setPage("Transactions")} className="text-xs font-semibold text-forest hover:underline">See all</button></div>
        <div className="divide-y divide-line">{transactions.slice(0, 5).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} category={categories.find((category) => category.id === transaction.category_id)} source={sourcesLabel(transaction.payment_source_id, sources)} currency={profile.currency} timezone={profile.timezone} />)}
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

function sourcesLabel(id: string | null, sources: PaymentSource[]) {
  return sources.find((source) => source.id === id)?.label;
}

function Metric({ title, value, icon: Icon, iconTone, foot, positive }: { title: string; value: string; icon: LucideIcon; iconTone: string; foot: string; positive?: boolean }) {
  return <Card className="!p-4 sm:!p-5"><div className="flex items-start justify-between"><p className="text-xs font-medium text-muted">{title}</p><span className={`grid h-8 w-8 place-items-center rounded-xl ${iconTone === "mint" ? "bg-mint text-forest" : iconTone === "peach" ? "bg-peach text-[#b27044]" : "bg-[#f0eef9] text-[#8171aa]"}`}><Icon size={16} /></span></div><p className="mt-3 font-display text-[23px] font-bold tracking-tight">{value}</p><p className={`mt-1 text-[10px] ${positive === false ? "text-[#be7658]" : "text-muted"}`}>{foot}</p></Card>;
}

function TransactionRow({ transaction, category, source, currency, timezone }: { transaction: Transaction; category?: Category; source?: string; currency: string; timezone?: string }) {
  return <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm" style={{ background: category?.color ? `${category.color}20` : "#f1f3f1", color: category?.color ?? "#718077" }}>{category?.icon ?? (transaction.type === "income" ? "↙" : "◦")}</span>
    <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{transaction.title}</p><p className="mt-0.5 truncate text-[10px] text-muted">{category?.name ?? "Uncategorized"} · {methodLabels[transaction.payment_method]}{source ? ` · ${source}` : ""}</p></div>
    <div className="text-right"><p className={`text-xs font-semibold ${transaction.type === "income" ? "text-forest" : "text-ink"}`}>{transaction.type === "income" ? "+" : "−"}{formatCurrency(transaction.amount, currency)}</p><p className="mt-0.5 text-[10px] text-muted">{dateLabel(transaction.occurred_at, timezone)}</p></div>
  </div>;
}

function BudgetLine({ title, spent, limit, currency }: { title: string; spent: number; limit: number; currency: string }) {
  const percent = limit > 0 ? Math.min(100, spent / limit * 100) : 0;
  const exceeded = spent > limit;
  return <div><div className="mb-1.5 flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium">{title}</span><span className="shrink-0 text-muted">{formatCurrency(spent, currency)} <span className="text-[#b0b8b2]">/</span> {formatCurrency(limit, currency)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#edf0ed]"><div className={`h-full rounded-full transition-all ${exceeded ? "bg-[#d47c61]" : percent >= 80 ? "bg-[#d6a25f]" : "bg-[#5a9a70]"}`} style={{ width: `${percent}%` }} /></div><p className={`mt-1 text-[10px] ${exceeded ? "text-[#bc6950]" : "text-muted"}`}>{exceeded ? `${formatCurrency(spent - limit, currency)} over target` : `${Math.round(percent)}% used`}</p></div>;
}

function makeTrend(transactions: Transaction[], range: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const todayKey = dateInTimezone(new Date().toISOString(), timezone);
  const [year, month, day] = todayKey.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const values = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
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

function makeAnalyticsTrend(transactions: Transaction[], days: number, timezone: string) {
  if (days <= 90) return makeTrend(transactions, days <= 30 ? "30d" : "90d", timezone);
  const currentMonth = monthBounds(new Date(), timezone).start;
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    const key = dateInTimezone(transaction.occurred_at, timezone).slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + amountInMinorUnits(transaction.amount));
  }
  return Array.from({ length: 12 }, (_, index) => {
    const key = addMonth(currentMonth, index - 11).slice(0, 7);
    const date = new Date(`${key}-01T12:00:00Z`);
    return { label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date), amount: (totals.get(key) ?? 0) / 100 };
  });
}

function TransactionsPage({ transactions, categories, sources, currency, timezone, userId, openTransaction, reload, notify }: { transactions: Transaction[]; categories: Category[]; sources: PaymentSource[]; currency: string; timezone: string; userId: string; openTransaction: (transaction: Transaction | "new") => void; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "high" | "low">("newest");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setCurrentPage] = useState(0);
  const [categoryModal, setCategoryModal] = useState(false);
  const pageSize = 12;

  const filtered = transactions.filter((item) => {
    const matchesText = !search || `${item.title} ${item.notes ?? ""}`.toLowerCase().includes(search.toLowerCase());
    return matchesText && (!categoryFilter || item.category_id === categoryFilter) &&
      (!methodFilter || item.payment_method === methodFilter) && (!typeFilter || item.type === typeFilter) &&
      (!from || dateInTimezone(item.occurred_at, timezone) >= from) && (!to || dateInTimezone(item.occurred_at, timezone) <= to) &&
      (!minAmount || item.amount >= Number(minAmount)) && (!maxAmount || item.amount <= Number(maxAmount));
  }).sort((a, b) => sort === "oldest" ? a.occurred_at.localeCompare(b.occurred_at) :
    sort === "high" ? b.amount - a.amount : sort === "low" ? a.amount - b.amount : b.occurred_at.localeCompare(a.occurred_at));
  const pages = Math.ceil(filtered.length / pageSize);
  const shown = filtered.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => setCurrentPage(0), [search, categoryFilter, methodFilter, typeFilter, from, to, minAmount, maxAmount, sort]);

  async function remove(transaction: Transaction) {
    if (!window.confirm(`Delete "${transaction.title}"? This can't be undone.`)) return;
    if (!supabase) return;
    const { error } = await supabase.from("transactions").delete().eq("id", transaction.id);
    if (error) { notify(`Couldn't delete transaction: ${error.message}`); return; }
    let message = "Transaction deleted.";
    if (transaction.receipt_path) {
      const { error: receiptError } = await supabase.storage.from("receipts").remove([transaction.receipt_path]);
      if (receiptError) message = `Transaction deleted, but its receipt couldn't be removed: ${receiptError.message}`;
    }
    notify(message);
    await reload();
  }

  const clearFilters = () => { setSearch(""); setCategoryFilter(""); setMethodFilter(""); setTypeFilter(""); setFrom(""); setTo(""); setMinAmount(""); setMaxAmount(""); };
  return <>
    <PageHeading eyebrow="YOUR ACTIVITY" title="Transactions" description={`${filtered.length} ${filtered.length === 1 ? "transaction" : "transactions"} in your history.`} action={<div className="flex gap-2"><button onClick={() => setCategoryModal(true)} className="hidden items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-xs font-semibold text-[#59675e] sm:flex"><Tag size={15} /> Categories</button><button onClick={() => openTransaction("new")} className="flex items-center gap-2 rounded-xl bg-forest px-3.5 py-2.5 text-xs font-semibold text-white"><Plus size={16} /> Add transaction</button></div>} />
    <Card className="!p-0">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa39d]" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or notes…" aria-label="Search transactions" className="w-full rounded-lg border-line py-2 pl-9 pr-3 text-xs" /></label>
          <select aria-label="Filter by transaction type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-lg border-line py-2 pl-3 pr-7 text-xs"><option value="">All types</option><option value="expense">Expenses</option><option value="income">Income</option></select>
          <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border-line py-2 pl-3 pr-7 text-xs"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select aria-label="Filter by payment method" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="rounded-lg border-line py-2 pl-3 pr-7 text-xs"><option value="">All payment methods</option>{Object.entries(methodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label="Sort transactions" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-lg border-line py-2 pl-3 pr-7 text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="high">Highest amount</option><option value="low">Lowest amount</option></select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="flex items-center gap-1.5 text-muted"><Filter size={13} /> Date</span><input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-lg border-line py-1.5 text-xs" /><span className="text-muted">to</span><input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-lg border-line py-1.5 text-xs" /><span className="ml-1 text-muted">Amount</span><input aria-label="Minimum transaction amount" type="number" min="0" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="Min" className="w-24 rounded-lg border-line py-1.5 text-xs" /><input aria-label="Maximum transaction amount" type="number" min="0" step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Max" className="w-24 rounded-lg border-line py-1.5 text-xs" />{(from || to || minAmount || maxAmount || categoryFilter || methodFilter || typeFilter || search) && <button onClick={clearFilters} className="ml-auto text-xs font-semibold text-forest">Clear filters</button>}<button onClick={() => setCategoryModal(true)} className="ml-auto text-xs font-semibold text-forest sm:hidden">Manage categories</button></div>
      </div>
      {shown.length ? <div className="divide-y divide-line">
        {shown.map((transaction) => {
          const category = categories.find((item) => item.id === transaction.category_id);
          const source = sources.find((item) => item.id === transaction.payment_source_id);
          return <div key={transaction.id} className="group flex items-center gap-2">
            <div className="min-w-0 flex-1"><TransactionRow transaction={transaction} category={category} source={source?.label} currency={currency} timezone={timezone} /></div>
            <div className="mr-3 flex shrink-0 gap-1 opacity-100 sm:mr-5 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button onClick={() => openTransaction(transaction)} aria-label={`Edit ${transaction.title}`} className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-forest"><SlidersHorizontal size={15} /></button>
              <button onClick={() => void remove(transaction)} aria-label={`Delete ${transaction.title}`} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
            </div>
          </div>;
        })}
      </div> : <Empty title={transactions.length ? "No matching transactions" : "A fresh start"} body={transactions.length ? "Try a different search or clear some filters." : "Your purchases and income will appear here once you add them."} action={transactions.length ? <button onClick={clearFilters} className="text-xs font-semibold text-forest">Clear filters</button> : <button onClick={() => openTransaction("new")} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">Add transaction</button>} />}
      {filtered.length > 0 && <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted"><span>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span><div className="flex gap-1"><button disabled={page === 0} onClick={() => setCurrentPage((value) => value - 1)} aria-label="Previous page" className="rounded-lg p-1.5 hover:bg-canvas disabled:opacity-30"><ChevronLeft size={17} /></button><button disabled={page >= pages - 1} onClick={() => setCurrentPage((value) => value + 1)} aria-label="Next page" className="rounded-lg p-1.5 hover:bg-canvas disabled:opacity-30"><ChevronRight size={17} /></button></div></div>}
    </Card>
    {categoryModal && <CategoryDialog categories={categories} ownerId={userId} reload={reload} notify={notify} close={() => setCategoryModal(false)} />}
  </>;
}

function TransactionDialog({ transaction, categories, sources, currency, close, saved }: { transaction: Transaction | null; categories: Category[]; sources: PaymentSource[]; currency: string; close: () => void; saved: (warning?: string) => Promise<void> }) {
  const [title, setTitle] = useState(transaction?.title ?? "");
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [type, setType] = useState<TransactionType>(transaction?.type ?? "expense");
  const [categoryId, setCategoryId] = useState(transaction?.category_id ?? "");
  const [method, setMethod] = useState<PaymentMethod>(transaction?.payment_method ?? "upi");
  const [sourceId, setSourceId] = useState(transaction?.payment_source_id ?? "");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue(transaction?.occurred_at));
  const [notes, setNotes] = useState(transaction?.notes ?? "");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const availableSources = sources.filter((source) => !source.archived && source.kind === method);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || !occurredAt) {
      setError("Add a description, a positive amount, and a date.");
      return;
    }
    if (!supabase) { setError("Supabase isn't available. Check your setup and try again."); return; }
    setBusy(true); setError("");
    let uploadedReceiptPath: string | null = null;
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error("Please sign in again.");
      let receiptPath = transaction?.receipt_path ?? null;
      if (receipt) {
        if (receipt.size > 5 * 1024 * 1024) throw new Error("Receipt files must be 5 MB or smaller.");
        if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(receipt.type)) throw new Error("Upload a JPG, PNG, WebP, or PDF receipt.");
              const ownedPath = `${userData.user.id}/${crypto.randomUUID()}-${receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage.from("receipts").upload(ownedPath, receipt, { contentType: receipt.type, upsert: false });
        if (uploadError) throw uploadError;
        receiptPath = ownedPath;
        uploadedReceiptPath = ownedPath;
      }
      const payload = {
        owner_id: transaction?.owner_id ?? userData.user.id,
        title: title.trim(), amount: numericAmount, type, category_id: categoryId || null,
        payment_method: method, payment_source_id: sourceId || null,
        occurred_at: new Date(occurredAt).toISOString(), notes: notes.trim() || null, receipt_path: receiptPath,
      };
      const result = transaction
        ? await supabase.from("transactions").update(payload).eq("id", transaction.id)
        : await supabase.from("transactions").insert(payload);
      if (result.error) throw result.error;
      let warning: string | undefined;
      if (receipt && transaction?.receipt_path && transaction.receipt_path !== receiptPath) {
        const { error: removeError } = await supabase.storage.from("receipts").remove([transaction.receipt_path]);
        if (removeError) warning = `Transaction saved, but the previous receipt couldn't be removed: ${removeError.message}`;
      }
      await saved(warning);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The transaction couldn't be saved.";
      if (uploadedReceiptPath) {
        const { error: cleanupError } = await supabase.storage.from("receipts").remove([uploadedReceiptPath]);
        setError(cleanupError ? `${message} The uploaded receipt also couldn't be removed: ${cleanupError.message}` : message);
      } else setError(message);
    } finally { setBusy(false); }
  }
  const receiptLink = async () => {
    if (!transaction?.receipt_path || !supabase) return;
    const { data, error: urlError } = await supabase.storage.from("receipts").createSignedUrl(transaction.receipt_path, 60);
    if (urlError) { setError(urlError.message); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  return <Modal title={transaction ? "Edit transaction" : "Add a transaction"} close={close} description={`Keep the details that help you understand your ${type === "expense" ? "spending" : "income"}.`}>
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f2f4f2] p-1"><button type="button" onClick={() => setType("expense")} className={`rounded-lg py-2 text-xs font-semibold ${type === "expense" ? "bg-white text-ink shadow-sm" : "text-muted"}`}>Expense</button><button type="button" onClick={() => setType("income")} className={`rounded-lg py-2 text-xs font-semibold ${type === "income" ? "bg-white text-ink shadow-sm" : "text-muted"}`}>Income</button></div>
      <Field label="Description or merchant"><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Coffee with Maya" autoFocus /></Field>
      <div className="grid grid-cols-[1fr_1.2fr] gap-3"><Field label={`Amount (${currency})`}><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></Field><Field label="Date and time"><input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Category"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}</select></Field><Field label="Payment method"><select value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); setSourceId(""); }}>{Object.entries(methodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
      {availableSources.length > 0 && <Field label="Card or UPI account (optional)"><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Not specified</option>{availableSources.map((source) => <option key={source.id} value={source.id}>{source.label}{source.last_four ? ` ···· ${source.last_four}` : ""}</option>)}</select></Field>}
      <Field label="Notes (optional)"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Anything worth remembering?" className="block w-full rounded-xl border-line text-sm" /></Field>
      <Field label="Receipt (optional)"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} className="block w-full rounded-xl border border-line bg-white px-3 py-2 text-xs" /><span className="mt-1 block text-[10px] text-muted">Private upload · image or PDF · up to 5 MB</span>{transaction?.receipt_path && <button type="button" onClick={() => void receiptLink()} className="mt-1 text-xs font-semibold text-forest underline">View current receipt</button>}</Field>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2 pt-1"><button type="button" onClick={close} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button><button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : transaction ? "Save changes" : "Save transaction"}</button></div>
    </form>
  </Modal>;
}

function Modal({ title, description, close, children }: { title: string; description?: string; close: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#18251e]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><motion.section initial={{ y: 12, opacity: .8 }} animate={{ y: 0, opacity: 1 }} className="max-h-[92vh] w-full max-w-[500px] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><div className="mb-5 flex items-start justify-between"><div><h2 id="modal-heading" className="font-display text-xl font-bold tracking-tight">{title}</h2>{description && <p className="mt-1 text-xs text-muted">{description}</p>}</div><button onClick={close} aria-label="Close dialog" className="rounded-lg p-1.5 text-muted hover:bg-canvas"><X size={18} /></button></div>{children}</motion.section></div>;
}

function CategoryDialog({ categories, ownerId, reload, notify, close }: { categories: Category[]; ownerId: string; reload: () => Promise<void>; notify: (message: string) => void; close: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("✦");
  const [color, setColor] = useState("#5B9B74");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !supabase) { setError("Add a category name."); return; }
    setBusy(true); setError("");
    const result = editing
      ? await supabase.from("categories").update({ name: name.trim(), icon, color }).eq("id", editing)
      : await supabase.from("categories").insert({ owner_id: ownerId, name: name.trim(), icon, color });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    setName(""); setIcon("✦"); setColor("#5B9B74"); setEditing(null); await reload(); notify("Category saved.");
  }
  async function remove(category: Category) {
    if (category.is_default) { setError("Default categories are part of your Spendly setup and can't be deleted."); return; }
    if (!window.confirm(`Delete “${category.name}”? Any linked transactions will become uncategorized. This won't delete the transactions themselves.`)) return;
    if (!supabase) return;
    const { error: deleteError } = await supabase.rpc("delete_category", { p_category_id: category.id });
    if (deleteError) { setError(deleteError.message); return; }
    await reload(); notify("Category removed; transactions are uncategorized.");
  }
  const colors = ["#5B9B74", "#D18460", "#6F83B1", "#D6A451", "#9A78A9", "#5A9B9B", "#C16B7B", "#7D897F"];
  return <Modal title="Manage categories" description="Make your spending categories feel like yours." close={close}>
    <form onSubmit={(event) => void save(event)} className="mb-5 rounded-xl bg-[#f6f7f5] p-3">
      <label className="block text-xs font-semibold">Category name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Wellness" className="mt-1.5 block w-full rounded-lg border-line text-sm" /></label>
      <div className="mt-3 flex items-center gap-2"><label className="sr-only" htmlFor="category-icon">Icon</label><input id="category-icon" value={icon} maxLength={3} onChange={(event) => setIcon(event.target.value)} className="w-16 rounded-lg border-line text-center text-lg" /><div className="flex flex-1 flex-wrap gap-2">{colors.map((value) => <button key={value} type="button" aria-label={`Use ${value} category color`} onClick={() => setColor(value)} className={`h-6 w-6 rounded-full ${color === value ? "ring-2 ring-offset-2 ring-ink" : ""}`} style={{ background: value }} />)}</div><button disabled={busy} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">{editing ? "Update" : "Add"}</button></div>
      {editing && <button type="button" onClick={() => { setEditing(null); setName(""); setIcon("✦"); }} className="mt-2 text-xs text-muted underline">Cancel edit</button>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </form>
    <div className="max-h-[320px] divide-y divide-line overflow-y-auto">{categories.map((category) => <div key={category.id} className="flex items-center gap-3 py-3"><span className="grid h-8 w-8 place-items-center rounded-lg text-sm" style={{ background: `${category.color}20`, color: category.color }}>{category.icon}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{category.name}</p>{category.is_default && <p className="text-[10px] text-muted">Default</p>}</div><button onClick={() => { setEditing(category.id); setName(category.name); setIcon(category.icon); setColor(category.color); }} aria-label={`Edit ${category.name}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><SlidersHorizontal size={14} /></button><button onClick={() => void remove(category)} aria-label={`Delete ${category.name}`} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button></div>)}</div>
  </Modal>;
}

function monthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function addMonth(month: string, delta: number) {
  const date = new Date(`${month}T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  return monthInput(date);
}

function BudgetsPage({ profile, updateProfile, budgets, transactions, categories, currency, reload, notify }: { profile: Profile; updateProfile: (updates: Partial<Profile>) => Promise<void>; budgets: Budget[]; transactions: Transaction[]; categories: Category[]; currency: string; reload: () => Promise<void>; notify: (message: string) => void }) {
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
  const monthDate = new Date(`${month}T00:00:00`);
  const monthTitle = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(monthDate);
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

function AnalyticsPage({ transactions, categories, sources, budgets, monthlyBudget, timezone, currency }: { transactions: Transaction[]; categories: Category[]; sources: PaymentSource[]; budgets: Budget[]; monthlyBudget: number; timezone: string; currency: string }) {
  const [range, setRange] = useState("30");
  const [type, setType] = useState<TransactionType>("expense");
  const days = Number(range);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days + 1);
  const filtered = transactions.filter((item) => item.type === type && new Date(item.occurred_at) >= cutoff);
  const breakdown = categorySpending(filtered, categories, type);
  const trend = useMemo(() => makeAnalyticsTrend(filtered, days, timezone), [filtered, days, timezone]);
  const byMethod = Object.entries(methodLabels).map(([method, label]) => ({
    label,
    amount: sumMoneyAmounts(filtered.filter((item) => item.payment_method === method).map((item) => item.amount)),
  })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const bySource = sources.map((source) => ({
    label: source.label,
    amount: sumMoneyAmounts(filtered.filter((item) => item.payment_source_id === source.id).map((item) => item.amount)),
  })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const topMerchants = Object.entries(filtered.reduce<Record<string, number>>((acc, item) => {
    acc[item.title] = (acc[item.title] ?? 0) + amountInMinorUnits(item.amount);
    return acc;
  }, {})).map(([label, amount]) => ({ label, amount: amount / 100 })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const total = sumMoneyAmounts(filtered.map((item) => item.amount));
  const budgetHistory = Array.from({ length: 6 }, (_, index) => {
    const month = addMonth(monthBounds(new Date(), timezone).start, index - 5);
    const monthlyExpenses = transactionsInMonth(transactions, month, timezone);
    return {
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${month}T12:00:00Z`)),
      actual: sumByType(monthlyExpenses, "expense"),
      target: Number(budgets.find((budget) => budget.month_start === month && !budget.category_id)?.amount ?? monthlyBudget),
    };
  });
  return <>
    <PageHeading eyebrow="YOUR MONEY, UNDERSTOOD" title="Analytics" description="Patterns from your real transactions. No estimates, no filler." action={<div className="flex gap-2"><select aria-label="Analytics transaction type" value={type} onChange={(event) => setType(event.target.value as TransactionType)} className="rounded-xl border-line bg-white py-2.5 text-xs"><option value="expense">Expenses</option><option value="income">Income</option></select><select aria-label="Analytics date range" value={range} onChange={(event) => setRange(event.target.value)} className="rounded-xl border-line bg-white py-2.5 text-xs"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select></div>} />
    <div className="grid gap-4 sm:grid-cols-3"><Metric title={`${type === "expense" ? "Expenses" : "Income"} in range`} value={formatCurrency(total, currency)} icon={type === "expense" ? ArrowUpRight : ArrowDownLeft} iconTone={type === "expense" ? "peach" : "mint"} foot={`Last ${days} days`} positive={type === "income"} /><Metric title="Transactions" value={String(filtered.length)} icon={ArrowLeftRight} iconTone="lavender" foot="In selected period" /><Metric title="Daily average" value={formatCurrency(filtered.length ? total / Math.max(1, days) : 0, currency)} icon={Activity} iconTone="mint" foot="Across the selected date range" /></div>
    {!filtered.length && <div className="mt-5"><Card><Empty title="Nothing to chart just yet" body="Add transactions in this date range and your analytics will appear here. Change the range to explore your history." /></Card></div>}
    {filtered.length > 0 && <>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card><div className="mb-4"><h2 className="font-display text-base font-bold">{type === "expense" ? "Spending" : "Income"} over time</h2><p className="mt-1 text-xs text-muted">Daily totals · {currency}</p></div><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 10, left: -20, right: 3, bottom: 0 }}><defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4a9a70" stopOpacity={.17} /><stop offset="100%" stopColor="#4a9a70" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0ed" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} minTickGap={20} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} /><Tooltip formatter={(value: number) => [formatCurrency(value, currency), type === "expense" ? "Spent" : "Income"]} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 12 }} /><Area type="monotone" dataKey="amount" stroke="#35825a" strokeWidth={2} fill="url(#analyticsFill)" /></AreaChart></ResponsiveContainer></div><p className="sr-only">Total {type} in this period: {formatCurrency(total, currency)} across {filtered.length} transactions.</p></Card>
        <Card><div className="mb-4"><h2 className="font-display text-base font-bold">By category</h2><p className="mt-1 text-xs text-muted">{type === "expense" ? "How spending is distributed" : "Categorized income"}</p></div>{breakdown.length ? <><div className="h-[180px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="amount" nameKey="category.name" innerRadius={45} outerRadius={76} paddingAngle={3} stroke="none">{breakdown.map((item) => <Cell key={item.category.id} fill={item.category.color} />)}</Pie><Tooltip formatter={(value: number) => formatCurrency(value, currency)} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 12 }} /></PieChart></ResponsiveContainer></div><div className="max-h-36 space-y-2 overflow-y-auto">{breakdown.map(({ category, amount }) => <div key={category.id} className="flex justify-between text-xs"><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: category.color }} />{category.name}</span><span className="font-semibold">{formatCurrency(amount, currency)} <span className="font-normal text-muted">{total ? `${(amount / total * 100).toFixed(0)}%` : ""}</span></span></div>)}</div></> : <p className="py-12 text-center text-xs text-muted">Add a category to your transactions to see the breakdown.</p>}</Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <Card><h2 className="font-display text-base font-bold">By payment method</h2><p className="mt-1 text-xs text-muted">Where transactions were paid</p>{byMethod.length ? <div className="mt-5 space-y-4">{byMethod.map((item) => <div key={item.label}><div className="mb-1.5 flex justify-between text-xs"><span>{item.label}</span><span className="font-semibold">{formatCurrency(item.amount, currency)}</span></div><div className="h-1.5 rounded-full bg-[#edf0ed]"><div className="h-full rounded-full bg-[#5b9b74]" style={{ width: `${item.amount / total * 100}%` }} /></div></div>)}</div> : <Empty title="No payment mix yet" body="Add a payment method to your transactions." />}</Card>
        <Card><h2 className="font-display text-base font-bold">By card or account</h2><p className="mt-1 text-xs text-muted">Transactions linked to a source</p>{bySource.length ? <div className="mt-4 divide-y divide-line">{bySource.map((item) => <div key={item.label} className="flex justify-between py-3 text-xs"><span>{item.label}</span><span className="font-semibold">{formatCurrency(item.amount, currency)}</span></div>)}</div> : <Empty title="No linked cards yet" body="Add a card or UPI label in Card Vault and link it to transactions." />}</Card>
        <Card><h2 className="font-display text-base font-bold">Top merchants</h2><p className="mt-1 text-xs text-muted">By total {type === "expense" ? "spent" : "received"}</p>{topMerchants.length ? <div className="mt-4 divide-y divide-line">{topMerchants.map((item, index) => <div key={item.label} className="flex items-center gap-3 py-3"><span className="grid h-6 w-6 place-items-center rounded-lg bg-[#f1f4f1] text-[10px] font-bold text-muted">{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs">{item.label}</span><span className="text-xs font-semibold">{formatCurrency(item.amount, currency)}</span></div>)}</div> : <Empty title="No merchants yet" body="Merchant totals appear as you add transactions." />}</Card>
        <Card className="xl:col-span-2"><h2 className="font-display text-base font-bold">Budget performance</h2><p className="mt-1 text-xs text-muted">Actual expenses compared with monthly targets</p><div className="mt-4 flex gap-4 text-[10px] text-muted"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#5b9b74]" />Actual</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#dfe8df]" />Target</span></div><div className="mt-2 h-[190px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={budgetHistory} barGap={4} margin={{ top: 8, right: 2, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0ed" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#919b94" }} /><Tooltip formatter={(value: number, name: string) => [formatCurrency(value, currency), name === "actual" ? "Actual" : "Target"]} contentStyle={{ borderRadius: 12, border: "1px solid #e8ebe7", fontSize: 11 }} /><Bar dataKey="target" name="target" fill="#dfe8df" radius={[4, 4, 0, 0]} /><Bar dataKey="actual" name="actual" fill="#5b9b74" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><p className="sr-only">Budget performance chart compares actual and target monthly amounts over the past six months.</p></Card>
      </div>
    </>}
  </>;
}

function SharedPage({ groups, invitations, members, expenses, splits, settlements, categories, userId, currency, timezone, reload, notify }: { groups: Group[]; invitations: GroupInvitation[]; members: GroupMember[]; expenses: SharedExpense[]; splits: ExpenseSplit[]; settlements: Settlement[]; categories: Category[]; userId: string; currency: string; timezone: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showExpense, setShowExpense] = useState(false);
  const [settleTo, setSettleTo] = useState("");
  const [settleAmount, setSettleAmount] = useState("");
  const activeGroup = groups.find((group) => group.id === selectedId) ?? groups[0];
  const groupMembers = members.filter((member) => member.group_id === activeGroup?.id);
  const groupExpenses = expenses.filter((expense) => expense.group_id === activeGroup?.id);
  const groupSettlements = settlements.filter((settlement) => settlement.group_id === activeGroup?.id);
  const groupInvites = invitations.filter((invite) => invite.group_id === activeGroup?.id);

  useEffect(() => { if (!selectedId && groups.length) setSelectedId(groups[0].id); }, [groups, selectedId]);

  const balanceMap = new Map<string, number>();
  for (const member of groupMembers) balanceMap.set(member.user_id, 0);
  for (const expense of groupExpenses) {
    for (const split of splits.filter((entry) => entry.expense_id === expense.id)) balanceMap.set(split.user_id, (balanceMap.get(split.user_id) ?? 0) + amountInMinorUnits(split.amount_owed));
    if (expense.paid_by) balanceMap.set(expense.paid_by, (balanceMap.get(expense.paid_by) ?? 0) - amountInMinorUnits(expense.amount));
  }
  for (const settlement of groupSettlements) {
    balanceMap.set(settlement.payer_id, (balanceMap.get(settlement.payer_id) ?? 0) - amountInMinorUnits(settlement.amount));
    balanceMap.set(settlement.payee_id, (balanceMap.get(settlement.payee_id) ?? 0) + amountInMinorUnits(settlement.amount));
  }
  const myBalanceMinor = balanceMap.get(userId) ?? 0;
  const myBalance = myBalanceMinor / 100;
  const nameOf = (id: string | null) => id ? groupMembers.find((member) => member.user_id === id)?.profile?.display_name ?? (id === userId ? "You" : "Member") : "Former member";

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupName.trim() || !supabase) { setError("Enter a name for your group."); return; }
    setBusy(true); setError("");
    const result = await supabase.rpc("create_group", { p_name: groupName.trim() });
    setBusy(false);
    if (result.error) { setError(`Group creation failed: ${formatSupabaseError(result.error)}`); return; }
    if (!result.data) { setError("Group creation returned no group ID. Please try again."); return; }
    setGroupName(""); setSelectedId(result.data); await reload(); notify("Your group is ready.");
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!activeGroup || !supabase || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) { setError("Enter a valid email address."); return; }
    setBusy(true); setError("");
    const { data: token, error: inviteError } = await supabase.rpc("create_group_invitation", { p_group_id: activeGroup.id, p_email: inviteEmail.trim().toLowerCase() });
    setBusy(false);
    if (inviteError) { setError(inviteError.message); return; }
    const link = `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
    setInviteLink(link);
    setInviteEmail("");
    try { await navigator.clipboard.writeText(link); notify("Invite link copied. Share it directly with your friend."); }
    catch { notify("Invite link created. Copy it below to share."); }
    await reload();
  }

  async function settle(event: FormEvent) {
    event.preventDefault();
    const value = Number(settleAmount);
    if (!Number.isFinite(value) || value <= 0) { setError("Enter a valid settlement amount."); return; }
    let valueMinor: number;
    try { valueMinor = amountInMinorUnits(settleAmount); }
    catch { setError("Enter a settlement amount with up to two decimal places."); return; }
    const otherBalanceMinor = balanceMap.get(settleTo) ?? 0;
    if (!activeGroup || !supabase || myBalanceMinor <= 0 || otherBalanceMinor >= 0 || valueMinor > Math.min(myBalanceMinor, Math.abs(otherBalanceMinor))) {
      setError("Enter an amount no greater than the outstanding amount you owe this member.");
      return;
    }
    setBusy(true); setError("");
    const { error: saveError } = await supabase.rpc("record_settlement", {
      p_group_id: activeGroup.id,
      p_payee_id: settleTo,
      p_amount: value,
      p_paid_at: new Date().toISOString(),
      p_note: null,
    });
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    setSettleAmount(""); await reload(); notify("Settlement recorded.");
  }

  return <>
    <PageHeading eyebrow="MONEY, TOGETHER" title="Shared expenses" description="Keep group costs clear, and settling up simple." action={groups.length > 0 ? <button onClick={() => setShowExpense(true)} className="flex items-center gap-2 rounded-xl bg-forest px-3.5 py-2.5 text-xs font-semibold text-white"><Plus size={16} /> Add shared expense</button> : undefined} />
    <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
      <div className="space-y-5">
        {!groups.length ? <Card><Empty title="Make the first group" body="Create a group for a trip, a shared home, or anything you split with friends." /></Card> : <>
          <Card className="!p-4"><div className="flex flex-wrap items-center justify-between gap-3"><label className="text-xs font-semibold">Your groups<select value={activeGroup?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} className="ml-3 min-w-[180px] rounded-lg border-line py-2 text-xs font-medium">{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><span className="rounded-full bg-mint px-2.5 py-1 text-[10px] font-semibold text-forest">{groupMembers.length} {groupMembers.length === 1 ? "member" : "members"}</span></div></Card>
          <Card><div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-base font-bold">Group balance</h2><p className="mt-1 text-xs text-muted">Your net position, based on shared expenses and recorded settlements.</p></div><div className={`text-right ${myBalance > .005 ? "text-[#bd7356]" : myBalance < -.005 ? "text-forest" : "text-muted"}`}><p className="text-[10px] font-medium">{myBalance > .005 ? "You owe" : myBalance < -.005 ? "You are owed" : "All settled"}</p><p className="font-display text-lg font-bold">{formatCurrency(Math.abs(myBalance), currency)}</p></div></div>
            <div className="divide-y divide-line">{groupMembers.map((member) => { const balanceMinor = balanceMap.get(member.user_id) ?? 0; const balance = balanceMinor / 100; return <div key={member.user_id} className="flex items-center gap-3 py-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#edf3ee] text-xs font-bold text-forest">{nameOf(member.user_id).slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{nameOf(member.user_id)} {member.user_id === userId && <span className="font-normal text-muted">(you)</span>}</p><p className="text-[10px] text-muted">{member.role === "owner" ? "Group owner" : "Member"}</p></div><span className={`text-xs font-semibold ${balanceMinor > 0 ? "text-[#bd7356]" : balanceMinor < 0 ? "text-forest" : "text-muted"}`}>{balanceMinor > 0 ? `owes ${formatCurrency(balance, currency)}` : balanceMinor < 0 ? `is owed ${formatCurrency(Math.abs(balance), currency)}` : "settled"}</span></div>; })}</div>
          </Card>
          <Card className="!p-0"><div className="border-b border-line px-5 py-4"><h2 className="font-display text-base font-bold">Shared expenses</h2><p className="mt-1 text-xs text-muted">Recent activity in {activeGroup?.name}</p></div>{groupExpenses.length ? <div className="divide-y divide-line">{groupExpenses.map((expense) => {
            const expenseSplits = splits.filter((split) => split.expense_id === expense.id);
            return <div key={expense.id} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{expense.title}</p><p className="mt-1 text-[10px] text-muted">{nameOf(expense.paid_by)} paid · {dateLabel(expense.occurred_at, timezone)}</p></div><p className="shrink-0 text-sm font-semibold">{formatCurrency(expense.amount, currency)}</p></div><div className="mt-3 flex flex-wrap gap-1.5">{expenseSplits.map((split) => <span key={split.id} className="rounded-full bg-[#f3f5f3] px-2.5 py-1 text-[10px] text-[#627067]">{nameOf(split.user_id)} · {formatCurrency(split.amount_owed, currency)}</span>)}</div></div>;
          })}</div> : <Empty title="Nothing shared yet" body="Add the first group expense and choose how to split it." action={<button onClick={() => setShowExpense(true)} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">Add expense</button>} />}</Card>
          <Card><h2 className="font-display text-base font-bold">Settlements</h2>{groupSettlements.length ? <div className="mt-2 divide-y divide-line">{groupSettlements.map((settlement) => <div key={settlement.id} className="flex justify-between py-3 text-xs"><span>{nameOf(settlement.payer_id)} paid {nameOf(settlement.payee_id)} · {dateLabel(settlement.paid_at, timezone)}</span><strong>{formatCurrency(settlement.amount, currency)}</strong></div>)}</div> : <p className="mt-2 text-xs text-muted">Settlements you record will show here.</p>}</Card>
        </>}
        <Card><h2 className="font-display text-base font-bold">Create a group</h2><p className="mt-1 text-xs text-muted">You can start a group even before inviting anyone.</p><form onSubmit={(event) => void createGroup(event)} className="mt-3 flex gap-2"><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Goa weekend" aria-label="New group name" className="min-w-0 flex-1 rounded-lg border-line text-xs" /><button disabled={busy} className="rounded-lg bg-[#edf4ee] px-3 py-2 text-xs font-semibold text-forest">Create group</button></form></Card>
      </div>
      <div className="space-y-5">
        <Card><div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><Users size={17} /></div><h2 className="font-display text-base font-bold">Bring your people in</h2><p className="mt-1 text-xs leading-5 text-muted">Create a secure, expiring invite link to share directly. Spendly won't email anyone until an email provider is configured.</p>
          {groups.length ? <form onSubmit={(event) => void invite(event)} className="mt-4 space-y-2"><label className="block text-xs font-semibold">Invite by email<input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="friend@example.com" className="mt-1.5 block w-full rounded-lg border-line text-xs" /></label><button disabled={busy} className="w-full rounded-lg bg-forest py-2.5 text-xs font-semibold text-white">{busy ? "Creating link…" : "Create invite link"}</button></form> : <p className="mt-3 rounded-lg bg-[#f4f6f4] p-3 text-xs text-muted">Create a group first to invite members.</p>}
          {inviteLink && <div className="mt-3"><label className="text-[10px] font-semibold text-muted">One-time invite link<input readOnly value={inviteLink} onFocus={(event) => event.target.select()} className="mt-1 block w-full rounded-lg border-line bg-[#f7f8f7] text-[10px]" /></label><button onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => notify("Invite link copied.")).catch(() => notify("Select and copy the invite link above."))} className="mt-2 text-xs font-semibold text-forest underline">Copy link</button></div>}
          {groupInvites.filter((invite) => !invite.accepted_at && new Date(invite.expires_at) > new Date()).length > 0 && <div className="mt-4 border-t border-line pt-3"><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Pending invites</p>{groupInvites.filter((invite) => !invite.accepted_at && new Date(invite.expires_at) > new Date()).map((invite) => <p key={invite.id} className="py-1 text-xs">{invite.email} <span className="text-muted">· expires {dateLabel(invite.expires_at, timezone)}</span></p>)}</div>}
        </Card>
        {groups.length > 0 && <Card><h2 className="font-display text-base font-bold">Record a settlement</h2><p className="mt-1 text-xs leading-5 text-muted">Use this after a real-world payment; Spendly does not transfer money.</p>{myBalanceMinor > 0 ? <form onSubmit={(event) => void settle(event)} className="mt-4 space-y-3"><Field label="Paying"><input readOnly value="You" /></Field><Field label="Paying back"><select value={settleTo} onChange={(event) => setSettleTo(event.target.value)}><option value="">Choose a member</option>{groupMembers.filter((member) => (balanceMap.get(member.user_id) ?? 0) < 0).map((member) => <option key={member.user_id} value={member.user_id}>{nameOf(member.user_id)} · owed {formatCurrency(Math.abs(balanceMap.get(member.user_id) ?? 0) / 100, currency)}</option>)}</select></Field><Field label={`Amount (up to ${formatCurrency(Math.min(myBalanceMinor, Math.abs(balanceMap.get(settleTo) ?? 0)) / 100, currency)})`}><input type="number" step="0.01" min="0.01" value={settleAmount} onChange={(event) => setSettleAmount(event.target.value)} /></Field><button disabled={busy} className="w-full rounded-lg bg-[#edf4ee] py-2.5 text-xs font-semibold text-forest">Record settlement</button></form> : <p className="mt-3 rounded-lg bg-[#f4f6f4] p-3 text-xs text-muted">{myBalanceMinor < 0 ? "You're owed money. A member can record a payment back to you." : "You don't owe anything in this group right now."}</p>}</Card>}
      </div>
    </div>
    {error && <div role="alert" className="fixed bottom-20 left-1/2 z-[80] max-w-[90vw] -translate-x-1/2 rounded-xl bg-red-700 px-4 py-3 text-xs text-white shadow-lg">{error}<button onClick={() => setError("")} aria-label="Dismiss error" className="ml-3">×</button></div>}
    {showExpense && activeGroup && <SharedExpenseDialog group={activeGroup} members={groupMembers} categories={categories} currency={currency} userId={userId} close={() => setShowExpense(false)} saved={async () => { setShowExpense(false); await reload(); notify("Shared expense added."); }} />}
  </>;
}

function SharedExpenseDialog({ group, members, categories, currency, userId, close, saved }: { group: Group; members: GroupMember[]; categories: Category[]; currency: string; userId: string; close: () => void; saved: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState(userId);
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(localDateTimeValue());
  const [mode, setMode] = useState<"equal" | "shares" | "amounts">("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const numericAmount = Number(amount);
  let shares: number[];
  try {
    shares = mode === "equal"
      ? splitAmount(numericAmount || 0, members.map(() => 1))
      : mode === "shares"
        ? splitAmount(numericAmount || 0, members.map((member) => Number(values[member.user_id] || 0)))
        : members.map((member) => Number(values[member.user_id] || 0));
  } catch {
    shares = members.map(() => 0);
  }
  const validShares = shares.every((share) => Number.isFinite(share) && share >= 0);
  const splitTotal = validShares ? sumMoneyAmounts(shares) : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || !date) { setError("Add a description, positive amount, and date."); return; }
    let expenseTotalMinor: number;
    try { expenseTotalMinor = amountInMinorUnits(amount); }
    catch { setError("Use an amount with no more than two decimal places."); return; }
    if (!validShares) { setError("Enter valid split amounts or shares for everyone."); return; }
    if (mode === "shares" && members.reduce((sum, member) => sum + Number(values[member.user_id] || 0), 0) <= 0) { setError("Add at least one share."); return; }
    if (mode === "amounts" && shares.reduce((sum, share) => sum + amountInMinorUnits(share), 0) !== expenseTotalMinor) { setError("Custom split amounts must add up exactly to the expense total."); return; }
    setBusy(true); setError("");
    try {
      const { error: expenseError } = await supabase.rpc("create_shared_expense", {
        p_group_id: group.id,
        p_title: title.trim(),
        p_amount: numericAmount,
        p_paid_by: payer,
        p_occurred_at: new Date(date).toISOString(),
        p_category_id: categoryId || null,
        p_splits: members.map((member, index) => ({ user_id: member.user_id, amount_owed: shares[index] })),
      });
      if (expenseError) throw expenseError;
      await saved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The shared expense couldn't be saved."); }
    finally { setBusy(false); }
  }
  const getShares = () => {
    try { return shares; } catch { return members.map(() => 0); }
  };
  const shownShares = getShares();
  return <Modal title="Add shared expense" description={`Split a cost with ${group.name}. No money is transferred in Spendly.`} close={close}><form onSubmit={(event) => void submit(event)} className="space-y-4">
    <Field label="Expense description"><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Dinner at Olive" /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label={`Total amount (${currency})`}><input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Paid by"><select value={payer} onChange={(event) => setPayer(event.target.value)}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.profile?.display_name ?? (member.user_id === userId ? "You" : "Member")}</option>)}</select></Field></div>
    <Field label="Date and time"><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
    <Field label="Category (optional)"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}</select></Field>
    <fieldset><legend className="mb-2 text-xs font-semibold text-[#56645b]">Split style</legend><div className="grid grid-cols-3 gap-1 rounded-lg bg-[#f2f4f2] p-1">{(["equal", "shares", "amounts"] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-md py-2 text-[10px] font-semibold capitalize ${mode === item ? "bg-white shadow-sm" : "text-muted"}`}>{item === "shares" ? "By shares" : item === "amounts" ? "Custom amounts" : "Equally"}</button>)}</div></fieldset>
    {mode !== "equal" && <div className="space-y-2">{members.map((member) => <label key={member.user_id} className="flex items-center gap-2 text-xs"><span className="flex-1">{member.profile?.display_name ?? (member.user_id === userId ? "You" : "Member")}</span><input aria-label={`${mode === "shares" ? "Shares for" : "Amount for"} ${member.profile?.display_name ?? "member"}`} type="number" min="0" step={mode === "shares" ? "0.1" : "0.01"} value={values[member.user_id] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [member.user_id]: event.target.value }))} placeholder={mode === "shares" ? "1 share" : "0.00"} className="w-28 rounded-lg border-line text-xs" />{mode === "shares" && <span className="w-20 text-right text-muted">{formatCurrency(shownShares[members.indexOf(member)] ?? 0, currency)}</span>}</label>)}{mode === "amounts" && <p className={`text-right text-[10px] ${!validShares || Math.abs(splitTotal - numericAmount) > .005 ? "text-amber-700" : "text-forest"}`}>Split total: {validShares ? formatCurrency(splitTotal, currency) : "Enter valid amounts"} / {formatCurrency(numericAmount || 0, currency)}</p>}</div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    <div className="flex gap-2"><button type="button" onClick={close} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button><button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Add expense"}</button></div>
  </form></Modal>;
}

function VaultPage({ sources, transactions, currency, userId, reload, notify }: { sources: PaymentSource[]; transactions: Transaction[]; currency: string; userId: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [addSource, setAddSource] = useState(false);
  const [editing, setEditing] = useState<PaymentSource | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const visible = sources.filter((source) => showArchived || !source.archived);
  const total = (id: string) => sumMoneyAmounts(transactions.filter((transaction) => transaction.payment_source_id === id && transaction.type === "expense").map((item) => item.amount));
  return <>
    <PageHeading eyebrow="PAYMENT TRACKING" title="Card Vault" description="Keep safe labels for the cards and UPI accounts you use." action={<button onClick={() => setAddSource(true)} className="flex items-center gap-2 rounded-xl bg-forest px-3.5 py-2.5 text-xs font-semibold text-white"><Plus size={16} /> Add payment source</button>} />
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#e6e9e5] bg-white px-4 py-3.5"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-forest" /><p className="text-xs leading-5 text-muted"><strong className="text-ink">Safe by design:</strong> Spendly never collects full card numbers, CVVs, PINs, UPI PINs, or banking passwords. This vault is for tracking only — no payments are made.</p></div>
    <div className="mb-4 flex justify-end"><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="rounded border-line text-forest focus:ring-forest" />Show archived</label></div>
    {visible.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map((source) => {
      const isCard = source.kind === "credit_card" || source.kind === "debit_card";
      return <Card key={source.id} className="relative overflow-hidden !p-5">
        <div className="absolute -right-7 -top-9 h-32 w-32 rounded-full bg-[#edf5ef]" />
        <div className="relative flex items-start justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-mint text-forest">{isCard ? <CreditCard size={19} /> : <ArrowLeftRight size={19} />}</div><div className="flex gap-1"><button onClick={() => setEditing(source)} aria-label={`Edit ${source.label}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><SlidersHorizontal size={15} /></button><button onClick={async () => { if (!supabase) return; const { error } = await supabase.from("payment_sources").update({ archived: !source.archived }).eq("id", source.id); if (error) notify(error.message); else { await reload(); notify(source.archived ? "Payment source restored." : "Payment source archived."); } }} aria-label={source.archived ? `Restore ${source.label}` : `Archive ${source.label}`} className="rounded-lg p-2 text-muted hover:bg-canvas"><Ellipsis size={16} /></button></div></div>
        <p className="relative mt-5 font-display text-base font-bold">{source.label}</p><p className="relative mt-1 text-xs text-muted">{source.kind === "upi" ? "UPI account" : `${source.issuer || "Card"} · ${source.kind === "credit_card" ? "Credit" : "Debit"}${source.last_four ? ` ···· ${source.last_four}` : ""}`}</p>{source.masked_identifier && <p className="relative mt-1 text-[10px] text-muted">{source.masked_identifier}</p>}
        <div className="relative mt-5 flex items-end justify-between border-t border-line pt-3"><div><p className="text-[10px] text-muted">Tracked spending</p><p className="mt-1 text-sm font-semibold">{formatCurrency(total(source.id), currency)}</p></div>{source.archived && <span className="rounded-full bg-[#f1f3f1] px-2 py-1 text-[9px] font-semibold uppercase text-muted">Archived</span>}</div>
      </Card>;
    })}</div> : <Card><Empty title={showArchived ? "Nothing to show" : "Keep track of payment sources"} body="Add safe labels for your cards or UPI accounts. Spendly never stores sensitive payment credentials." action={<button onClick={() => setAddSource(true)} className="rounded-lg bg-forest px-3 py-2 text-xs font-semibold text-white">Add a source</button>} /></Card>}
    {(addSource || editing) && <PaymentSourceDialog source={editing} ownerId={userId} close={() => { setAddSource(false); setEditing(null); }} saved={async () => { setAddSource(false); setEditing(null); await reload(); notify("Payment source saved."); }} />}
  </>;
}

function PaymentSourceDialog({ source, ownerId, close, saved }: { source: PaymentSource | null; ownerId: string; close: () => void; saved: () => Promise<void> }) {
  const [label, setLabel] = useState(source?.label ?? "");
  const [kind, setKind] = useState<PaymentSourceKind>(source?.kind ?? "credit_card");
  const [issuer, setIssuer] = useState(source?.issuer ?? "");
  const [lastFour, setLastFour] = useState(source?.last_four ?? "");
  const [masked, setMasked] = useState(source?.masked_identifier ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !label.trim()) { setError("Enter a nickname or display label."); return; }
    if (lastFour && !/^\d{4}$/.test(lastFour)) { setError("Enter exactly 4 digits for the optional last-four display."); return; }
    if (masked.length > 80) { setError("Keep the masked identifier to 80 characters or fewer."); return; }
    setBusy(true); setError("");
    const payload = { owner_id: ownerId, label: label.trim(), kind, issuer: kind === "upi" ? null : issuer.trim() || null, last_four: kind === "upi" ? null : lastFour || null, masked_identifier: kind === "upi" ? masked.trim() || null : null };
    const result = source
      ? await supabase.from("payment_sources").update(payload).eq("id", source.id)
      : await supabase.from("payment_sources").insert(payload);
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    await saved();
  }
  return <Modal title={source ? "Edit payment source" : "Add payment source"} description="Only save safe display details. Never enter payment credentials." close={close}><form onSubmit={(event) => void submit(event)} className="space-y-4">
    <Field label="Source type"><select value={kind} onChange={(event) => setKind(event.target.value as PaymentSourceKind)}><option value="credit_card">Credit card</option><option value="debit_card">Debit card</option><option value="upi">UPI account</option></select></Field>
    <Field label={kind === "upi" ? "Display label" : "Nickname"}><input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder={kind === "upi" ? "e.g. Everyday UPI" : "e.g. Travel card"} /></Field>
    {kind !== "upi" ? <div className="grid grid-cols-2 gap-3"><Field label="Issuer (optional)"><input value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="e.g. HDFC" /></Field><Field label="Last four digits (optional)"><input inputMode="numeric" maxLength={4} value={lastFour} onChange={(event) => setLastFour(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" /></Field></div> : <Field label="Masked UPI identifier (optional)"><input value={masked} onChange={(event) => setMasked(event.target.value)} placeholder="e.g. a••••@bank" /></Field>}
    <p className="rounded-lg bg-[#f4f6f4] p-3 text-[10px] leading-4 text-muted">Never enter a full card number, security code, PIN, UPI PIN, or password.</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}<div className="flex gap-2"><button type="button" onClick={close} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button><button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white">{busy ? "Saving…" : "Save source"}</button></div>
  </form></Modal>;
}

function SettingsPage({ profile, updateProfile, email, notify, signOut }: { profile: Profile; updateProfile: (updates: Partial<Profile>) => Promise<void>; email: string; notify: (message: string) => void; signOut: () => void }) {
  const [name, setName] = useState(profile.display_name);
  const [currency, setCurrency] = useState(profile.currency);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !supabase) { setError("Enter your display name."); return; }
    setBusy(true); setError("");
    try { await updateProfile({ display_name: name.trim(), currency, timezone }); notify("Profile settings saved."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Settings couldn't be saved."); }
    finally { setBusy(false); }
  }
  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8 || !supabase) { setError("Choose a password with at least 8 characters."); return; }
    setBusy(true); setError("");
    const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (passwordError) { setError(passwordError.message); return; }
    setNewPassword(""); notify("Password updated.");
  }
  async function deleteAccount() {
    const confirmed = window.confirm("Delete your Spendly account permanently?\n\nThis removes your profile, transactions, budgets, categories, payment source labels, groups, shared expenses, invitations, and settlements. This action cannot be undone.");
    if (!confirmed || !supabase) return;
    setBusy(true); setError("");
    const { error: deleteError } = await supabase.rpc("delete_my_account");
    setBusy(false);
    if (deleteError) { setError(`Your account could not be deleted: ${deleteError.message}`); return; }
    await supabase.auth.signOut();
    notify("Your account and Spendly data were deleted.");
  }
  return <>
    <PageHeading eyebrow="MAKE IT YOURS" title="Settings" description="Your profile and the way you experience Spendly." />
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <div className="space-y-5">
        <Card><div className="mb-5"><h2 className="font-display text-base font-bold">Personal details</h2><p className="mt-1 text-xs text-muted">A few settings to make Spendly feel like yours.</p></div><form onSubmit={(event) => void saveProfile(event)} className="space-y-4">
          <Field label="Email address"><input readOnly value={email} className="!bg-[#f6f7f5] !text-muted" /><span className="mt-1 block text-[10px] text-muted">Email changes are managed through Supabase Auth.</span></Field>
          <Field label="Display name"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Preferred currency"><select value={currency} onChange={(event) => setCurrency(event.target.value)}>{["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD"].map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Timezone"><select value={timezone} onChange={(event) => setTimezone(event.target.value)}>{[Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Singapore"].filter((value, index, list) => list.indexOf(value) === index).map((value) => <option key={value}>{value}</option>)}</select></Field></div>
          <button disabled={busy} className="rounded-lg bg-forest px-4 py-2.5 text-xs font-semibold text-white">Save profile</button>
        </form></Card>
        <Card><div className="mb-4"><h2 className="font-display text-base font-bold">Password</h2><p className="mt-1 text-xs text-muted">Use a unique password with at least 8 characters.</p></div><form onSubmit={(event) => void updatePassword(event)} className="flex flex-wrap items-end gap-2"><Field label="New password"><input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" /></Field><button disabled={busy || newPassword.length < 8} className="rounded-lg bg-[#edf4ee] px-4 py-3 text-xs font-semibold text-forest disabled:opacity-50">Update password</button></form></Card>
        <Card><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f3f2eb] text-[#9b8752]"><Bell size={17} /></div><div><h2 className="text-sm font-bold">Notifications and appearance</h2><p className="mt-1 text-xs leading-5 text-muted">In-app notification preferences and theme customization aren't available yet. Spendly currently uses a calm light theme and only shows reminders inside your account.</p></div></div></Card>
      </div>
      <div className="space-y-5">
        <Card><div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><ShieldCheck size={17} /></div><h2 className="font-display text-base font-bold">Your privacy matters</h2><p className="mt-2 text-xs leading-5 text-muted">Spendly only tracks the information you enter. Transactions are private to your account, and shared details are limited to group members.</p><button onClick={signOut} className="mt-4 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas"><LogOut size={14} /> Sign out</button></Card>
        <Card className="border-[#f0dfda]"><div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-[#fff0eb] text-[#b7654f]"><Trash2 size={17} /></div><h2 className="font-display text-base font-bold">Delete your account</h2><p className="mt-2 text-xs leading-5 text-muted">This permanently removes your personal data and shared records. If a group has other members, the group is retained for them. Your receipts are also deleted.</p><button disabled={busy} onClick={() => void deleteAccount()} className="mt-4 rounded-lg border border-[#ecd1c9] px-3 py-2 text-xs font-semibold text-[#a44e3a] hover:bg-[#fff5f1] disabled:opacity-50">Delete account and data</button></Card>
      </div>
    </div>
  </>;
}
