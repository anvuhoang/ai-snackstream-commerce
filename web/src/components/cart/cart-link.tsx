"use client";

import Link from "next/link";
import { useCart } from "./cart-provider";

/** "Giỏ (n)" in the top bar. Shows 0 until the cart has loaded, so the bar never jumps. */
export function CartLink({ className }: { className?: string }) {
  const { cart } = useCart();
  return (
    <Link href="/checkout" className={className}>
      Giỏ ({cart?.itemCount ?? 0})
    </Link>
  );
}
