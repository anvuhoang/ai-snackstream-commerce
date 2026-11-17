import { AccountProvider } from "@/components/account/account-provider";

/**
 * Sign-in and sign-up are their own pages, not part of the shop frame: no promo bar, menu, cart or footer to pull the
 * customer away from the form. The account provider is here so the form can sign in and the page can tell who is signed in.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AccountProvider>{children}</AccountProvider>;
}
