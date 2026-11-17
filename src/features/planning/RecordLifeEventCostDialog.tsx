import { useState, type FormEvent } from "react";
import Modal from "../../components/ui/Modal";
import { Field } from "../../components/ui/FinancePrimitives";
import { supabase } from "../../lib/supabase";
import type { LifeEventCost, PaymentMethod, PaymentSource } from "../../types";

type Props = {
  cost: LifeEventCost;
  sources: PaymentSource[];
  reload: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  notify: (message: string) => void;
  close: () => void;
};

const methods: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
  { value: "debit_card", label: "Debit card" },
  { value: "upi", label: "UPI" },
];

export default function RecordLifeEventCostDialog({ cost, sources, reload, refreshTransactions, notify, close }: Props) {
  const [amount, setAmount] = useState(String(cost.amount));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const availableSources = sources.filter((source) => !source.archived && source.kind === method);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const actualAmount = Number(amount);
    if (!Number.isFinite(actualAmount) || actualAmount <= 0 || !date || !supabase) {
      setError("Enter an actual amount and purchase date.");
      return;
    }
    if (sourceId && !availableSources.some((source) => source.id === sourceId)) {
      setError("Choose an active payment source matching the payment method.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: recordError } = await supabase.rpc("record_life_event_cost", {
      p_cost_id: cost.id,
      p_actual_amount: Math.round(actualAmount * 100) / 100,
      p_occurred_on: date,
      p_payment_method: method,
      p_payment_source_id: sourceId || null,
    });
    if (recordError) {
      setBusy(false);
      setError(`The actual transaction couldn't be recorded: ${recordError.message}`);
      return;
    }
    try {
      await Promise.all([reload(), refreshTransactions()]);
      notify("Cost recorded as an actual transaction.");
      close();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The transaction was recorded, but the views couldn't be refreshed.";
      setError(`The transaction was recorded, but the latest data couldn't be loaded: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Record actual cost" description="This will add an expense to your transaction history." close={close}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="rounded-xl bg-[#f7f9f6] p-3 text-xs leading-5 text-muted">
          Planned estimate for <strong className="text-ink">{cost.title}</strong>: {cost.amount}. The actual expense is recorded only when you confirm below.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Actual amount"><input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Purchase date"><input type="date" required max={new Date().toISOString().slice(0, 10)} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment method"><select value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); setSourceId(""); }}>{methods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Payment source (optional)"><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Not specified</option>{availableSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></Field>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={close} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button>
          <button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Recording…" : "Record expense"}</button>
        </div>
      </form>
    </Modal>
  );
}
