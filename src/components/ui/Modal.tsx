import { useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

type ModalProps = {
  title: string;
  description?: string;
  close: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
};

export default function Modal({ title, description, close, children, maxWidthClassName = "max-w-[500px]" }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[#18251e]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <motion.section
        initial={{ y: 12, opacity: 0.8 }}
        animate={{ y: 0, opacity: 1 }}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7 ${maxWidthClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-heading"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-heading" className="font-display text-xl font-bold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-xs text-muted">{description}</p>}
          </div>
          <button onClick={close} aria-label="Close dialog" className="rounded-lg p-1.5 text-muted hover:bg-canvas">
            <X size={18} />
          </button>
        </div>
        {children}
      </motion.section>
    </div>
  );
}
