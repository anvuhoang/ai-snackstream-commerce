"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import type { CartOut } from "@/lib/shop";

type CartState = {
  /** null until the first answer arrives */
  cart: CartOut | null;
  busy: boolean;
  /** Text for the last failed action (already in Vietnamese); cleared by the next action. */
  error: string | null;
  add: (variantId: number, qty: number) => Promise<boolean>;
  setQty: (variantId: number, qty: number) => Promise<void>;
  remove: (variantId: number) => Promise<void>;
  refresh: () => Promise<void>;
};

const CartContext = createContext<CartState | null>(null);

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}

/**
 * The visitor's cart. The server keeps it (a cookie holds its id), so every change is a request and the answer replaces the
 * state. Prices and totals are always the server's, never computed here.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await browserApi.GET("/api/cart");
    if (data) setCart(data);
  }, []);

  useEffect(() => {
    let live = true;
    void browserApi.GET("/api/cart").then(({ data }) => {
      if (live && data) setCart(data);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Run one cart request; the response (or its error) updates the state. */
  const run = useCallback(async (call: () => Promise<{ data?: CartOut; error?: unknown }>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await call();
      if (data) {
        setCart(data);
        return true;
      }
      setError(errorText(err));
      return false;
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<CartState>(
    () => ({
      cart,
      busy,
      error,
      refresh,
      add: (variantId, qty) => run(() => browserApi.POST("/api/cart/items", { body: { variantId, qty } })),
      setQty: async (variantId, qty) => {
        await run(() => browserApi.PATCH("/api/cart/items/{variant_id}", { params: { path: { variant_id: variantId } }, body: { qty } }));
      },
      remove: async (variantId) => {
        await run(() => browserApi.DELETE("/api/cart/items/{variant_id}", { params: { path: { variant_id: variantId } } }));
      },
    }),
    [cart, busy, error, refresh, run],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
