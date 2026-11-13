"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormRow, Status } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { AdminCategory } from "@/lib/catalog";
import { errorText } from "@/lib/errors";
import { useAdmin } from "./admin-shell";

function Row({ category }: { category: AdminCategory }) {
  const router = useRouter();
  const { user, csrf } = useAdmin();
  const [name, setName] = useState(category.name);
  const [order, setOrder] = useState(String(category.sortOrder));
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const disabled = user.role !== "admin";
  const dirty = name !== category.name || order !== String(category.sortOrder);

  async function save() {
    const sortOrder = Number(order);
    if (!name.trim()) return setMessage({ kind: "error", text: "Nhập tên danh mục." });
    if (!Number.isInteger(sortOrder)) return setMessage({ kind: "error", text: "Thứ tự phải là số nguyên." });
    const { error } = await browserApi.PATCH("/api/admin/catalog/categories/{category_id}", {
      params: { path: { category_id: category.id } },
      body: { name: name.trim(), sortOrder },
      headers: adminHeaders(csrf),
    });
    if (error) return setMessage({ kind: "error", text: errorText(error) });
    setMessage({ kind: "ok", text: "Đã lưu." });
    router.refresh();
  }

  return (
    <li className="grid items-end gap-3 rounded-lg border border-line p-4 sm:grid-cols-[1fr_8rem_auto]">
      <FormRow label={`Tên danh mục (${category.productCount} sản phẩm · /${category.slug})`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} maxLength={120} />
      </FormRow>
      <FormRow label="Thứ tự">
        <Input value={order} onChange={(e) => setOrder(e.target.value)} disabled={disabled} type="number" inputMode="numeric" />
      </FormRow>
      {!disabled && (
        <Button size="sm" onClick={save} disabled={!dirty}>
          Lưu
        </Button>
      )}
      {message && (
        <div className="sm:col-span-3">
          <Status kind={message.kind}>{message.text}</Status>
        </div>
      )}
    </li>
  );
}

export function CategoriesManager({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter();
  const { user, csrf } = useAdmin();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setMessage({ kind: "error", text: "Nhập tên danh mục." });
    setBusy(true);
    setMessage(null);
    const { error } = await browserApi.POST("/api/admin/catalog/categories", {
      body: { name: name.trim(), sortOrder: categories.length },
      headers: adminHeaders(csrf),
    });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: errorText(error) });
    setName("");
    setMessage({ kind: "ok", text: "Đã thêm danh mục." });
    router.refresh();
  }

  return (
    <div className="grid max-w-3xl gap-6">
      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-8 text-center text-muted">Chưa có danh mục nào.</p>
      ) : (
        <ul className="grid gap-3">
          {categories.map((c) => (
            <Row key={`${c.id}-${c.name}-${c.sortOrder}`} category={c} />
          ))}
        </ul>
      )}
      {user.role === "admin" && (
        <form onSubmit={add} className="grid gap-3 rounded-lg border border-dashed border-line p-4" noValidate>
          <FormRow label="Thêm danh mục mới">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ví dụ: Trái cây sấy" />
          </FormRow>
          {message && <Status kind={message.kind}>{message.text}</Status>}
          <div>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Đang thêm…" : "Thêm danh mục"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
