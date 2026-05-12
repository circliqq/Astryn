import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
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
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
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

    const user = await this.prisma.user.upsert({
      where: { supabaseUserId: data.user.id },
      create: { supabaseUserId: data.user.id, email: data.user.email },
      update: { email: data.user.email }
    });

    request.user = {
      id: user.id,
      supabaseUserId: user.supabaseUserId,
      email: user.email,
      role: user.role
    };
    return true;
  }
}
