"use client";

import { useEffect, useState, useRef } from "react";
import { marked } from "marked";
import { Icon } from "./Icon";

const CHANGELOG_URL = "https://raw.githubusercontent.com/xk1ko/aigetwey/main/CHANGELOG.md";

marked.setOptions({ gfm: true, breaks: false });

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(CHANGELOG_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((md) => {
        setHtml(marked.parse(md) as string);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-brand-lg border border-border bg-surface shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            <Icon name="history" size={17} className="text-text-muted" />
            <h2 className="text-[14px] font-semibold text-text">Changelog</h2>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text">
            <Icon name="close" size={17} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Icon name="progress_activity" size={20} className="animate-spin text-text-subtle" />
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-center text-[13px] text-text-muted">
            Could not load changelog. Check{" "}
            <a
              href="https://github.com/xk1ko/aigetwey/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              GitHub
            </a>
            .
          </div>
        ) : (
          <div
            ref={ref}
            className="changelog-body flex-1 overflow-y-auto px-5 py-4 text-[13px] text-text-muted"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
