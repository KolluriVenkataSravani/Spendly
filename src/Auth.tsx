import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Leaf, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { supabase } from "./lib/supabase";

type AuthMode = "signin" | "signup" | "reset";

export default function Auth({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!configured || !supabase) {
      setError("Supabase isn't configured yet. Add the project URL and publishable key to your .env file, then restart Spendly.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode !== "reset" && password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Add your name to create your account.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (authError) throw authError;
        setMessage("Check your inbox for a confirmation link. Your account is ready once you verify your email.");
      } else if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/`,
        });
        if (authError) throw authError;
        setMessage("If an account exists for this address, a password reset link is on its way.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "signup" ? "A clearer view starts here." : mode === "reset" ? "Reset your password." : "Your money, in better focus.";

  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#173b2c] px-12 py-11 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-36 -top-32 h-[34rem] w-[34rem] rounded-full border border-white/10" />
        <div className="absolute -right-16 -top-12 h-[27rem] w-[27rem] rounded-full border border-white/10" />
        <div className="absolute -bottom-48 -left-36 h-[34rem] w-[34rem] rounded-full bg-[#285640]/70 blur-2xl" />
        <div className="relative z-10 flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#b8e4c6] text-[#173b2c]"><Leaf size={19} /></span>
          spendly
        </div>
        <div className="relative z-10 max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-[#c5dccd]"><Sparkles size={13} /> Money, made clearer</div>
          <h1 className="font-display text-5xl font-semibold leading-[1.12] tracking-[-.04em] xl:text-6xl">Small habits.<br />A more confident<br /><span className="text-[#a5d6b3]">financial life.</span></h1>
          <p className="mt-6 max-w-md text-base leading-7 text-white/65">A calm place to understand your spending, make room for what matters, and keep shared expenses fair.</p>
        </div>
        <p className="relative z-10 text-xs text-white/45">Private by design · Your data stays yours</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-[410px]">
          <div className="mb-10 flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight text-ink lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-mint text-forest"><Leaf size={19} /></span> spendly
          </div>
          <div className="mb-8">
            <p className="mb-2 text-sm font-semibold text-forest">{mode === "signup" ? "GET STARTED" : mode === "reset" ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-ink">{heading}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{mode === "signup" ? "Create your account. It only takes a moment." : mode === "reset" ? "We'll email you a secure link to choose a new password." : "Sign in to pick up where you left off."}</p>
          </div>
          {!configured && <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-900"><div className="mb-1 flex items-center gap-2 font-semibold"><AlertCircle size={15} /> Connect Supabase to get started</div>Create a Supabase project, copy <code className="rounded bg-white/70 px-1">.env.example</code> to <code className="rounded bg-white/70 px-1">.env</code>, add your project URL and publishable key, apply the SQL migration, then restart the app. No sign-in is attempted until configuration is present.</div>}
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && <label className="block text-sm font-medium text-ink">Your name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 block w-full rounded-xl border-line bg-white px-3.5 py-3 text-sm placeholder:text-[#a3aaa5]" placeholder="Alex Morgan" /></label>}
            <label className="block text-sm font-medium text-ink">Email address<div className="relative mt-1.5"><Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a29b]" size={17} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="block w-full rounded-xl border-line bg-white py-3 pl-10 pr-3.5 text-sm placeholder:text-[#a3aaa5]" placeholder="you@example.com" /></div></label>
            {mode !== "reset" && <label className="block text-sm font-medium text-ink">Password<div className="relative mt-1.5"><LockKeyhole className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a29b]" size={17} /><input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="block w-full rounded-xl border-line bg-white py-3 pl-10 pr-11 text-sm placeholder:text-[#a3aaa5]" placeholder="At least 8 characters" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
            {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</p>}
            {message && <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{message}</p>}
            <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#17573f] disabled:opacity-60">
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"} {!busy && <ArrowRight size={16} />}
            </button>
          </form>
          {mode === "signin" && <button onClick={() => { setMode("reset"); setError(""); setMessage(""); }} className="mt-4 w-full text-center text-sm font-medium text-forest hover:underline">Forgot password?</button>}
          <div className="mt-7 border-t border-line pt-6 text-center text-sm text-muted">
            {mode === "reset" ? <>Remembered it? <button onClick={() => setMode("signin")} className="font-semibold text-forest hover:underline">Back to sign in</button></> : mode === "signup" ? <>Already have an account? <button onClick={() => { setMode("signin"); setMessage(""); setError(""); }} className="font-semibold text-forest hover:underline">Sign in</button></> : <>New to Spendly? <button onClick={() => { setMode("signup"); setMessage(""); setError(""); }} className="font-semibold text-forest hover:underline">Create an account</button></>}
          </div>
          <p className="mt-8 text-center text-xs leading-5 text-muted">Spendly helps you track money. It does not connect to your bank or make payments.</p>
        </div>
      </section>
    </main>
  );
}
