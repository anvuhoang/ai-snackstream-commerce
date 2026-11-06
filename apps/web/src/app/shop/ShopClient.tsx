"use client";
import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { Product } from "@/lib/types";

const vnd = (v: number) => `${new Intl.NumberFormat("vi-VN").format(Math.round(v))}đ`;

function Inner({ products }: { products: Product[] }) {
  const sp = useSearchParams();
  const src = sp.get("utm_source") ?? "", camp = sp.get("utm_campaign") ?? "", code = sp.get("utm_content") ?? "";
  const topRef = useRef<HTMLElement>(null);
  const seen = useRef(new Set<string>());

  const send = (type: string, sku = "") =>
    fetch("/api/public/event", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ type, sku, content: code, src, camp }) }).catch(() => {});

  useEffect(() => {
    send("page_view");
    const on = () => topRef.current?.classList.toggle("stuck", window.scrollY > 10);
    window.addEventListener("scroll", on, { passive: true });
    const cards = document.querySelectorAll<HTMLElement>(".shop .pcard");
    cards.forEach((c, i) => c.style.setProperty("--d", `${i * 90}ms`));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15 });
    cards.forEach((c) => io.observe(c));
    return () => { window.removeEventListener("scroll", on); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewOnce = (sku: string) => { if (!seen.current.has(sku)) { seen.current.add(sku); send("product_view", sku); } };
  const goQs = new URLSearchParams({ ...(code && { c: code }), ...(src && { src }), ...(camp && { camp }) }).toString();

  return (
    <div className="shop">
      <header className="top" ref={topRef}>
        <div className="wrap bar">
          <a className="logo" href="/shop"><span className="mk">S</span> SnackStream</a>
          <a className="cta-s" href="#sp">Xem sản phẩm</a>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="wrap">
            <span className="pill">Đặc sản ăn vặt đường phố</span>
            <h1>Cay, giòn, ăn là nghiền.</h1>
            <p>Bánh tráng trộn, bò khô, khô gà lá chanh… giao nhanh toàn quốc. Đặt hàng an toàn ngay trên Shopee.</p>
            <a className="cta" href="#sp">Chọn món ngay</a>
          </div>
        </section>
        <section id="sp" className="wrap prods">
          <h2>Sản phẩm nổi bật</h2>
          {products.length === 0 ? <p className="empty">Cửa hàng đang cập nhật sản phẩm. Vui lòng quay lại sau.</p> : (
            <div className="grid">
              {products.map((p) => (
                <article key={p.sku} className="pcard" onPointerEnter={() => viewOnce(p.sku)} onFocus={() => viewOnce(p.sku)}>
                  <div className="img" aria-hidden="true"><span>{p.name.slice(0, 1)}</span></div>
                  <div className="body">
                    <h3>{p.name}</h3>
                    <p className="meta">{p.spiceLevel}{p.flavor && ` · ${p.flavor}`}</p>
                    <div className="price">
                      {p.flashPrice && p.flashPrice < p.price ? <><b>{vnd(p.flashPrice)}</b> <s>{vnd(p.price)}</s></> : <b>{vnd(p.price)}</b>}
                    </div>
                    {p.stock != null && p.stock <= 0 && <span className="oos">Tạm hết hàng</span>}
                    {p.isDemo && <span className="demo">Sản phẩm demo</span>}
                    <a className="buy" href={`/go/${encodeURIComponent(p.sku)}${goQs ? `?${goQs}` : ""}`} rel="noopener">Mua trên Shopee</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="wrap foot">© SnackStream · Sản phẩm bán trên Shopee. Thông tin thành phần và hạn dùng xem tại trang sản phẩm Shopee.</footer>
    </div>
  );
}

export function ShopClient({ products }: { products: Product[] }) {
  return <Suspense><Inner products={products} /></Suspense>;
}
