"use client";
import { useEffect, useState } from "react";
import { adminApi } from "./client";
import type { CapsTables } from "./capabilities";

let _cache: CapsTables | null = null;

export function useCapsTables(): CapsTables | null {
  const [tables, setTables] = useState<CapsTables | null>(_cache);
  useEffect(() => {
    if (_cache) return;
    let cancelled = false;
    adminApi.capabilities().then((res) => {
      if (!cancelled && res.ok && res.data) {
        _cache = res.data;
        setTables(res.data);
      }
    });
    return () => { cancelled = true; };
  }, []);
  return tables;
}

export function getCachedCapsTables(): CapsTables | null {
  return _cache;
}
