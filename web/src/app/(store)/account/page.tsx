import type { Metadata } from "next";
import { AccountView } from "@/components/account/account-view";

export const metadata: Metadata = { title: "Tài khoản của tôi" };

export default function AccountPage() {
  return <AccountView />;
}
