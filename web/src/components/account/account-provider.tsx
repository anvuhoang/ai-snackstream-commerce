"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import type { CustomerOut } from "@/lib/account";

type RegisterInput = { email: string; password: string; fullName: string; phone: string };

type AccountState = {
  /** null for a visitor (also while the first answer is on its way: check `ready`). */
  customer: CustomerOut | null;
  /** CSRF token to send on writes (checkout, profile, sign-out). */
  csrf: string | null;
  ready: boolean;
  /** Each returns an error text in Vietnamese, or null on success. */
  login: (email: string, password: string) => Promise<string | null>;
  register: (input: RegisterInput) => Promise<string | null>;
  logout: () => Promise<void>;
  setCustomer: (customer: CustomerOut) => void;
  /** Ask the server again who is signed in (after the e-mail was confirmed in another tab, for example). */
  refresh: () => Promise<void>;
};

const AccountContext = createContext<AccountState | null>(null);

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

/** Who is signed in. The server keeps the session (a signed cookie); this only mirrors it for the page. */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<CustomerOut | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void browserApi
      .GET("/api/account/me")
      .then(({ data }) => {
        if (!live) return;
        setCustomer(data?.customer ?? null);
        setCsrf(data?.csrf ?? null);
      })
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await browserApi.POST("/api/account/login", { body: { email, password } });
      if (!data) return errorText(error);
      setCustomer(data.customer ?? null);
      setCsrf(data.csrf ?? null);
      return null;
    } catch {
      return "Không kết nối được máy chủ. Vui lòng thử lại.";
    }
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    try {
      const { data, error } = await browserApi.POST("/api/account/register", { body: input });
      if (!data) return errorText(error);
      setCustomer(data.customer ?? null);
      setCsrf(data.csrf ?? null);
      return null;
    } catch {
      return "Không kết nối được máy chủ. Vui lòng thử lại.";
    }
  }, []);

  const logout = useCallback(async () => {
    if (csrf) await browserApi.POST("/api/account/logout", { headers: { "X-CSRF-Token": csrf } });
    setCustomer(null);
    setCsrf(null);
  }, [csrf]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await browserApi.GET("/api/account/me");
      setCustomer(data?.customer ?? null);
      setCsrf(data?.csrf ?? null);
    } catch {
      // offline: keep what we know
    }
  }, []);

  const value = useMemo(
    () => ({ customer, csrf, ready, login, register, logout, setCustomer, refresh }),
    [customer, csrf, ready, login, register, logout, refresh],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
