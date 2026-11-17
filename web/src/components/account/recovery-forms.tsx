"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { browserApi } from "@/lib/api/browser";
import { errorText } from "@/lib/errors";
import { useAccount } from "./account-provider";
import { AuthFrame, FormAlert, SubmitButton } from "./auth-frame";
import { EMAIL } from "./auth-form";
import { PasswordField, StrengthMeter, TextField } from "./fields";

const link = "font-semibold text-ink underline underline-offset-4 hover:text-accent";
const quiet = "text-[13px] leading-relaxed text-muted";

/** Ask for a reset link. The answer is the same for every address, so this page never says whether an account exists. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!EMAIL.test(email.trim())) return setError("Nhập đúng địa chỉ e-mail, ví dụ ten@gmail.com.");
    setBusy(true);
    try {
      const { response, error: failure } = await browserApi.POST("/api/account/forgot-password", { body: { email: email.trim() } });
      if (response.ok) setSent(email.trim());
      else setError(errorText(failure));
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    }
    setBusy(false);
  }

  return (
    <AuthFrame
      mode="recover"
      title={sent ? "Kiểm tra hộp thư" : "Quên mật khẩu"}
      subtitle={sent ? undefined : "Nhập e-mail đã đăng ký. Chúng tôi sẽ gửi đường dẫn để bạn đặt mật khẩu mới."}
      topLink={{ prompt: "Nhớ mật khẩu rồi?", label: "Đăng nhập", href: "/account/login" }}
    >
      {sent ? (
        <div className="grid gap-5">
          <p className="text-[15px] leading-relaxed">
            Nếu <b className="break-all">{sent}</b> có tài khoản, một thư đặt lại mật khẩu đang trên đường tới. Đường dẫn có hiệu lực trong 1 giờ.
          </p>
          <p className={quiet}>Chưa thấy thư? Hãy xem cả mục thư rác, hoặc đợi vài phút rồi thử lại.</p>
          <Link href="/account/login" className={`${link} w-fit text-[15px]`}>
            Quay lại đăng nhập
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
          <FormAlert text={error} />
          <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <SubmitButton busy={busy}>Gửi đường dẫn</SubmitButton>
        </form>
      )}
    </AuthFrame>
  );
}

/** Choose a new password with the token from the e-mail link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  // No token in the address means the link was cut off when it was copied: same advice as an expired one.
  const [error, setError] = useState(token ? "" : errorText({ error: { code: "invalid_token" } }));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(!token);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError(errorText({ error: { code: "invalid_token" } }));
      return;
    }
    const found: typeof errors = {};
    if (password.length < 8) found.password = "Mật khẩu cần ít nhất 8 ký tự.";
    if (confirm !== password) found.confirm = "Hai mật khẩu chưa giống nhau.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const { response, error: failure } = await browserApi.POST("/api/account/reset-password", { body: { token, password } });
      if (response.ok) setDone(true);
      else {
        setExpired((failure as { error?: { code?: string } } | undefined)?.error?.code === "invalid_token");
        setError(errorText(failure));
      }
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <AuthFrame mode="recover" title="Đã đổi mật khẩu" subtitle="Bạn có thể đăng nhập bằng mật khẩu mới.">
        <Link href="/account/login" className="flex h-12 items-center justify-center rounded-[10px] bg-ink text-[15px] font-semibold text-paper transition-colors hover:bg-accent">
          Đăng nhập
        </Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame mode="recover" title="Đặt mật khẩu mới" subtitle="Chọn một mật khẩu bạn chưa dùng ở nơi khác." topLink={{ prompt: "Không phải bạn?", label: "Về đăng nhập", href: "/account/login" }}>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
        <FormAlert text={error} />
        {expired && (
          <p className={quiet}>
            <Link href="/account/forgot-password" className={link}>
              Yêu cầu một đường dẫn mới
            </Link>
          </p>
        )}
        <PasswordField label="Mật khẩu mới" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoFocus />
        <StrengthMeter password={password} />
        <PasswordField label="Nhập lại mật khẩu" name="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <SubmitButton busy={busy}>Lưu mật khẩu mới</SubmitButton>
      </form>
    </AuthFrame>
  );
}

type VerifyState = "checking" | "ok" | "failed" | "network";

/** The page behind the "Xác nhận e-mail" button: it uses the token once, on arrival. */
export function VerifyEmailView({ token }: { token: string }) {
  const { customer, refresh } = useAccount();
  const [state, setState] = useState<VerifyState>(token ? "checking" : "failed");
  // React runs effects twice in development; a verification link works once, so the second run must not fire a second request.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    void browserApi
      .POST("/api/account/verify-email", { body: { token } })
      .then(({ response }) => {
        setState(response.ok ? "ok" : "failed");
        if (response.ok) void refresh();
      })
      .catch(() => setState("network"));
  }, [token, refresh]);

  const copy: Record<VerifyState, { title: string; sub: string }> = {
    checking: { title: "Đang xác nhận…", sub: "Vui lòng chờ một chút." },
    ok: { title: "E-mail đã được xác nhận", sub: "Cảm ơn bạn. Bây giờ bạn có thể đặt hàng." },
    failed: { title: "Đường dẫn không dùng được", sub: "Đường dẫn đã được dùng hoặc đã hết hạn (24 giờ)." },
    network: { title: "Chưa kết nối được", sub: "Không kết nối được máy chủ. Hãy tải lại trang." },
  };
  const c = copy[state];

  return (
    <AuthFrame mode="login" title={c.title} subtitle={c.sub}>
      {state === "ok" && (
        <div className="grid gap-3">
          <Link href="/checkout" className="flex h-12 items-center justify-center rounded-[10px] bg-ink text-[15px] font-semibold text-paper transition-colors hover:bg-accent">
            Tiếp tục thanh toán
          </Link>
          <Link href="/products" className={`${link} w-fit text-[14px]`}>
            Xem sản phẩm
          </Link>
        </div>
      )}
      {state === "failed" && (
        <div className="grid gap-3 text-[14px]">
          <p className={quiet}>
            {customer ? (
              <>
                Bạn đang đăng nhập.{" "}
                <Link href="/account" className={link}>
                  Vào tài khoản
                </Link>{" "}
                để gửi lại thư xác nhận.
              </>
            ) : (
              <>
                <Link href="/account/login?next=/account" className={link}>
                  Đăng nhập
                </Link>{" "}
                để gửi lại thư xác nhận.
              </>
            )}
          </p>
        </div>
      )}
    </AuthFrame>
  );
}
