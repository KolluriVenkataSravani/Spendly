export type TransactionType = "expense" | "income";
export type PaymentMethod = "cash" | "credit_card" | "debit_card" | "upi";
export type TransactionPaymentMethod = PaymentMethod | "shared";
export type PaymentSourceKind = Exclude<PaymentMethod, "cash">;
export type PageKey = "Overview" | "Transactions" | "Budgets" | "Analytics" | "Cash flow" | "Planning" | "Shared expenses" | "Card Vault" | "Settings";

export interface Profile {
  id: string;
  display_name: string;
  currency: string;
  monthly_budget: number;
  starting_balance: number;
  timezone: string;
  onboarding_complete: boolean;
}

export interface Category {
  id: string;
  owner_id: string;
  name: string;
  icon: string;
  color: string;
  is_default: boolean;
}

export interface PaymentSource {
  id: string;
  owner_id: string;
  label: string;
  kind: PaymentSourceKind;
  issuer: string | null;
  last_four: string | null;
  masked_identifier: string | null;
  archived: boolean;
}

export interface Transaction {
  id: string;
  owner_id: string;
  title: string;
  amount: number;
  type: TransactionType;
  payment_method: TransactionPaymentMethod;
  category_id: string | null;
  payment_source_id: string | null;
  occurred_at: string;
  notes: string | null;
  receipt_path: string | null;
  shared_expense_id: string | null;
  recurring_payment_id: string | null;
  recurring_occurrence_date: string | null;
  life_event_cost_id: string | null;
  category?: Category | null;
  payment_source?: PaymentSource | null;
}

export interface Budget {
  id: string;
  owner_id: string;
  month_start: string;
  category_id: string | null;
  amount: number;
}

export interface Group {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: "owner" | "member";
  profile?: Pick<Profile, "id" | "display_name">;
}

export interface GroupInvitation {
  id: string;
  group_id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface SharedExpense {
  id: string;
  group_id: string;
  created_by: string;
  paid_by: string | null;
  title: string;
  amount: number;
  occurred_at: string;
  category_id: string | null;
  splits?: ExpenseSplit[];
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  amount_owed: number;
}

export interface Settlement {
  id: string;
  group_id: string;
  payer_id: string;
  payee_id: string;
  amount: number;
  paid_at: string;
  note: string | null;
}

export interface UserNotification {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  target_page: PageKey;
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
}

export interface RecurringPayment {
  id: string;
  owner_id: string;
  title: string;
  amount: number;
  type: TransactionType;
  payment_method: PaymentMethod;
  category_id: string | null;
  payment_source_id: string | null;
  frequency: "weekly" | "monthly" | "yearly";
  next_due_on: string;
  anchor_day: number;
  anchor_month: number;
  autopay: boolean;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseScenario {
  id: string;
  owner_id: string;
  title: string;
  amount: number;
  planned_on: string;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LifeEventPlan {
  id: string;
  owner_id: string;
  name: string;
  target_amount: number;
  target_on: string;
  amount_set_aside: number;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface LifeEventCost {
  id: string;
  plan_id: string;
  title: string;
  amount: number;
  planned_on: string;
  category_id: string | null;
  status: "planned" | "recorded";
  recorded_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      categories: Table<Category>;
      payment_sources: Table<PaymentSource>;
      transactions: Table<Transaction>;
      budgets: Table<Budget>;
      groups: Table<Group>;
      group_memberships: Table<GroupMember>;
      group_invitations: Table<GroupInvitation & { token_hash: string }>;
      shared_expenses: Table<SharedExpense>;
      expense_splits: Table<ExpenseSplit>;
      settlements: Table<Settlement>;
      user_notifications: Table<UserNotification>;
      recurring_payments: Table<RecurringPayment>;
      purchase_scenarios: Table<PurchaseScenario>;
      life_event_plans: Table<LifeEventPlan>;
      life_event_costs: Table<LifeEventCost>;
    };
    Views: Record<string, never>;
    Functions: {
      process_due_recurring_payments: { Args: Record<string, never>; Returns: number };
      create_recurring_payment: {
        Args: {
          p_title: string;
          p_amount: number;
          p_type: TransactionType;
          p_payment_method: PaymentMethod;
          p_category_id: string | null;
          p_payment_source_id: string | null;
          p_frequency: RecurringPayment["frequency"];
          p_next_due_on: string;
          p_autopay: boolean;
          p_notes: string | null;
        };
        Returns: string;
      };
      create_group: { Args: { p_name: string }; Returns: string };
      set_notification_read: { Args: { p_notification_id: string }; Returns: undefined };
      set_all_notifications_read: { Args: Record<string, never>; Returns: undefined };
      create_group_invitation: { Args: { p_group_id: string; p_email: string }; Returns: string };
      accept_group_invitation: { Args: { p_token: string }; Returns: string };
      create_shared_expense: {
        Args: {
          p_group_id: string;
          p_title: string;
          p_amount: number;
          p_paid_by: string;
          p_occurred_at: string;
          p_category_id: string | null;
          p_splits: { user_id: string; amount_owed: number }[];
        };
        Returns: string;
      };
      record_settlement: {
        Args: { p_group_id: string; p_payee_id: string; p_amount: number; p_paid_at: string; p_note: string | null };
        Returns: string;
      };
      delete_category: { Args: { p_category_id: string }; Returns: undefined };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      record_life_event_cost: {
        Args: {
          p_cost_id: string;
          p_actual_amount: number;
          p_occurred_on: string;
          p_payment_method: PaymentMethod;
          p_payment_source_id: string | null;
        };
        Returns: string;
      };
      record_recurring_occurrence: {
        Args: {
          p_schedule_id: string;
          p_occurrence_on: string;
          p_actual_amount: number;
          p_paid_on: string;
          p_payment_method: PaymentMethod;
          p_payment_source_id: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

type Table<T extends object> = {
  Row: T & Record<string, unknown>;
  Insert: Partial<T> & Record<string, unknown>;
  Update: Partial<T> & Record<string, unknown>;
  Relationships: [];
};
