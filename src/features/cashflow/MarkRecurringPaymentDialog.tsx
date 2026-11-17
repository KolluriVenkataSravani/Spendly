import { useState, type FormEvent } from "react";
import Modal from "../../components/ui/Modal";
import { Field } from "../../components/ui/FinancePrimitives";
import { supabase } from "../../lib/supabase";
import type { PaymentMethod, PaymentSource, RecurringPayment } from "../../types";

type Props = {
  schedule: RecurringPayment;
  occurrenceOn: string;
  sources: PaymentSource[];
  currency: string;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  close: () => void;
};

const methods: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit card" },
  { value: "debit_card", label: "Debit card" },
  { value: "upi", label: "UPI" },
];

export default function MarkRecurringPaymentDialog({ schedule, occurrenceOn, sources, currency, reload, notify, close }: Props) {
  const [amount, setAmount] = useState(String(schedule.amount));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(schedule.payment_method);
  const [sourceId, setSourceId] = useState(schedule.payment_source_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const availableSources = sources.filter((source) => !source.archived && source.kind === method);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const actualAmount = Number(amount);
    if (!Number.isFinite(actualAmount) || actualAmount <= 0 || !paidOn || !supabase) {
      setError("Enter an actual amount and payment date.");
      return;
    }
    if (sourceId && !availableSources.some((source) => source.id === sourceId)) {
      setError("Choose an active payment source matching the payment method.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: recordError } = await supabase.rpc("record_recurring_occurrence", {
      p_schedule_id: schedule.id,
      p_occurrence_on: occurrenceOn,
      p_actual_amount: Math.round(actualAmount * 100) / 100,
      p_paid_on: paidOn,
      p_payment_method: method,
      p_payment_source_id: sourceId || null,
    });
    setBusy(false);
    if (recordError) {
      setError(`Payment wasn't recorded: ${recordError.message}`);
      return;
    }
    await reload();
    notify(schedule.type === "income" ? "Income recorded from recurring schedule." : "Bill recorded as an expense.");
    close();
  }

  return (
    <Modal title={schedule.type === "income" ? "Record received income" : "Record bill as paid"} description={`${schedule.title} · due ${occurrenceOn}`} close={close}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="rounded-xl bg-[#f7f9f6] p-3 text-xs leading-5 text-muted">
          This scheduled item is still an expectation. Confirming adds an actual {schedule.type === "income" ? "income" : "expense"} transaction and advances its schedule.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Actual amount (${currency})`}><input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Paid/received on"><input type="date" max={new Date().toISOString().slice(0, 10)} required value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment method"><select value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); setSourceId(""); }}>{methods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Payment source (optional)"><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Not specified</option>{availableSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}</select></Field>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        <div className="flex gap-2"><button type="button" onClick={close} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold">Cancel</button><button disabled={busy} className="flex-1 rounded-xl bg-forest py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Confirm as paid"}</button></div>
      </form>
    </Modal>
  );
}
