import type { Budget, Category, Transaction, TransactionType } from "../types";

export function monthBounds(date: Date, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  return { start, end: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01` };
}

export function amountInMinorUnits(amount: number | string): number {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(String(amount).trim());
  if (!match || (!match[2] && !match[3])) throw new Error("Amount must be a decimal number.");
  const fraction = match[3] ?? "";
  let minor = BigInt(match[2] || "0") * 100n + BigInt((fraction.slice(0, 2) || "0").padEnd(2, "0"));
  if (fraction[2] && fraction[2] >= "5") minor += 1n;
  if (match[1] === "-") minor *= -1n;
  const value = Number(minor);
  if (!Number.isSafeInteger(value)) throw new Error("Amount exceeds the supported precision.");
  return value;
}

export function dateInTimezone(value: string, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function transactionsInMonth(transactions: Transaction[], monthStart: string, timezone = "UTC"): Transaction[] {
  const nextMonth = new Date(`${monthStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const end = nextMonth.toISOString().slice(0, 10);
  return transactions.filter((transaction) => {
    const date = dateInTimezone(transaction.occurred_at, timezone);
    return date >= monthStart && date < end;
  });
}

export function sumByType(transactions: Transaction[], type: TransactionType): number {
  const total = transactions
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum + amountInMinorUnits(transaction.amount), 0);
  return total / 100;
}

export function sumMoneyAmounts(amounts: (number | string)[]): number {
  return amounts.reduce<number>((sum, amount) => sum + amountInMinorUnits(amount), 0) / 100;
}

export function categorySpending(transactions: Transaction[], categories: Category[], type: TransactionType = "expense") {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== type || !transaction.category_id) continue;
    totals.set(transaction.category_id, (totals.get(transaction.category_id) ?? 0) + amountInMinorUnits(transaction.amount));
  }
  return categories.map((category) => ({
    category,
    amount: (totals.get(category.id) ?? 0) / 100,
  })).filter((entry) => entry.amount > 0).sort((a, b) => b.amount - a.amount);
}

export function budgetProgress(transactions: Transaction[], budget: Budget, categoryId?: string | null, timezone = "UTC") {
  const monthStart = budget.month_start;
  const end = monthBounds(new Date(`${monthStart}T12:00:00Z`), timezone).end;
  const spentMinor = transactions
    .filter((transaction) =>
      transaction.type === "expense" &&
      dateInTimezone(transaction.occurred_at, timezone) >= monthStart &&
      dateInTimezone(transaction.occurred_at, timezone) < end &&
      ((categoryId ?? budget.category_id) === null || transaction.category_id === (categoryId ?? budget.category_id)),
    )
    .reduce((sum, transaction) => sum + amountInMinorUnits(transaction.amount), 0);
  const spent = spentMinor / 100;
  const limitMinor = amountInMinorUnits(budget.amount);
  return { spent, remaining: (limitMinor - spentMinor) / 100, percent: limitMinor > 0 ? spentMinor / limitMinor * 100 : 0 };
}

export function formatCurrency(amount: number, currency: string, locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

export function splitAmount(amount: number | string, weights: number[]): number[] {
  if (!weights.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error("Add at least one valid split.");
  }
  const scale = 1_000_000n;
  const scaledWeights = weights.map((weight) => {
    const text = String(weight);
    if (!/^\d+(?:\.\d{0,6})?$/.test(text)) throw new Error("Enter valid split weights.");
    const [whole, fraction = ""] = text.split(".");
    return BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0") || "0");
  });
  const totalWeight = scaledWeights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight <= 0n) throw new Error("The split must add up to more than zero.");
  const totalMinor = BigInt(amountInMinorUnits(amount));
  if (totalMinor <= 0n) throw new Error("Enter an amount above zero.");
  const remainders: { index: number; value: bigint }[] = [];
  const shares = scaledWeights.map((weight, index) => {
    const weightedAmount = totalMinor * weight;
    remainders.push({ index, value: weightedAmount % totalWeight });
    return weightedAmount / totalWeight;
  });
  const remainder = Number(totalMinor - shares.reduce((sum, share) => sum + share, 0n));
  remainders.sort((a, b) => a.value === b.value ? a.index - b.index : a.value > b.value ? -1 : 1);
  for (let index = 0; index < remainder; index++) shares[remainders[index].index] += 1n;
  return shares.map((share) => Number(share) / 100);
}
