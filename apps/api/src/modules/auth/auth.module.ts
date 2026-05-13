import { BadRequestException, Body, Controller, Get, Module, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import { IsEmail, IsString, MinLength } from "class-validator";
import { CurrentUser } from "./current-user.decorator.js";
import { AuthGuard } from "./auth.guard.js";
import { RoleGuard } from "./role.guard.js";
import { PlanGuard } from "./plan.guard.js";

class EmailPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

@Controller("auth")
class AuthController {
  constructor(private readonly config: ConfigService) {}

  private client() {
    return createClient(
      this.config.getOrThrow<string>("SUPABASE_URL"),
      this.config.getOrThrow<string>("SUPABASE_ANON_KEY"),
      { auth: { persistSession: false } }
    );
  }

  private adminClient() {
    return createClient(
      this.config.getOrThrow<string>("SUPABASE_URL"),
      this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }

  @Post("register")
  async register(@Body() body: EmailPasswordDto) {
    try {
      const admin = this.adminClient();

      // Check if user already exists
      const { data: listData } = await admin.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === body.email);

      if (existing) {
        // User exists — update password and force-confirm
        const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
          password: body.password,
          email_confirm: true,
        });
        if (updateError) throw new BadRequestException(updateError.message);
      } else {
        // New user — create with auto-confirmation (no email sent)
        const { error: createError } = await admin.auth.admin.createUser({
          email: body.email,
          password: body.password,
          email_confirm: true,
        });
        if (createError) throw new BadRequestException(createError.message);
      }

      // Sign in and return session
      const { data: sessionData, error: signInError } = await this.client().auth.signInWithPassword(body);
      if (signInError) throw new BadRequestException(signInError.message);
      return sessionData;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : "Registration failed";
      throw new BadRequestException(msg);
    }
  }

  @Post("login")
  async login(@Body() body: EmailPasswordDto) {
    try {
      const { data, error } = await this.client().auth.signInWithPassword(body);
      if (error) throw new BadRequestException(error.message);
      return data;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : "Login failed";
      throw new BadRequestException(msg);
    }
  }

  @Post("logout")
  logout() {
    return { ok: true };
  }

  @Post("change-password")
  @UseGuards(AuthGuard)
  async changePassword(@CurrentUser() user: CurrentUser, @Body() body: ChangePasswordDto) {
    const { error: signInError } = await this.client().auth.signInWithPassword({
      email: user.email,
      password: body.currentPassword
    });

    if (signInError) {
      throw new BadRequestException("Current password is incorrect.");
    }

    const { error: updateError } = await this.adminClient().auth.admin.updateUserById(user.supabaseUserId, {
      password: body.newPassword
    });

    if (updateError) throw new BadRequestException(updateError.message);

    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: CurrentUser) {
    return user;
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, RoleGuard, PlanGuard],
  exports: [AuthGuard, RoleGuard, PlanGuard]
})
export class AuthModule {}
