"use client";

import Link from "next/link";
import { useAccount } from "./account-provider";

const link = "rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium transition-colors hover:bg-canvas";

/** Header entry: "Đăng nhập" for a visitor, the customer's name once signed in. */
export function AccountLink() {
  const { customer, ready } = useAccount();
  if (!ready) return <span className={`${link} invisible hidden sm:block`}>Đăng nhập</span>;
  if (!customer) {
    return (
      <Link href="/account/login" className={`${link} hidden sm:block`}>
        Đăng nhập
      </Link>
    );
  }
  const first = customer.fullName.trim().split(/\s+/).at(-1) ?? "bạn";
  return (
    <Link href="/account" className={`${link} hidden max-w-[160px] truncate sm:block`} title={customer.email}>
      Xin chào, {first}
    </Link>
  );
}
