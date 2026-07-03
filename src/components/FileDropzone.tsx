"use client";

import { useCallback, useRef, useState } from "react";

const ACCEPTED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "image/png": "PNG",
  "image/jpeg": "JPG",
};

const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.png,.jpg,.jpeg";

interface Props {
  onFiles: (files: File[]) => void;
}

export default function FileDropzone({ onFiles }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (candidates: File[]) => {
      const validFiles = candidates.filter((f) => ACCEPTED_TYPES[f.type]);
      const skipped = candidates.length - validFiles.length;
      if (skipped > 0) {
        setDragError(
          `${skipped} file${skipped > 1 ? "s" : ""} skipped — only PDF, DOC, DOCX, PNG, JPG supported.`
        );
      } else {
        setDragError(null);
      }
      if (validFiles.length > 0) {
        onFiles(validFiles);
      }
    },
    [onFiles]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragError(null);
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) handleFiles(files);
    e.target.value = "";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop a file here or click to browse"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-14 text-center cursor-pointer transition-colors select-none
        ${
          isDragging
            ? "border-indigo-400 bg-indigo-500/10"
            : "border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-800/40"
        }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        multiple
        className="sr-only"
        onChange={onInputChange}
      />

      <UploadIcon isDragging={isDragging} />

      <div>
        <p className="text-sm font-medium text-slate-200">
          {isDragging ? "Drop to select" : "Drag & drop one or more documents"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          or{" "}
          <span className="text-indigo-400 underline underline-offset-2">
            click to browse
          </span>
        </p>
      </div>

      <div className="flex gap-2 flex-wrap justify-center mt-1">
        {Object.values(ACCEPTED_TYPES).map((ext) => (
          <span
            key={ext}
            className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
          >
            {ext}
          </span>
        ))}
      </div>

      {dragError && (
        <p className="text-xs text-red-400 mt-1">{dragError}</p>
      )}
    </div>
  );
}

function UploadIcon({ isDragging }: { isDragging: boolean }) {
  return (
    <div
      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
        isDragging ? "bg-indigo-500/20" : "bg-slate-800"
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`w-6 h-6 transition-colors ${
          isDragging ? "text-indigo-400" : "text-slate-400"
        }`}
      >
        <path d="M12 16V4m0 0L8 8m4-4 4 4" />
        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
      </svg>
    </div>
  );
}
