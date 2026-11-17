import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/account/recovery-forms";

export const metadata: Metadata = { title: "Đặt mật khẩu mới" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={(Array.isArray(token) ? token[0] : token) ?? ""} />;
}
