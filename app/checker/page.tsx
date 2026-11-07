import { accountsEnabled } from "@/lib/accounts/context";
import { pageAccount } from "@/lib/accounts/server";
import { redirect } from "next/navigation";
import Checker from "./Checker";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (accountsEnabled() && !(await pageAccount())) redirect("/login");
  return <Checker />;
}
