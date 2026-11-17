import { useEffect, useState } from "react";
import Modal from "../../components/ui/Modal";
import { supabase } from "../../lib/supabase";

type ReceiptViewerDialogProps = {
  title: string;
  receiptPath: string;
  close: () => void;
};

export default function ReceiptViewerDialog({ title, receiptPath, close }: ReceiptViewerDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadReceipt() {
      if (!supabase) {
        setError("Receipt storage isn't configured. Check your Supabase setup.");
        return;
      }
      try {
        const { data, error: signedUrlError } = await supabase.storage.from("receipts").createSignedUrl(receiptPath, 60);
        if (!active) return;
        if (signedUrlError) {
          setError(`Receipt couldn't be opened: ${signedUrlError.message}`);
          return;
        }
        setUrl(data.signedUrl);
      } catch (caught) {
        if (!active) return;
        const message = caught instanceof Error ? caught.message : "Unexpected storage error.";
        setError(`Receipt couldn't be opened: ${message}`);
      }
    }
    void loadReceipt();
    return () => {
      active = false;
    };
  }, [receiptPath]);

  const isPdf = receiptPath.toLowerCase().endsWith(".pdf");

  return (
    <Modal title="Receipt" description={title} close={close} maxWidthClassName="max-w-4xl">
      <div className="flex min-h-[min(65vh,560px)] items-center justify-center overflow-hidden rounded-xl border border-line bg-[#f7f8f6]">
        {error ? (
          <p role="alert" className="max-w-md px-5 text-center text-sm text-red-700">{error}</p>
        ) : !url ? (
          <div className="flex items-center gap-3 text-sm text-muted" role="status">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-forest border-t-transparent" />
            Loading receipt…
          </div>
        ) : isPdf ? (
          <iframe title={`Receipt for ${title}`} src={url} className="h-[min(65vh,560px)] w-full" />
        ) : (
          <img src={url} alt={`Receipt for ${title}`} className="max-h-[min(65vh,560px)] max-w-full object-contain" />
        )}
      </div>
    </Modal>
  );
}
