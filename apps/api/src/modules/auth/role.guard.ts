import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

export const ROLES_KEY = "roles";

/**
 * Restricts a controller/handler to users whose `role` is one of the allowed values.
 * Must be paired with `AuthGuard` so that `request.user` is populated.
 *
 * @example
 *   @UseGuards(AuthGuard, RoleGuard)
 *   @RequireRoles("admin")
 *   @Controller("admin/users")
 */
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Convenience: admin-only. */
export const AdminOnly = () => RequireRoles("admin");

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();
    if (!user.role || !required.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${required.join(" | ")}`);
    }
    return true;
  }
}
