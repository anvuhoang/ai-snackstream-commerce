import type { Metadata } from "next";
import { VerifyEmailView } from "@/components/account/recovery-forms";

export const metadata: Metadata = { title: "Xác nhận e-mail" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <VerifyEmailView token={(Array.isArray(token) ? token[0] : token) ?? ""} />;
}
