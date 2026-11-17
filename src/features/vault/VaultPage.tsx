import { useState, type FormEvent } from "react";
import { ArrowLeftRight, CreditCard, Ellipsis, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Card, Empty, Field, PageHeading } from "../../components/ui/FinancePrimitives";
import Modal from "../../components/ui/Modal";
import { formatCurrency, sumMoneyAmounts } from "../../lib/finance";
import { supabase } from "../../lib/supabase";
import type { PaymentSource, PaymentSourceKind, Transaction } from "../../types";

export default function VaultPage({ sources, transactions, currency, userId, reload, notify }: {
  sources: PaymentSource[];
  transactions: Transaction[];
  currency: string;
  userId: string;
  reload: () => Promise<void>;
  notify: (message: string) => void;
}) {
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
