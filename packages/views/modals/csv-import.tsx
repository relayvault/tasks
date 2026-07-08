"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { useImportProjectCSV } from "@multica/core/csv-import";
import { toast } from "sonner";
import { useT } from "../i18n";

interface CSVImportModalProps {
  onClose: () => void;
  data: Record<string, unknown> | null;
}

export function CSVImportModal({ onClose, data }: CSVImportModalProps) {
  const { t } = useT("projects");
  const projectId = typeof data?.project_id === "string" ? data.project_id : "";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const importCSV = useImportProjectCSV();

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv") && f.type !== "text/csv") {
      toast.error(t(($) => $.csv_import.invalid_file));
      return;
    }
    setFile(f);
  };

  const handleImport = async () => {
    if (!file || !projectId) return;
    const csvText = await file.text();
    importCSV.mutate(
      { projectId, csvText },
      {
        onSuccess: (res) => {
          toast.success(
            t(($) => $.csv_import.import_success).replace("{{count}}", String(res.issues_created)),
          );
          if (res.errors && res.errors.length > 0) {
            toast.warning(
              t(($) => $.csv_import.import_partial).replace("{{count}}", String(res.errors.length)),
            );
          }
          onClose();
        },
        onError: (err) => {
          toast.error(
            err instanceof Error && err.message ? err.message : t(($) => $.csv_import.import_failed),
          );
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 flex flex-col overflow-hidden !max-w-lg !w-full"
      >
        <DialogTitle className="sr-only">{t(($) => $.csv_import.modal_title)}</DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-4" />
            <span className="text-sm font-medium">{t(($) => $.csv_import.modal_title)}</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(($) => $.csv_import.description)}
          </p>

          {/* Drop zone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <Upload className="size-5 text-muted-foreground" />
            {file ? (
              <span className="text-sm font-medium">{file.name}</span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t(($) => $.csv_import.drop_hint)}
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <p className="text-xs text-muted-foreground">
            {t(($) => $.csv_import.format_hint)}
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t(($) => $.csv_import.cancel)}
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!file || importCSV.isPending}
            >
              {importCSV.isPending ? (
                <><Loader2 className="size-3 animate-spin mr-1" />{t(($) => $.csv_import.importing)}</>
              ) : (
                t(($) => $.csv_import.import_button)
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
