import { withAccount } from "@/lib/accounts/server";
import { handleChecker } from "@/lib/services/checker";
export const maxDuration = 180;
export const POST = withAccount((req) => handleChecker(req));
