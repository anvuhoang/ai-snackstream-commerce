import type { Metadata } from "next";
import { AuthForm } from "@/components/account/auth-form";
import { safeNext } from "@/lib/account";

export const metadata: Metadata = { title: "Tạo tài khoản" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="register" next={safeNext(next)} />;
}
