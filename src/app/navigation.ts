import {
  Activity,
  ArrowLeftRight,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  Settings,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { PageKey } from "../types";

export const navigation: { name: PageKey; icon: LucideIcon }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Transactions", icon: ArrowLeftRight },
  { name: "Budgets", icon: Wallet },
  { name: "Cash flow", icon: CalendarDays },
  { name: "Planning", icon: Target },
  { name: "Analytics", icon: Activity },
  { name: "Shared expenses", icon: Users },
  { name: "Card Vault", icon: CreditCard },
  { name: "Settings", icon: Settings },
];
