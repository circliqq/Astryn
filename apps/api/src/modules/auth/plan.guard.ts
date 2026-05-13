import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type SubscriptionPlan, PLAN_RANK } from "./current-user.decorator.js";

export const PLAN_KEY = "minPlan";

/**
 * Restricts a controller/handler to users whose effective plan meets or exceeds `minPlan`.
 * Must be paired with `AuthGuard` so that `request.user` is populated.
 *
 * Plans in order: FREE → PRO → ELITE
 *
 * @example
 *   @UseGuards(AuthGuard, PlanGuard)
 *   @RequirePlan("pro")
 *   @Controller("sniper")
 */
export const RequirePlan = (minPlan: "free" | "pro" | "elite") =>
  SetMetadata(PLAN_KEY, minPlan.toUpperCase() as SubscriptionPlan);

/** Convenience: PRO or above. */
export const ProOrAbove = () => RequirePlan("pro");

/** Convenience: ELITE only. */
export const EliteOnly = () => RequirePlan("elite");

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const minPlan = this.reflector.getAllAndOverride<SubscriptionPlan | undefined>(PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No plan restriction on this route → allow through.
    if (!minPlan) return true;

    const request = context.switchToHttp().getRequest<{ user?: { plan?: SubscriptionPlan; role?: string } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    // Admins bypass plan restrictions.
    if (user.role === "admin") return true;

    const userRank = PLAN_RANK[user.plan ?? "FREE"];
    const required = PLAN_RANK[minPlan];

    if (userRank < required) {
      throw new ForbiddenException(
        `This feature requires a ${minPlan} plan or above. Please upgrade your subscription.`
      );
    }
    return true;
  }
}
