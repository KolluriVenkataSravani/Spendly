import { useState, type FormEvent } from "react";
import { Bell, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { Card, Field, PageHeading } from "../../components/ui/FinancePrimitives";
import { supabase } from "../../lib/supabase";
import type { Profile } from "../../types";

export default function SettingsPage({ profile, updateProfile, email, notify, signOut }: {
  profile: Profile;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  email: string;
  notify: (message: string) => void;
  signOut: () => void;
}) {
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
        <Card><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f3f2eb] text-[#9b8752]"><Bell size={17} /></div><div><h2 className="text-sm font-bold">Notifications and appearance</h2><p className="mt-1 text-xs leading-5 text-muted">Budget alerts appear in the app when you reach 80% or 100% of a monthly limit, with unread counts and toast updates. Notification preferences and theme customization aren't available yet.</p></div></div></Card>
      </div>
      <div className="space-y-5">
        <Card><div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><ShieldCheck size={17} /></div><h2 className="font-display text-base font-bold">Your privacy matters</h2><p className="mt-2 text-xs leading-5 text-muted">Spendly only tracks the information you enter. Transactions are private to your account, and shared details are limited to group members.</p><button onClick={signOut} className="mt-4 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas"><LogOut size={14} /> Sign out</button></Card>
        <Card className="border-[#f0dfda]"><div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-[#fff0eb] text-[#b7654f]"><Trash2 size={17} /></div><h2 className="font-display text-base font-bold">Delete your account</h2><p className="mt-2 text-xs leading-5 text-muted">This permanently removes your personal data and shared records. If a group has other members, the group is retained for them. Your receipts are also deleted.</p><button disabled={busy} onClick={() => void deleteAccount()} className="mt-4 rounded-lg border border-[#ecd1c9] px-3 py-2 text-xs font-semibold text-[#a44e3a] hover:bg-[#fff5f1] disabled:opacity-50">Delete account and data</button></Card>
      </div>
    </div>
  </>;
}
