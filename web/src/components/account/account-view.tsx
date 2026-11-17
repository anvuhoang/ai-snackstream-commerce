"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { browserApi } from "@/lib/api/browser";
import type { OrderOut } from "@/lib/account";
import { cn } from "@/lib/cn";
import { errorText } from "@/lib/errors";
import { formatDateTime, formatVnd } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_STEPS, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/shop";
import { useAccount } from "./account-provider";
import { PasswordField, StrengthMeter, TextField } from "./fields";
import { ChevronIcon } from "./icons";

type Tab = "orders" | "profile" | "security";
type OrderState = { orders: OrderOut[] | null; failed: boolean; reload: () => void };

/** The dot in front of a status word. Colour helps the eye; the word always says it. */
const DOT = { new: "bg-turmeric", confirmed: "bg-accent", shipping: "bg-accent", completed: "bg-ok", cancelled: "bg-muted" } as const;

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts.at(-2)?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase() || "?";
};

function StatusLabel({ status }: { status: OrderOut["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
      <span aria-hidden className={cn("size-2 rounded-full", DOT[status])} />
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

/** Orders belong to the page, not to one tab, so the side menu can show how many there are. */
function useOrders(): OrderState {
  const [orders, setOrders] = useState<OrderOut[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void browserApi
      .GET("/api/account/orders")
      .then(({ data }) => {
        if (!live) return;
        if (data) {
          setOrders(data);
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [tick]);

  return {
    orders,
    failed,
    reload: () => {
      setFailed(false);
      setOrders(null);
      setTick((n) => n + 1);
    },
  };
}

export function AccountView() {
  const router = useRouter();
  const { customer, ready, logout } = useAccount();
  const [tab, setTab] = useState<Tab>("orders");
  const state = useOrders();

  useEffect(() => {
    if (ready && !customer) router.replace("/account/login?next=/account");
  }, [ready, customer, router]);

  if (!ready || !customer) return <AccountSkeleton />;

  const signOut = () => {
    void logout().then(() => {
      router.replace("/");
      router.refresh();
    });
  };
  const items: { id: Tab; label: string; count?: number }[] = [
    { id: "orders", label: "Đơn hàng", count: state.orders?.length },
    { id: "profile", label: "Thông tin giao hàng" },
    { id: "security", label: "Mật khẩu" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-10 sm:px-8 sm:pt-14">
      {!customer.emailVerified && <VerifyBanner />}
      <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-16">
        <aside className="min-w-0">
          <div className="flex items-center gap-3.5">
            <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-turmeric text-[16px] font-extrabold text-ink">
              {initials(customer.fullName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[16px] font-bold leading-tight">{customer.fullName}</p>
              <p className="truncate text-[13px] text-muted">{customer.email}</p>
            </div>
          </div>

          <nav aria-label="Tài khoản" className="mt-6 lg:mt-8">
            <div role="tablist" aria-orientation="vertical" className="flex gap-6 overflow-x-auto border-b border-line lg:grid lg:gap-0.5 lg:border-0">
              {items.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  id={`tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`panel-${item.id}`}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "-mb-px flex shrink-0 items-center justify-between gap-3 border-b-2 py-3 text-[15px] transition-colors",
                    "lg:mb-0 lg:border-b-0 lg:border-l-2 lg:py-2.5 lg:pl-4",
                    tab === item.id ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {item.label}
                  {item.count !== undefined && <span className="text-[13px] text-muted">{item.count}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-4 hidden w-full border-t border-line pt-4 pl-4 text-left text-[15px] text-muted transition-colors hover:text-danger lg:block"
            >
              Đăng xuất
            </button>
          </nav>
        </aside>

        <div className="min-w-0">
          {tab === "orders" ? (
            <section id="panel-orders" role="tabpanel" aria-labelledby="tab-orders">
              <OrdersPanel {...state} />
            </section>
          ) : tab === "profile" ? (
            <section id="panel-profile" role="tabpanel" aria-labelledby="tab-profile">
              <ProfilePanel />
            </section>
          ) : (
            <section id="panel-security" role="tabpanel" aria-labelledby="tab-security">
              <PasswordPanel />
            </section>
          )}
          <button
            type="button"
            onClick={signOut}
            className="mt-10 border-t border-line pt-5 text-[15px] text-muted transition-colors hover:text-danger lg:hidden"
          >
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-14 sm:px-8" aria-busy="true" aria-label="Đang tải tài khoản">
      <div className="grid gap-12 lg:grid-cols-[230px_1fr] lg:gap-16">
        <div className="h-24 animate-pulse rounded-lg bg-canvas/70" />
        <div className="grid gap-4">
          <div className="h-8 w-48 animate-pulse rounded bg-canvas/70" />
          <div className="h-20 animate-pulse rounded bg-canvas/50" />
          <div className="h-20 animate-pulse rounded bg-canvas/50" />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ orders
const FILTERS = [
  { id: "all", label: "Tất cả", match: () => true },
  { id: "open", label: "Đang xử lý", match: (o: OrderOut) => ["new", "confirmed", "shipping"].includes(o.status) },
  { id: "done", label: "Đã nhận", match: (o: OrderOut) => o.status === "completed" },
  { id: "cancelled", label: "Đã hủy", match: (o: OrderOut) => o.status === "cancelled" },
] as const;

function OrdersPanel({ orders, failed, reload }: OrderState) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = (orders ?? []).filter(active.match);
  const spent = useMemo(() => (orders ?? []).filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + o.totalVnd, 0), [orders]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Đơn hàng</h1>
        {orders && orders.length > 0 && (
          <p className="text-sm text-muted">
            {orders.length} đơn · đã chi tiêu {formatVnd(spent)}
          </p>
        )}
      </div>

      {orders && orders.length > 0 && (
        <div role="group" aria-label="Lọc đơn hàng" className="mt-6 flex gap-6 overflow-x-auto border-b border-line">
          {FILTERS.map((f) => {
            const n = orders.filter(f.match).length;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 pb-3 text-[14px] transition-colors",
                  filter === f.id ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {f.label} <span className="text-muted">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {failed && (
        <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-line py-5">
          <p className="text-sm text-danger">Không tải được danh sách đơn hàng.</p>
          <button type="button" onClick={reload} className="text-sm font-semibold underline underline-offset-4">
            Thử lại
          </button>
        </div>
      )}

      {orders === null && !failed && (
        <div className="mt-6 grid gap-px" aria-busy="true" aria-label="Đang tải đơn hàng">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse border-b border-line bg-canvas/30" />
          ))}
        </div>
      )}

      {orders && orders.length === 0 && (
        <div className="mt-10 grid justify-items-center gap-4 py-10 text-center">
          <span className="relative size-24 overflow-hidden rounded-full bg-turmeric-soft">
            <Image src="/photos/bt-xike-01.webp" alt="" fill sizes="96px" unoptimized className="object-cover" />
          </span>
          <div>
            <p className="text-xl font-bold tracking-[-0.02em]">Bạn chưa có đơn hàng nào</p>
            <p className="mx-auto mt-1.5 max-w-[36ch] text-[15px] leading-relaxed text-muted">Khi bạn đặt hàng, đơn sẽ hiện ở đây để theo dõi.</p>
          </div>
          <Link href="/products" className={buttonClass({ size: "lg" })}>
            Đến cửa hàng
          </Link>
        </div>
      )}

      {orders && orders.length > 0 && shown.length === 0 && <p className="border-b border-line py-10 text-center text-sm text-muted">Không có đơn nào trong mục này.</p>}

      <ul>
        {shown.map((o) => {
          const expanded = open === o.code;
          const first = o.items[0];
          const more = o.items.length - 1;
          const qty = o.items.reduce((n, i) => n + i.qty, 0);
          return (
            <li key={o.code} className="border-b border-line">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`order-${o.code}`}
                onClick={() => setOpen(expanded ? null : o.code)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-5 text-left transition-colors hover:bg-paper/70 sm:px-2"
              >
                <span className="grid min-w-0 gap-1">
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <b className="font-mono text-[15px] tracking-tight">#{o.code}</b>
                    <StatusLabel status={o.status} />
                  </span>
                  <span className="truncate text-[15px]">
                    {first ? first.productName : "Đơn hàng"}
                    {more > 0 && <span className="text-muted"> và {more} sản phẩm khác</span>}
                  </span>
                  <span className="text-[13px] text-muted">{formatDateTime(o.createdAt)}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="grid justify-items-end gap-0.5">
                    <span className="text-[16px] font-bold">{formatVnd(o.totalVnd)}</span>
                    <span className="text-[13px] text-muted">{qty} món</span>
                  </span>
                  <ChevronIcon className={cn("text-muted transition-transform", expanded && "rotate-180")} />
                </span>
              </button>
              {expanded && (
                <div id={`order-${o.code}`} className="pb-7 sm:px-2">
                  <OrderDetail order={o} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One order laid out flat: progress, items, totals, delivery. No boxes inside boxes. */
function OrderDetail({ order }: { order: OrderOut }) {
  const cancelled = order.status === "cancelled";
  const reached = ORDER_STEPS.indexOf(order.status);
  const payment = order.payments.at(-1);
  const address = [order.shipAddress, order.shipWard, order.shipDistrict, order.shipProvince].filter(Boolean).join(", ");
  return (
    <div className="grid gap-7 pt-1">
      {cancelled ? (
        <p className="text-sm text-danger">
          {ORDER_STATUS_LABEL.cancelled}
          {order.history.at(-1)?.note ? ` · ${order.history.at(-1)?.note}` : ""}
        </p>
      ) : (
        <ol className="grid grid-cols-4 gap-2" aria-label="Tiến trình đơn hàng">
          {ORDER_STEPS.map((s, i) => (
            <li key={s} aria-current={i === reached ? "step" : undefined} className="grid gap-2">
              <span className={cn("h-1 rounded-full", i <= reached ? "bg-accent" : "bg-line")} />
              <span className={cn("text-[13px]", i === reached ? "font-semibold text-ink" : "text-muted")}>{ORDER_STATUS_LABEL[s]}</span>
            </li>
          ))}
        </ol>
      )}

      <div>
        {order.items.map((i) => (
          <div key={i.sku} className="flex items-baseline justify-between gap-4 border-t border-line py-3 first:border-t-0">
            <div className="min-w-0">
              <p className="text-[15px] font-medium">{i.productName}</p>
              <p className="text-[13px] text-muted">
                {i.variantName} · {formatVnd(i.unitPriceVnd)} × {i.qty}
              </p>
            </div>
            <p className="shrink-0 text-[15px] font-semibold">{formatVnd(i.lineTotalVnd)}</p>
          </div>
        ))}
        <dl className="ml-auto grid max-w-[280px] gap-1.5 border-t border-line pt-3 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-muted">Tạm tính</dt>
            <dd>{formatVnd(order.subtotalVnd)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Phí giao hàng</dt>
            <dd>{order.shippingFeeVnd === 0 ? "Miễn phí" : formatVnd(order.shippingFeeVnd)}</dd>
          </div>
          <div className="flex justify-between text-[16px] font-bold">
            <dt>Tổng cộng</dt>
            <dd>{formatVnd(order.totalVnd)}</dd>
          </div>
        </dl>
      </div>

      <dl className="grid gap-x-8 gap-y-4 text-[14px] sm:grid-cols-2">
        <div>
          <dt className="text-muted">Người nhận</dt>
          <dd className="mt-0.5 font-medium">
            {order.customerName} · {order.customerPhone}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Thanh toán</dt>
          <dd className="mt-0.5 font-medium">
            {PAYMENT_METHOD_LABEL[order.paymentMethod]}
            {payment ? ` · ${PAYMENT_STATUS_LABEL[payment.status]}` : ""}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted">Giao đến</dt>
          <dd className="mt-0.5 font-medium">{address}</dd>
        </div>
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------ profile
const PHONE = /^0\d{9,10}$/;
const normalizePhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("84") && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
};

/** One settings block: what it is on the left, the fields on the right, a hairline between blocks. */
function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 border-t border-line py-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12">
      <div>
        <h2 className="text-[16px] font-bold">{title}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{hint}</p>
      </div>
      <div className="grid max-w-[560px] gap-5">{children}</div>
    </section>
  );
}

function ProfilePanel() {
  const { customer, csrf, setCustomer } = useAccount();
  const [form, setForm] = useState(() => ({
    fullName: customer?.fullName ?? "",
    phone: customer?.phone ?? "",
    shipAddress: customer?.shipAddress ?? "",
    shipWard: customer?.shipWard ?? "",
    shipDistrict: customer?.shipDistrict ?? "",
    shipProvince: customer?.shipProvince ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!customer) return null;

  const saved = {
    fullName: customer.fullName,
    phone: customer.phone,
    shipAddress: customer.shipAddress,
    shipWard: customer.shipWard,
    shipDistrict: customer.shipDistrict,
    shipProvince: customer.shipProvince,
  };
  const dirty = (Object.keys(saved) as (keyof typeof saved)[]).some((k) => form[k].trim() !== saved[k]);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setMessage(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!form.fullName.trim()) found.fullName = "Nhập họ và tên.";
    if (form.phone.trim() && !PHONE.test(normalizePhone(form.phone))) found.phone = "Số điện thoại chưa đúng, ví dụ 0901234567.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await browserApi.PATCH("/api/account/profile", {
        headers: { "X-CSRF-Token": csrf ?? "" },
        body: {
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          shipAddress: form.shipAddress.trim(),
          shipWard: form.shipWard.trim(),
          shipDistrict: form.shipDistrict.trim(),
          shipProvince: form.shipProvince.trim(),
        },
      });
      if (data) {
        setCustomer(data);
        setForm({
          fullName: data.fullName,
          phone: data.phone,
          shipAddress: data.shipAddress,
          shipWard: data.shipWard,
          shipDistrict: data.shipDistrict,
          shipProvince: data.shipProvince,
        });
        setMessage({ ok: true, text: "Đã lưu. Lần thanh toán sau sẽ được điền sẵn." });
      } else {
        setMessage({ ok: false, text: errorText(error) });
      }
    } catch {
      setMessage({ ok: false, text: "Không kết nối được máy chủ. Vui lòng thử lại." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <h1 className="mb-7 text-[28px] font-extrabold tracking-[-0.03em]">Thông tin giao hàng</h1>

      <Section title="Liên hệ" hint="Tên và số điện thoại shop dùng để xác nhận đơn.">
        <TextField label="Họ và tên" name="fullName" value={form.fullName} onChange={set("fullName")} error={errors.fullName} maxLength={120} autoComplete="name" />
        <TextField label="Số điện thoại" name="phone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} error={errors.phone} maxLength={30} autoComplete="tel" placeholder="0901 234 567" />
        <TextField label="E-mail" name="email" value={customer.email} readOnly hint="E-mail dùng để đăng nhập nên chưa thể thay đổi." />
      </Section>

      <Section title="Địa chỉ nhận hàng" hint="Điền sẵn khi thanh toán. Mỗi đơn vẫn lưu riêng địa chỉ lúc bạn đặt.">
        <TextField label="Địa chỉ (số nhà, đường)" name="shipAddress" value={form.shipAddress} onChange={set("shipAddress")} maxLength={255} autoComplete="address-line1" placeholder="12 Lê Lợi" />
        <div className="grid gap-5 sm:grid-cols-3">
          <TextField label="Phường / xã" name="shipWard" value={form.shipWard} onChange={set("shipWard")} maxLength={120} />
          <TextField label="Quận / huyện" name="shipDistrict" value={form.shipDistrict} onChange={set("shipDistrict")} maxLength={120} />
          <TextField label="Tỉnh / thành phố" name="shipProvince" value={form.shipProvince} onChange={set("shipProvince")} maxLength={120} />
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6 md:pl-[248px]">
        <button
          type="submit"
          disabled={!dirty || busy}
          aria-busy={busy}
          className="flex h-11 items-center gap-2 rounded-[10px] bg-ink px-7 text-[15px] font-semibold text-paper transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-paper/40 border-t-paper" />}
          {busy ? "Đang lưu…" : "Lưu thay đổi"}
        </button>
        <p role={message ? (message.ok ? "status" : "alert") : undefined} className={cn("text-sm", message ? (message.ok ? "text-ok" : "text-danger") : "text-muted")}>
          {message ? message.text : dirty ? "Bạn có thay đổi chưa lưu." : ""}
        </p>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ e-mail not confirmed yet
/** A flat notice above the page: the account works, but ordering may need the e-mail to be confirmed. */
function VerifyBanner() {
  const { customer, csrf, refresh } = useAccount();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  const [note, setNote] = useState("");
  if (!customer) return null;

  async function resend() {
    setState("busy");
    try {
      const { response, error } = await browserApi.POST("/api/account/resend-verification", { headers: { "X-CSRF-Token": csrf ?? "" } });
      if (response.ok) {
        setState("sent");
        setNote("");
      } else {
        setState("failed");
        setNote(errorText(error));
      }
    } catch {
      setState("failed");
      setNote("Không kết nối được máy chủ. Vui lòng thử lại.");
    }
  }

  return (
    <div role="status" className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[10px] bg-turmeric-soft px-5 py-3.5 text-[14px]">
      <p className="leading-relaxed">
        <b>Bạn chưa xác nhận e-mail.</b>{" "}
        {state === "sent" ? `Chúng tôi vừa gửi thư tới ${customer.email}. Hãy bấm đường dẫn trong thư.` : `Hãy bấm đường dẫn trong thư đã gửi tới ${customer.email} để có thể đặt hàng.`}
        {state === "failed" && <span className="text-danger"> {note}</span>}
      </p>
      <span className="flex shrink-0 items-center gap-4 font-semibold">
        <button type="button" onClick={() => void resend()} disabled={state === "busy"} className="underline underline-offset-4 hover:text-accent disabled:opacity-50">
          {state === "busy" ? "Đang gửi…" : state === "sent" ? "Gửi lại" : "Gửi lại thư"}
        </button>
        <button type="button" onClick={() => void refresh()} className="underline underline-offset-4 hover:text-accent">
          Tôi đã xác nhận
        </button>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ password
function PasswordPanel() {
  const { csrf } = useAccount();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setMessage(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!form.current) found.current = "Nhập mật khẩu hiện tại.";
    if (form.next.length < 8) found.next = "Mật khẩu mới cần ít nhất 8 ký tự.";
    else if (form.next === form.current) found.next = "Mật khẩu mới phải khác mật khẩu hiện tại.";
    if (form.confirm !== form.next) found.confirm = "Hai mật khẩu chưa giống nhau.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const { response, error } = await browserApi.POST("/api/account/change-password", {
        headers: { "X-CSRF-Token": csrf ?? "" },
        body: { currentPassword: form.current, newPassword: form.next },
      });
      if (response.ok) {
        setForm({ current: "", next: "", confirm: "" });
        setMessage({ ok: true, text: "Đã đổi mật khẩu." });
      } else {
        const code = (error as { error?: { code?: string } } | undefined)?.error?.code;
        if (code === "wrong_password") setErrors({ current: errorText(error) });
        else setMessage({ ok: false, text: errorText(error) });
      }
    } catch {
      setMessage({ ok: false, text: "Không kết nối được máy chủ. Vui lòng thử lại." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <h1 className="mb-7 text-[28px] font-extrabold tracking-[-0.03em]">Mật khẩu</h1>
      <Section title="Đổi mật khẩu" hint="Nhập mật khẩu hiện tại để xác nhận đó là bạn. Nên dùng mật khẩu chưa dùng ở nơi khác.">
        <PasswordField label="Mật khẩu hiện tại" name="current" autoComplete="current-password" value={form.current} onChange={set("current")} error={errors.current} />
        <PasswordField label="Mật khẩu mới" name="next" autoComplete="new-password" value={form.next} onChange={set("next")} error={errors.next} />
        <StrengthMeter password={form.next} />
        <PasswordField label="Nhập lại mật khẩu mới" name="confirm" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} error={errors.confirm} />
      </Section>
      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6 md:pl-[248px]">
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="flex h-11 items-center gap-2 rounded-[10px] bg-ink px-7 text-[15px] font-semibold text-paper transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-paper/40 border-t-paper" />}
          {busy ? "Đang lưu…" : "Đổi mật khẩu"}
        </button>
        <p role={message ? (message.ok ? "status" : "alert") : undefined} className={cn("text-sm", message?.ok ? "text-ok" : "text-danger")}>
          {message?.text}
        </p>
      </div>
      <p className="mt-6 text-[13px] text-muted md:pl-[248px]">Quên mật khẩu hiện tại? Đăng xuất rồi chọn &ldquo;Quên mật khẩu?&rdquo; ở trang đăng nhập.</p>
    </form>
  );
}
