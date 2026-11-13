"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormRow, Status } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { AdminProduct, AdminVariant } from "@/lib/catalog";
import { errorText } from "@/lib/errors";
import { useAdmin } from "./admin-shell";

/** "" -> null (cleared), "123" -> 123, anything else -> NaN (invalid). */
const parse = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const isWhole = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0;

function VariantRow({ variant, onChanged }: { variant: AdminVariant; onChanged: () => void }) {
  const { user, csrf } = useAdmin();
  const [name, setName] = useState(variant.name);
  const [price, setPrice] = useState(String(variant.priceVnd));
  const [was, setWas] = useState(variant.compareAtVnd?.toString() ?? "");
  const [weight, setWeight] = useState(variant.weightG?.toString() ?? "");
  const [active, setActive] = useState(variant.isActive);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const disabled = user.role !== "admin";

  async function save() {
    const priceN = parse(price);
    const wasN = parse(was);
    const weightN = parse(weight);
    if (!name.trim()) return setMessage({ kind: "error", text: "Nhập tên quy cách." });
    if (!isWhole(priceN)) return setMessage({ kind: "error", text: "Giá bán phải là số nguyên không âm." });
    if (wasN !== null && (!Number.isInteger(wasN) || wasN <= priceN)) return setMessage({ kind: "error", text: "Giá gốc phải cao hơn giá bán." });
    if (weightN !== null && (!Number.isInteger(weightN) || weightN < 1)) return setMessage({ kind: "error", text: "Khối lượng phải là số nguyên dương." });

    setBusy(true);
    setMessage(null);
    const { error } = await browserApi.PATCH("/api/admin/catalog/variants/{variant_id}", {
      params: { path: { variant_id: variant.id } },
      body: { name: name.trim(), priceVnd: priceN, compareAtVnd: wasN, weightG: weightN, isActive: active },
      headers: adminHeaders(csrf),
    });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: errorText(error) });
    setMessage({ kind: "ok", text: "Đã lưu." });
    onChanged();
  }

  return (
    <li className="grid gap-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{variant.sku}</span>
        {!variant.isActive && <Badge tone="warn">Ngừng bán</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormRow label="Tên quy cách">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
        </FormRow>
        <FormRow label="Giá bán (đ)">
          <Input value={price} onChange={(e) => setPrice(e.target.value)} disabled={disabled} type="number" inputMode="numeric" min={0} />
        </FormRow>
        <FormRow label="Giá gốc (đ)" hint="Để trống nếu không giảm giá.">
          <Input value={was} onChange={(e) => setWas(e.target.value)} disabled={disabled} type="number" inputMode="numeric" min={0} />
        </FormRow>
        <FormRow label="Khối lượng (g)">
          <Input value={weight} onChange={(e) => setWeight(e.target.value)} disabled={disabled} type="number" inputMode="numeric" min={1} />
        </FormRow>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={disabled} className="size-4 accent-brand" />
        Đang bán quy cách này
      </label>
      {message && <Status kind={message.kind}>{message.text}</Status>}
      {!disabled && (
        <div>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu quy cách"}
          </Button>
        </div>
      )}
    </li>
  );
}

function AddVariant({ productId, onChanged }: { productId: number; onChanged: () => void }) {
  const { csrf } = useAdmin();
  const [f, setF] = useState({ sku: "", name: "", price: "", was: "", weight: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const price = parse(f.price);
    const was = parse(f.was);
    const weight = parse(f.weight);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$/.test(f.sku)) return setMessage({ kind: "error", text: "SKU gồm chữ, số, - hoặc _ (2–39 ký tự)." });
    if (!f.name.trim()) return setMessage({ kind: "error", text: "Nhập tên quy cách." });
    if (!isWhole(price)) return setMessage({ kind: "error", text: "Nhập giá bán là số nguyên không âm." });
    if (was !== null && (!Number.isInteger(was) || was <= price)) return setMessage({ kind: "error", text: "Giá gốc phải cao hơn giá bán." });
    if (weight !== null && (!Number.isInteger(weight) || weight < 1)) return setMessage({ kind: "error", text: "Khối lượng phải là số nguyên dương." });

    setBusy(true);
    setMessage(null);
    const { error } = await browserApi.POST("/api/admin/catalog/products/{product_id}/variants", {
      params: { path: { product_id: productId } },
      body: { sku: f.sku, name: f.name.trim(), priceVnd: price, compareAtVnd: was, weightG: weight },
      headers: adminHeaders(csrf),
    });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: errorText(error) });
    setF({ sku: "", name: "", price: "", was: "", weight: "" });
    setMessage({ kind: "ok", text: "Đã thêm quy cách." });
    onChanged();
  }

  return (
    <form onSubmit={add} className="grid gap-3 rounded-lg border border-dashed border-line p-4" noValidate>
      <h3 className="text-sm font-bold">Thêm quy cách</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormRow label="Mã SKU *">
          <Input value={f.sku} onChange={set("sku")} placeholder="BTT-500" autoCapitalize="characters" />
        </FormRow>
        <FormRow label="Tên quy cách *">
          <Input value={f.name} onChange={set("name")} placeholder="Gói 500g" />
        </FormRow>
        <FormRow label="Giá bán (đ) *">
          <Input value={f.price} onChange={set("price")} type="number" inputMode="numeric" min={0} />
        </FormRow>
        <FormRow label="Giá gốc (đ)">
          <Input value={f.was} onChange={set("was")} type="number" inputMode="numeric" min={0} />
        </FormRow>
        <FormRow label="Khối lượng (g)">
          <Input value={f.weight} onChange={set("weight")} type="number" inputMode="numeric" min={1} />
        </FormRow>
      </div>
      {message && <Status kind={message.kind}>{message.text}</Status>}
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? "Đang thêm…" : "Thêm quy cách"}
        </Button>
      </div>
    </form>
  );
}

export function VariantsEditor({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const { user } = useAdmin();
  const refresh = () => router.refresh();
  return (
    <section className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-6" aria-labelledby="variants-title">
      <div>
        <h2 id="variants-title" className="text-lg font-bold">
          Quy cách và giá
        </h2>
        <p className="text-sm text-muted">Mã SKU không đổi được sau khi tạo. Quy cách ngừng bán sẽ ẩn khỏi cửa hàng nhưng không bị xóa.</p>
      </div>
      <ul className="grid gap-3">
        {product.variants.map((v) => (
          <VariantRow key={`${v.id}-${product.updatedAt}`} variant={v} onChanged={refresh} />
        ))}
      </ul>
      {user.role === "admin" && <AddVariant productId={product.id} onChanged={refresh} />}
    </section>
  );
}
