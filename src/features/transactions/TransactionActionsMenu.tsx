import { useEffect, useRef, useState } from "react";
import { Ellipsis, Eye, Pencil, Trash2 } from "lucide-react";

type TransactionActionsMenuProps = {
  transactionTitle: string;
  hasReceipt: boolean;
  isShared: boolean;
  onEdit: () => void;
  onViewReceipt: () => void;
  onDelete: () => void;
};

export default function TransactionActionsMenu({
  transactionTitle,
  hasReceipt,
  isShared,
  onEdit,
  onViewReceipt,
  onDelete,
}: TransactionActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Actions for ${transactionTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-canvas hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"
      >
        <Ellipsis size={19} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-line bg-white p-1.5 shadow-lg" role="menu">
          {isShared ? (
            <p className="px-3 py-2 text-[11px] leading-4 text-muted">Manage this entry from Shared expenses.</p>
          ) : (
            <>
              <button role="menuitem" onClick={() => run(onEdit)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium hover:bg-canvas">
                <Pencil size={14} /> Edit transaction
              </button>
              <button role="menuitem" onClick={() => run(onDelete)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-[#a95643] hover:bg-[#fff3ef]">
                <Trash2 size={14} /> Delete transaction
              </button>
            </>
          )}
          {hasReceipt && (
            <button role="menuitem" onClick={() => run(onViewReceipt)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium hover:bg-canvas">
              <Eye size={14} /> View receipt
            </button>
          )}
        </div>
      )}
    </div>
  );
}
