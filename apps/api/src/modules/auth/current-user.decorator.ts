import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface CurrentUser {
  id: string;
  supabaseUserId: string;
  email: string;
  role: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser => {
  const request = ctx.switchToHttp().getRequest<{ user?: CurrentUser }>();
  if (!request.user) throw new Error("CurrentUser decorator used without AuthGuard.");
  return request.user;
});
