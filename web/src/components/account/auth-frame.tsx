"use client";

import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export type FrameMode = "login" | "register" | "recover";

const PANEL = {
  login: {
    title: "Vị phố, giao tận nhà.",
    perks: ["Thông tin giao hàng được lưu sẵn", "Theo dõi từng đơn hàng", "Xem live và đặt món ngay khi đang phát"],
  },
  register: {
    title: "Mua đồ ăn vặt, nhanh và gọn.",
    perks: ["Điền sẵn địa chỉ ở lần thanh toán sau", "Xem lại lịch sử và chi tiết mọi đơn", "Giỏ hàng của bạn được giữ nguyên"],
  },
  recover: {
    title: "Lấy lại tài khoản của bạn.",
    perks: ["Chúng tôi gửi đường dẫn qua e-mail", "Đường dẫn dùng được một lần", "Mật khẩu cũ bị thay ngay khi bạn đặt mật khẩu mới"],
  },
} as const;

/** The brand half: a full-height colour field with the pitch and a product shot, no frame around it. */
function BrandPanel({ mode }: { mode: FrameMode }) {
  const copy = PANEL[mode];
  return (
    <aside className="relative hidden overflow-hidden bg-leaf text-paper lg:block">
      <div className="relative z-10 flex h-full flex-col px-12 py-14 xl:px-16">
        <Link href="/" aria-label="SnackStream, về trang chủ" className="w-fit">
          <Logo size={34} onDark />
        </Link>
        <div className="mt-16 xl:mt-24">
          <h2 className="max-w-[14ch] text-balance text-[44px] font-extrabold leading-[1.04] tracking-[-0.035em] xl:text-[52px]">{copy.title}</h2>
          <ul className="mt-9 grid gap-3 text-[16px] text-paper/85">
            {copy.perks.map((perk) => (
              <li key={perk} className="flex items-baseline gap-3">
                <span aria-hidden className="size-1.5 shrink-0 translate-y-[-3px] rounded-full bg-turmeric" />
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="absolute -bottom-6 -right-10 size-[340px] rotate-[8deg] overflow-hidden rounded-[40px] xl:size-[400px]">
        <Image src="/photos/kg-lc-250-bag.webp" alt="" fill sizes="400px" unoptimized className="object-cover" />
      </div>
    </aside>
  );
}

/**
 * The stand-alone page around every sign-in style form: brand half on the left, the form on the right, a link to the other
 * choice (sign up / sign in) in the top corner. It has no shop menu or footer on purpose.
 */
export function AuthFrame({
  mode,
  title,
  subtitle,
  topLink,
  children,
}: {
  mode: FrameMode;
  title: string;
  subtitle?: string;
  topLink?: { prompt: string; label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[5fr_6fr]">
      <BrandPanel mode={mode} />

      <div className="flex flex-col px-5 py-8 sm:px-10 lg:px-16 lg:py-10 xl:px-24">
        <div className="flex items-center justify-between gap-4 text-sm text-muted">
          <Link href="/" aria-label="SnackStream, về trang chủ" className="lg:invisible">
            <Logo size={30} />
          </Link>
          {topLink && (
            <p>
              {topLink.prompt}{" "}
              <Link href={topLink.href} className="font-semibold text-ink underline underline-offset-4 hover:text-accent">
                {topLink.label}
              </Link>
            </p>
          )}
        </div>

        <div className="m-auto grid w-full max-w-[400px] gap-7 py-10">
          <div className="grid gap-2">
            <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[36px]">{title}</h1>
            {subtitle && <p className="text-[15px] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The main button of these forms. */
export function SubmitButton({ busy, children, busyText = "Đang xử lý…" }: { busy: boolean; children: React.ReactNode; busyText?: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="mt-1 flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-ink text-[15px] font-semibold text-paper transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-70"
    >
      {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-paper/40 border-t-paper" />}
      {busy ? busyText : children}
    </button>
  );
}

export function FormAlert({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-soft/60 px-4 py-3 text-sm text-danger">
      {text}
    </p>
  );
}
