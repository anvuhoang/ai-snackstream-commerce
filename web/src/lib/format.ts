const vnd = new Intl.NumberFormat("vi-VN");
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

/** 39000 -> "39.000đ". Money is always a whole number of dong. */
export const formatVnd = (amount: number) => `${vnd.format(amount)}đ`;

/** Percentage off, e.g. price 39000 against a 49000 "was" price -> 20. */
export const discountPercent = (price: number, compareAt: number) => Math.round((1 - price / compareAt) * 100);

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
