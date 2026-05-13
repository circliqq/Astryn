import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type SubscriptionPlan = "FREE" | "PRO" | "ELITE";

/** Numeric rank — FREE < PRO < ELITE */
export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  FREE:  0,
  PRO:   1,
  ELITE: 2,
};

export interface CurrentUser {
  id: string;
  supabaseUserId: string;
  email: string;
  role: string;
  plan: SubscriptionPlan;
  planExpiresAt: Date | null;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser => {
  const request = ctx.switchToHttp().getRequest<{ user?: CurrentUser }>();
  if (!request.user) throw new Error("CurrentUser decorator used without AuthGuard.");
  return request.user;
});
