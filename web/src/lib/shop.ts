import type { components } from "@/lib/api/schema";

// Cart and order types come straight from the API contract, so they cannot drift from the backend.
type Schemas = components["schemas"];
export type CartOut = Schemas["CartOut"];
export type CartLine = Schemas["CartLine"];
export type ShopConfig = Schemas["ShopConfig"];
export type CheckoutIn = Schemas["CheckoutIn"];
export type CheckoutOut = Schemas["CheckoutOut"];
export type OrderOut = Schemas["OrderOut"];
export type AdminOrder = Schemas["AdminOrder"];
export type AdminOrderRow = Schemas["AdminOrderRow"];
export type OrderStatus = OrderOut["status"];
export type PaymentMethod = OrderOut["paymentMethod"];
export type PaymentStatus = OrderOut["payments"][number]["status"];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Mới đặt",
  confirmed: "Đã xác nhận",
  shipping: "Đang giao",
  completed: "Đã nhận",
  cancelled: "Đã hủy",
};

/** The steps a customer sees, in order. A cancelled order leaves this line. */
export const ORDER_STEPS: OrderStatus[] = ["new", "confirmed", "shipping", "completed"];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: "Thanh toán khi nhận hàng (COD)",
  vnpay: "VNPay (sandbox)",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Chưa thanh toán",
  paid: "Đã thanh toán",
  failed: "Thanh toán thất bại",
  expired: "Hết hạn thanh toán",
};

/** What a back-office button says for the step it performs. */
export const ORDER_ACTION_LABEL: Record<OrderStatus, string> = {
  new: "Đặt lại",
  confirmed: "Xác nhận đơn",
  shipping: "Bắt đầu giao",
  completed: "Hoàn tất",
  cancelled: "Hủy đơn",
};
