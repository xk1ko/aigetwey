"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "./Icon";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const ToastCtx = createContext<{ toast: (message: string, type?: ToastType) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastCtx);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-brand-lg border px-4 py-2.5 text-[13px] shadow-elevated animate-[slideIn_0.2s_ease] ${
              t.type === "success"
                ? "border-success/25 bg-success/8 text-success"
                : t.type === "error"
                  ? "border-danger/25 bg-danger/8 text-danger"
                  : "border-info/25 bg-info/8 text-info"
            }`}
          >
            <Icon
              name={t.type === "success" ? "check_circle" : t.type === "error" ? "error" : "info"}
              size={16}
            />
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx>
  );
}
