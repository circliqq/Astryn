import { CanActivate, ExecutionContext, ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: unknown;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException();

    const supabase = createClient(
      this.config.getOrThrow<string>("SUPABASE_URL"),
      this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.email) throw new UnauthorizedException();

    let user: Awaited<ReturnType<typeof this.prisma.user.upsert>>;
    try {
      user = await this.prisma.user.upsert({
        where: { supabaseUserId: data.user.id },
        create: { supabaseUserId: data.user.id, email: data.user.email },
        update: { email: data.user.email }
      });
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      // Surface a clear message if the DB schema hasn't been applied yet.
      if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("table")) {
        throw new InternalServerErrorException(
          "Database tables are missing. Run `pnpm prisma:push` to apply the schema, then restart the API."
        );
      }
      throw new InternalServerErrorException("Database error: " + msg);
    }

    if (user.bannedAt) {
      throw new ForbiddenException(user.banReason ?? "Account suspended.");
    }

    // Best-effort presence tracking — don't await, don't fail the request on error.
    const xff = request.headers["x-forwarded-for"];
    const ip =
      (typeof xff === "string" && xff.split(",")[0]?.trim()) ||
      request.ip ||
      request.socket?.remoteAddress ||
      null;
    void this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastSeenAt: new Date(), lastSeenIp: ip ?? undefined },
      })
      .catch(() => undefined);

    // Cast to any so this compiles before/after `prisma generate` adds the new fields.
    // After running `pnpm prisma:push && pnpm prisma:generate` these will be typed correctly.
    const userAny = user as Record<string, unknown>;
    const planExpiresAt = (userAny["planExpiresAt"] as Date | null) ?? null;
    const rawPlan = (userAny["plan"] as string | undefined) ?? "FREE";
    const effectivePlan = planExpiresAt && planExpiresAt < new Date() ? "FREE" : (rawPlan as "FREE" | "PRO" | "ELITE");

    request.user = {
      id: user.id,
      supabaseUserId: user.supabaseUserId,
      email: user.email,
      role: user.role,
      plan: effectivePlan,
      planExpiresAt,
    };
    return true;
  }
}
