"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormRow, Select, Status, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { adminHeaders, browserApi } from "@/lib/api/browser";
import type { AdminCategory, AdminProduct } from "@/lib/catalog";
import { errorText } from "@/lib/errors";
import { useAdmin } from "./admin-shell";

const optionalInt = (v: unknown) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));

const editSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên sản phẩm").max(200, "Tên tối đa 200 ký tự"),
  categoryId: z.number().int().nullable(),
  description: z.string().max(5000, "Tối đa 5000 ký tự"),
  ingredients: z.string().max(3000, "Tối đa 3000 ký tự"),
  storage: z.string().max(2000, "Tối đa 2000 ký tự"),
  ingredientsVerified: z.boolean(),
  shopeeUrl: z
    .string()
    .max(500)
    .refine((v) => v.trim() === "" || /^https?:\/\//i.test(v.trim()), "Link phải bắt đầu bằng http:// hoặc https://"),
});

// Creating also needs the first sellable variant. All errors are reported together, not one at a time.
const createSchema = editSchema.extend({
  sku: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,38}$/, "SKU gồm chữ, số, - hoặc _ (2–39 ký tự)"),
  variantName: z.string().trim().min(1, "Nhập tên quy cách, ví dụ: Gói 250g"),
  priceVnd: z.number({ error: "Nhập giá bán (số nguyên, đồng)" }).int("Giá phải là số nguyên").min(0, "Giá không được âm").max(100_000_000, "Giá quá lớn"),
  weightG: z.number().int("Khối lượng phải là số nguyên").min(1, "Khối lượng phải lớn hơn 0").max(100_000, "Khối lượng quá lớn").optional(),
});

// One value type for both modes; the variant fields simply stay unused when editing.
type Values = z.input<typeof editSchema> & Partial<Pick<z.input<typeof createSchema>, "sku" | "variantName" | "priceVnd" | "weightG">>;

export function ProductForm({ product, categories }: { product?: AdminProduct; categories: AdminCategory[] }) {
  const router = useRouter();
  const { user, csrf } = useAdmin();
  const editing = Boolean(product);
  const canEdit = user.role === "admin";
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(editing ? editSchema : createSchema) as unknown as Resolver<Values>,
    defaultValues: {
      name: product?.name ?? "",
      categoryId: product?.categoryId ?? null,
      description: product?.description ?? "",
      ingredients: product?.ingredients ?? "",
      storage: product?.storage ?? "",
      ingredientsVerified: product?.ingredientsVerified ?? false,
      shopeeUrl: product?.shopeeUrl ?? "",
    },
  });

  async function onSubmit(v: Values) {
    setResult(null);
    const common = {
      name: v.name.trim(),
      categoryId: v.categoryId,
      description: v.description,
      ingredients: v.ingredients,
      storage: v.storage,
      ingredientsVerified: v.ingredientsVerified,
      shopeeUrl: v.shopeeUrl.trim(),
    };
    const headers = adminHeaders(csrf);

    if (product) {
      const { error } = await browserApi.PATCH("/api/admin/catalog/products/{product_id}", {
        params: { path: { product_id: product.id } },
        body: common,
        headers,
      });
      if (error) return setResult({ kind: "error", text: errorText(error) });
      setResult({ kind: "ok", text: "Đã lưu thay đổi." });
      reset(v); // the saved values become the new baseline, so the form is "clean" again and the message stays
      router.refresh(); // refresh the status panel (publish blockers may have changed)
      return;
    }

    const { data, error } = await browserApi.POST("/api/admin/catalog/products", {
      body: { ...common, variants: [{ sku: v.sku!, name: v.variantName!.trim(), priceVnd: v.priceVnd!, weightG: v.weightG ?? null }] },
      headers,
    });
    if (error || !data) return setResult({ kind: "error", text: errorText(error) });
    router.push(`/admin/products/${data.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-6" noValidate>
      <h2 className="text-lg font-bold">Thông tin sản phẩm</h2>

      <FormRow label="Tên sản phẩm *" error={errors.name?.message}>
        <Input {...register("name")} disabled={!canEdit} maxLength={200} />
      </FormRow>

      <FormRow label="Danh mục" hint="Bắt buộc để đăng bán." error={errors.categoryId?.message}>
        <Select {...register("categoryId", { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} disabled={!canEdit}>
          <option value="">— Chưa chọn —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </FormRow>

      <FormRow label="Mô tả" error={errors.description?.message}>
        <Textarea {...register("description")} disabled={!canEdit} rows={3} />
      </FormRow>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormRow label="Thành phần" hint="Chép đúng theo bao bì." error={errors.ingredients?.message}>
          <Textarea {...register("ingredients")} disabled={!canEdit} rows={4} />
        </FormRow>
        <FormRow label="Hướng dẫn bảo quản" error={errors.storage?.message}>
          <Textarea {...register("storage")} disabled={!canEdit} rows={4} />
        </FormRow>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" {...register("ingredientsVerified")} disabled={!canEdit} className="mt-0.5 size-4 accent-brand" />
        <span>
          <b>Đã đối chiếu thành phần và bảo quản với bao bì thật.</b>
          <span className="block text-muted">Bắt buộc để đăng bán, vì khách có thể bị dị ứng.</span>
        </span>
      </label>

      <FormRow label="Link Shopee" hint="Tùy chọn. Hiện nút “Mua trên Shopee” ở trang sản phẩm." error={errors.shopeeUrl?.message}>
        <Input {...register("shopeeUrl")} disabled={!canEdit} type="url" inputMode="url" placeholder="https://shopee.vn/…" />
      </FormRow>

      {!editing && (
        <fieldset className="grid gap-5 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-bold">Quy cách bán đầu tiên</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormRow label="Mã SKU *" hint="Duy nhất, không đổi được sau khi tạo." error={errors.sku?.message}>
              <Input {...register("sku")} disabled={!canEdit} placeholder="BTT-250" autoCapitalize="characters" />
            </FormRow>
            <FormRow label="Tên quy cách *" error={errors.variantName?.message}>
              <Input {...register("variantName")} disabled={!canEdit} placeholder="Gói 250g" />
            </FormRow>
            <FormRow label="Giá bán (đ) *" error={errors.priceVnd?.message}>
              <Input {...register("priceVnd", { setValueAs: optionalInt })} disabled={!canEdit} type="number" inputMode="numeric" min={0} step={1} />
            </FormRow>
            <FormRow label="Khối lượng (g)" error={errors.weightG?.message}>
              <Input {...register("weightG", { setValueAs: optionalInt })} disabled={!canEdit} type="number" inputMode="numeric" min={1} step={1} />
            </FormRow>
          </div>
        </fieldset>
      )}

      {result && <Status kind={result.kind}>{result.text}</Status>}
      {!canEdit && <Status kind="error">Chỉ quản trị viên mới được thay đổi sản phẩm.</Status>}

      <div>
        <Button type="submit" disabled={!canEdit || isSubmitting || (editing && !isDirty)}>
          {isSubmitting ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Tạo sản phẩm"}
        </Button>
      </div>
    </form>
  );
}
