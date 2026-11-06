"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Me, Meta } from "@/lib/types";

type Ctx = { meta: Meta; me: Me; today: string };
const C = createContext<Ctx | null>(null);

export function AppProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useApp(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("AppProvider chưa được bọc");
  return v;
}
