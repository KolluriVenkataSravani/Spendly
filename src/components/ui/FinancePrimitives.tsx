import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-forest">{eyebrow}</p>}
        <h1 className="font-display text-[26px] font-bold tracking-[-.035em] sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6 ${className}`}>{children}</section>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-5 py-9 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#f2f5f2] text-[#769180]"><Sparkles size={19} /></div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-xs leading-5 text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-[#56645b]">
      {label}
      <div className="mt-1.5 [&_input]:block [&_input]:w-full [&_input]:rounded-xl [&_input]:border-line [&_input]:bg-white [&_input]:px-3.5 [&_input]:py-3 [&_input]:text-sm [&_input]:font-normal [&_select]:block [&_select]:w-full [&_select]:rounded-xl [&_select]:border-line [&_select]:bg-white [&_select]:px-3.5 [&_select]:py-3 [&_select]:text-sm [&_select]:font-normal [&_textarea]:block [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border-line [&_textarea]:bg-white [&_textarea]:px-3.5 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:font-normal">
        {children}
      </div>
    </label>
  );
}
