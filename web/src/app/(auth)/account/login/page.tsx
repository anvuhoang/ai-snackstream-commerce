import type { Metadata } from "next";
import { AuthForm } from "@/components/account/auth-form";
import { safeNext } from "@/lib/account";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="login" next={safeNext(next)} />;
}
