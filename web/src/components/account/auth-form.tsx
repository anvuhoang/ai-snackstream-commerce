"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "./account-provider";
import { AuthFrame, FormAlert, SubmitButton } from "./auth-frame";
import { PasswordField, StrengthMeter, TextField } from "./fields";

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Same rule as the server: a Vietnamese number, with or without +84. */
const phoneOk = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("84") && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
  return /^0\d{9,10}$/.test(local);
};

type Errors = Partial<Record<"fullName" | "email" | "phone" | "password" | "confirm", string>>;

/** Sign in or create an account. `next` is a same-site path already checked by the page. */
export function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const router = useRouter();
  const { login, register } = useAccount();
  const isLogin = mode === "login";
  const [values, setValues] = useState({ fullName: "", email: "", phone: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const other = `${isLogin ? "/account/register" : "/account/login"}?next=${encodeURIComponent(next)}`;
  const toCheckout = next.startsWith("/checkout");
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  function validate(): Errors {
    const found: Errors = {};
    if (!EMAIL.test(values.email.trim())) found.email = "Nhập đúng địa chỉ e-mail, ví dụ ten@gmail.com.";
    if (isLogin) {
      if (!values.password) found.password = "Nhập mật khẩu.";
      return found;
    }
    if (!values.fullName.trim()) found.fullName = "Nhập họ và tên.";
    if (values.phone.trim() && !phoneOk(values.phone)) found.phone = "Số điện thoại chưa đúng, ví dụ 0901234567.";
    if (values.password.length < 8) found.password = "Mật khẩu cần ít nhất 8 ký tự.";
    if (values.confirm !== values.password) found.confirm = "Hai mật khẩu chưa giống nhau.";
    return found;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const failure = isLogin
      ? await login(values.email.trim(), values.password)
      : await register({ email: values.email.trim(), password: values.password, fullName: values.fullName.trim(), phone: values.phone.trim() });
    if (failure) {
      setFormError(failure);
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <AuthFrame
      mode={mode}
      title={isLogin ? "Đăng nhập" : "Tạo tài khoản"}
      subtitle={
        toCheckout && isLogin
          ? "Đăng nhập để thanh toán. Giỏ hàng của bạn vẫn được giữ nguyên."
          : isLogin
            ? "Chào mừng bạn quay lại SnackStream."
            : "Chưa đến một phút. Đăng ký xong là bạn được đăng nhập luôn."
      }
      topLink={{
        prompt: isLogin ? "Chưa có tài khoản?" : "Đã có tài khoản?",
        label: isLogin ? "Đăng ký" : "Đăng nhập",
        href: other,
      }}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
        <FormAlert text={formError} />

        {!isLogin && (
          <TextField label="Họ và tên" name="fullName" autoComplete="name" maxLength={120} value={values.fullName} onChange={set("fullName")} error={errors.fullName} autoFocus />
        )}
        <TextField
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={values.email}
          onChange={set("email")}
          error={errors.email}
          autoFocus={isLogin}
        />
        {!isLogin && (
          <TextField label="Số điện thoại" name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={values.phone} onChange={set("phone")} error={errors.phone} optional />
        )}
        <PasswordField
          label="Mật khẩu"
          name="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          value={values.password}
          onChange={set("password")}
          error={errors.password}
          action={
            isLogin ? (
              <Link href="/account/forgot-password" className="text-[13px] font-medium text-muted underline underline-offset-4 hover:text-accent">
                Quên mật khẩu?
              </Link>
            ) : undefined
          }
        />
        {!isLogin && <StrengthMeter password={values.password} />}
        {!isLogin && (
          <PasswordField label="Nhập lại mật khẩu" name="confirm" autoComplete="new-password" value={values.confirm} onChange={set("confirm")} error={errors.confirm} />
        )}

        <SubmitButton busy={busy}>{isLogin ? "Đăng nhập" : "Tạo tài khoản"}</SubmitButton>
      </form>

      <div className="grid gap-3 text-[13px] leading-relaxed text-muted">
        {!isLogin && <p>Khi tạo tài khoản, bạn đồng ý để shop liên hệ xác nhận đơn hàng qua số điện thoại bạn cung cấp. Chúng tôi sẽ gửi một thư xác nhận e-mail.</p>}
        <Link href={toCheckout ? "/checkout" : "/products"} className="w-fit font-medium text-ink underline underline-offset-4 hover:text-accent">
          {toCheckout ? "Quay lại giỏ hàng" : "Tiếp tục xem sản phẩm"}
        </Link>
      </div>
    </AuthFrame>
  );
}
