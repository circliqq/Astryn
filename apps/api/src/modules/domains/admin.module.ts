import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { type SubscriptionPlan } from "../auth/current-user.decorator.js";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { AdminOnly, RoleGuard } from "../auth/role.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysAgoUtc(days: number): Date {
  const now = startOfUtcDay(new Date());
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// ── 1. Overview ───────────────────────────────────────────────────────────

@Controller("admin")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminOverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      users,
      newUsers24h,
      bannedUsers,
      wallets,
      tasks,
      tasksRunning,
      rpcEndpoints,
      rpcOffline,
      openTickets,
      openFraudFlags,
      activeUsers7d,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.user.count({ where: { bannedAt: { not: null } } }),
      this.prisma.wallet.count(),
      this.prisma.mintTask.count(),
      this.prisma.mintTask.count({ where: { status: "RUNNING" } }),
      this.prisma.rpcEndpoint.count(),
      this.prisma.rpcEndpoint.count({ where: { enabled: false } }),
      this.prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_USER"] } } }),
      this.prisma.fraudFlag.count({ where: { status: "OPEN" } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since7d } } }),
    ]);

    return {
      users: { total: users, new24h: newUsers24h, banned: bannedUsers, active7d: activeUsers7d },
      wallets: { total: wallets },
      tasks: { total: tasks, running: tasksRunning },
      rpc: { total: rpcEndpoints, disabled: rpcOffline },
      support: { open: openTickets },
      fraud: { open: openFraudFlags },
    };
  }
}

// ── 2. User Management ────────────────────────────────────────────────────

class UpdateUserRoleDto {
  @IsIn(["user", "admin", "support"])
  role!: "user" | "admin" | "support";
}

class UpdateUserPlanDto {
  @IsIn(["FREE", "PRO", "ELITE"])
  plan!: SubscriptionPlan;

  /** ISO date — leave blank for a plan that never expires. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

class BanUserDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string; // ISO date
}

@Controller("admin/users")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query("q") q?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "25",
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(5, parseInt(pageSize, 10) || 25));

    const where: Prisma.UserWhereInput = {};
    if (q && q.trim()) {
      where.OR = [
        { email: { contains: q.trim(), mode: "insensitive" } },
        { displayName: { contains: q.trim(), mode: "insensitive" } },
        { id: q.trim() },
      ];
    }
    if (role) where.role = role;
    if (status === "banned") where.bannedAt = { not: null };
    if (status === "active") where.bannedAt = null;

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * size,
        take: size,
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          bannedAt: true,
          banReason: true,
          lastSeenAt: true,
          lastSeenIp: true,
          riskScore: true,
          createdAt: true,
          _count: { select: { wallets: true, mintTasks: true, supportTickets: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page: pageNum, pageSize: size, pages: Math.ceil(total / size) };
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            wallets: true,
            mintTasks: true,
            sniperTasks: true,
            sessions: true,
            supportTickets: true,
            fraudFlags: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException("User not found");

    const [sessions, recentAudit, recentBans, openFraud] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
      }),
      this.prisma.securityAuditLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.userBan.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.fraudFlag.findMany({
        where: { userId: id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return { user, sessions, recentAudit, recentBans, openFraud };
  }

  @Patch(":id/role")
  async updateRole(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateUserRoleDto,
  ) {
    if (id === admin.id && body.role !== "admin") {
      throw new ForbiddenException("Admins cannot demote themselves.");
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, role: true },
    });
    await this.prisma.securityAuditLog.create({
      data: {
        userId: admin.id,
        action: "admin.role_change",
        metadataJson: { targetUserId: id, newRole: body.role } as Prisma.InputJsonObject,
      },
    });
    return user;
  }

  @Patch(":id/plan")
  async updatePlan(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateUserPlanDto,
  ) {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (this.prisma.user.update as any)({
      where: { id },
      data: { plan: body.plan, planExpiresAt: expiresAt },
      select: { id: true, email: true, plan: true, planExpiresAt: true },
    }) as { id: string; email: string; plan: string; planExpiresAt: Date | null };
    await this.prisma.securityAuditLog.create({
      data: {
        userId: admin.id,
        action: "admin.plan_change",
        metadataJson: { targetUserId: id, newPlan: body.plan, expiresAt: body.expiresAt ?? null } as Prisma.InputJsonObject,
      },
    });
    return user;
  }

  @Post(":id/ban")
  async ban(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: BanUserDto,
  ) {
    if (id === admin.id) throw new ForbiddenException("Cannot ban yourself.");
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && isNaN(expiresAt.getTime())) {
      throw new BadRequestException("Invalid expiresAt date.");
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { bannedAt: new Date(), banReason: body.reason },
        select: { id: true, email: true, bannedAt: true, banReason: true },
      }),
      this.prisma.userBan.create({
        data: {
          userId: id,
          adminId: admin.id,
          reason: body.reason,
          expiresAt,
          active: true,
        },
      }),
      this.prisma.session.deleteMany({ where: { userId: id } }),
      this.prisma.securityAuditLog.create({
        data: {
          userId: admin.id,
          action: "admin.user_banned",
          metadataJson: { targetUserId: id, reason: body.reason } as Prisma.InputJsonObject,
        },
      }),
    ]);
    return updated;
  }

  @Post(":id/unban")
  async unban(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: { note?: string },
  ) {
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { bannedAt: null, banReason: null },
        select: { id: true, email: true, bannedAt: true },
      }),
      this.prisma.userBan.updateMany({
        where: { userId: id, active: true },
        data: { active: false, liftedAt: new Date(), liftedNote: body?.note ?? null },
      }),
      this.prisma.securityAuditLog.create({
        data: {
          userId: admin.id,
          action: "admin.user_unbanned",
          metadataJson: { targetUserId: id, note: body?.note } as Prisma.InputJsonObject,
        },
      }),
    ]);
    return updated;
  }

  @Post(":id/force-logout")
  async forceLogout(@CurrentUser() admin: CurrentUserType, @Param("id") id: string) {
    const { count } = await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.prisma.securityAuditLog.create({
      data: {
        userId: admin.id,
        action: "admin.force_logout",
        metadataJson: { targetUserId: id, sessionsRevoked: count } as Prisma.InputJsonObject,
      },
    });
    return { ok: true, sessionsRevoked: count };
  }

  @Delete(":id")
  async remove(@CurrentUser() admin: CurrentUserType, @Param("id") id: string) {
    if (id === admin.id) throw new ForbiddenException("Cannot delete your own account.");
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException("User not found");
    await this.prisma.securityAuditLog.create({
      data: {
        userId: admin.id,
        action: "admin.user_deleted",
        metadataJson: { targetUserId: id, targetEmail: user.email } as Prisma.InputJsonObject,
      },
    });
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}

// ── 3. Audit Logs ─────────────────────────────────────────────────────────

@Controller("admin/audit-logs")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminAuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query("userId") userId?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "50",
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(200, Math.max(10, parseInt(pageSize, 10) || 50));

    const where: Prisma.SecurityAuditLogWhereInput = {};
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: "insensitive" };
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      this.prisma.securityAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * size,
        take: size,
        include: { user: { select: { id: true, email: true } } },
      }),
      this.prisma.securityAuditLog.count({ where }),
    ]);

    return { items, total, page: pageNum, pageSize: size, pages: Math.ceil(total / size) };
  }
}

// ── 4. System Health ──────────────────────────────────────────────────────

@Controller("admin/system")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminSystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("health")
  async health() {
    const since5m = new Date(Date.now() - 5 * 60 * 1000);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [rpcEndpoints, recentHealthLogs, pendingTasks, runningTasks, failedTasks24h, pendingBundles, pendingSwaps, pendingConsolidations] =
      await Promise.all([
        this.prisma.rpcEndpoint.findMany({
          orderBy: [{ network: "asc" }, { priority: "asc" }],
          take: 100,
        }),
        this.prisma.rpcHealthLog.findMany({
          where: { checkedAt: { gte: since5m } },
          orderBy: { checkedAt: "desc" },
          take: 200,
        }),
        this.prisma.mintTask.count({ where: { status: "SCHEDULED" } }),
        this.prisma.mintTask.count({ where: { status: "RUNNING" } }),
        this.prisma.mintTask.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
        this.prisma.txBundle.count({ where: { status: { in: ["PENDING", "SUBMITTED"] } } }),
        this.prisma.swapOrder.count({ where: { status: "PENDING" } }),
        this.prisma.consolidationJob.count({ where: { status: { in: ["pending", "running"] } } }),
      ]);

    // Latest log per RPC endpoint
    const latestByEndpoint = new Map<string, (typeof recentHealthLogs)[number]>();
    for (const log of recentHealthLogs) {
      if (!latestByEndpoint.has(log.rpcEndpointId)) latestByEndpoint.set(log.rpcEndpointId, log);
    }

    const rpc = rpcEndpoints.map((ep) => {
      const latest = latestByEndpoint.get(ep.id);
      return {
        id: ep.id,
        name: ep.name,
        network: ep.network,
        priority: ep.priority,
        enabled: ep.enabled,
        status: latest?.status ?? "UNKNOWN",
        latencyMs: latest?.latencyMs ?? null,
        blockNumber: latest?.blockNumber ?? null,
        checkedAt: latest?.checkedAt ?? null,
      };
    });

    return {
      rpc,
      queues: {
        mintTasksScheduled: pendingTasks,
        mintTasksRunning: runningTasks,
        mintTasksFailed24h: failedTasks24h,
        bundlesPending: pendingBundles,
        swapsPending: pendingSwaps,
        consolidationsPending: pendingConsolidations,
      },
    };
  }
}

// ── 5. Usage Analytics ────────────────────────────────────────────────────

@Controller("admin/analytics")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminAnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview(@Query("days") days = "30") {
    const range = Math.min(180, Math.max(1, parseInt(days, 10) || 30));
    const since = daysAgoUtc(range);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [dau, wau, mau, newSignups, mintTasksAttempted, mintTasksCompleted, sniperRuns, topUsers] = await Promise.all([
      this.prisma.user.count({ where: { lastSeenAt: { gte: since24h } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since30d } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.mintTask.count({ where: { createdAt: { gte: since } } }),
      this.prisma.mintTask.count({ where: { status: "COMPLETED", completedAt: { gte: since } } }),
      this.prisma.sniperTask.count({ where: { createdAt: { gte: since } } }),
      this.prisma.user.findMany({
        where: { lastSeenAt: { gte: since30d } },
        orderBy: { mintTasks: { _count: "desc" } },
        take: 10,
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          _count: { select: { mintTasks: true, sniperTasks: true, wallets: true } },
        },
      }),
    ]);

    return {
      activeUsers: { dau, wau, mau },
      window: { days: range },
      activity: {
        newSignups,
        mintTasksAttempted,
        mintTasksCompleted,
        mintSuccessRate: mintTasksAttempted ? mintTasksCompleted / mintTasksAttempted : null,
        sniperRuns,
      },
      topUsers,
    };
  }

  @Get("timeseries")
  async timeseries(@Query("metric") metric = "signups", @Query("days") days = "30") {
    const range = Math.min(180, Math.max(1, parseInt(days, 10) || 30));
    const since = daysAgoUtc(range);

    // Pull raw events, then bucket by UTC day in JS (Postgres-agnostic, simple).
    const buckets = new Map<string, number>();
    const today = startOfUtcDay(new Date());
    for (let i = 0; i <= range; i++) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }

    if (metric === "signups") {
      const users = await this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      });
      for (const u of users) {
        const key = u.createdAt.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    } else if (metric === "mints_attempted") {
      const tasks = await this.prisma.mintTask.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      });
      for (const t of tasks) {
        const key = t.createdAt.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    } else if (metric === "mints_completed") {
      const tasks = await this.prisma.mintTask.findMany({
        where: { status: "COMPLETED", completedAt: { gte: since } },
        select: { completedAt: true },
      });
      for (const t of tasks) {
        if (!t.completedAt) continue;
        const key = t.completedAt.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    } else if (metric === "active_users") {
      // Approximation: use lastSeenAt deltas; for a real impl, log to UsageMetric daily.
      const users = await this.prisma.user.findMany({
        where: { lastSeenAt: { gte: since } },
        select: { lastSeenAt: true },
      });
      for (const u of users) {
        if (!u.lastSeenAt) continue;
        const key = u.lastSeenAt.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    } else {
      throw new BadRequestException(`Unknown metric: ${metric}`);
    }

    const series = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    return { metric, days: range, series };
  }
}

// ── 6. Fraud Detection ────────────────────────────────────────────────────

class FlagFraudDto {
  @IsString()
  userId!: string;

  @IsString()
  rule!: string;

  @IsIn(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
  severity!: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

  @IsOptional()
  details?: Prisma.InputJsonObject;
}

class ResolveFraudDto {
  @IsIn(["ACKNOWLEDGED", "DISMISSED", "ACTIONED"])
  status!: "ACKNOWLEDGED" | "DISMISSED" | "ACTIONED";

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller("admin/fraud")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminFraudController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "25",
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(5, parseInt(pageSize, 10) || 25));

    const where: Prisma.FraudFlagWhereInput = {};
    if (status) where.status = status as Prisma.FraudFlagWhereInput["status"];
    if (severity) where.severity = severity as Prisma.FraudFlagWhereInput["severity"];

    const [items, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        skip: (pageNum - 1) * size,
        take: size,
        include: { user: { select: { id: true, email: true, riskScore: true } } },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    return { items, total, page: pageNum, pageSize: size, pages: Math.ceil(total / size) };
  }

  @Post()
  async flag(@CurrentUser() admin: CurrentUserType, @Body() body: FlagFraudDto) {
    return this.prisma.fraudFlag.create({
      data: {
        userId: body.userId,
        rule: body.rule,
        severity: body.severity,
        detailsJson: (body.details ?? {}) as Prisma.InputJsonObject,
        createdById: admin.id,
      },
    });
  }

  @Patch(":id/resolve")
  async resolve(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: ResolveFraudDto,
  ) {
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException("Fraud flag not found");

    await this.prisma.securityAuditLog.create({
      data: {
        userId: admin.id,
        action: "admin.fraud_resolve",
        metadataJson: { flagId: id, status: body.status, note: body.note } as Prisma.InputJsonObject,
      },
    });

    return this.prisma.fraudFlag.update({
      where: { id },
      data: {
        status: body.status,
        resolvedAt: new Date(),
        resolvedNote: body.note ?? null,
      },
    });
  }

  /** Re-run fraud detection rules over recent activity. Sync, idempotent. */
  @Post("rescan")
  async rescan() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let created = 0;

    // Rule 1: multiple accounts from same IP in 24h
    const recentSessions = await this.prisma.session.findMany({
      where: { createdAt: { gte: since }, ipAddress: { not: null } },
      select: { userId: true, ipAddress: true },
    });
    const ipToUsers = new Map<string, Set<string>>();
    for (const s of recentSessions) {
      if (!s.ipAddress) continue;
      if (!ipToUsers.has(s.ipAddress)) ipToUsers.set(s.ipAddress, new Set());
      ipToUsers.get(s.ipAddress)!.add(s.userId);
    }
    for (const [ip, userIds] of ipToUsers) {
      if (userIds.size < 3) continue;
      for (const userId of userIds) {
        const existing = await this.prisma.fraudFlag.findFirst({
          where: { userId, rule: "multi_account_same_ip", status: "OPEN" },
        });
        if (existing) continue;
        await this.prisma.fraudFlag.create({
          data: {
            userId,
            rule: "multi_account_same_ip",
            severity: userIds.size >= 5 ? "HIGH" : "MEDIUM",
            detailsJson: { ip, otherUserCount: userIds.size - 1 } as Prisma.InputJsonObject,
          },
        });
        created++;
      }
    }

    // Rule 2: rapid signup (>5 accounts per IP in 1h)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentLogs = await this.prisma.securityAuditLog.findMany({
      where: { createdAt: { gte: oneHourAgo }, ipAddress: { not: null } },
      select: { ipAddress: true, userId: true },
    });
    const rapidByIp = new Map<string, Set<string>>();
    for (const l of recentLogs) {
      if (!l.ipAddress || !l.userId) continue;
      if (!rapidByIp.has(l.ipAddress)) rapidByIp.set(l.ipAddress, new Set());
      rapidByIp.get(l.ipAddress)!.add(l.userId);
    }
    for (const [ip, userIds] of rapidByIp) {
      if (userIds.size < 5) continue;
      for (const userId of userIds) {
        const existing = await this.prisma.fraudFlag.findFirst({
          where: { userId, rule: "rapid_signup", status: "OPEN" },
        });
        if (existing) continue;
        await this.prisma.fraudFlag.create({
          data: {
            userId,
            rule: "rapid_signup",
            severity: "HIGH",
            detailsJson: { ip, signupsInWindow: userIds.size } as Prisma.InputJsonObject,
          },
        });
        created++;
      }
    }

    // Rule 3: key reuse — same encryption_auth_tag across multiple users
    const dupTags = await this.prisma.wallet.groupBy({
      by: ["encryptionAuthTag"],
      _count: { encryptionAuthTag: true },
      having: { encryptionAuthTag: { _count: { gt: 1 } } },
    });
    for (const tag of dupTags) {
      const wallets = await this.prisma.wallet.findMany({
        where: { encryptionAuthTag: tag.encryptionAuthTag },
        select: { userId: true },
      });
      const userIds = new Set(wallets.map((w) => w.userId));
      if (userIds.size < 2) continue;
      for (const userId of userIds) {
        const existing = await this.prisma.fraudFlag.findFirst({
          where: { userId, rule: "key_reuse", status: "OPEN" },
        });
        if (existing) continue;
        await this.prisma.fraudFlag.create({
          data: {
            userId,
            rule: "key_reuse",
            severity: "CRITICAL",
            detailsJson: { sharedTag: tag.encryptionAuthTag.slice(0, 8) + "…", otherUsers: userIds.size - 1 } as Prisma.InputJsonObject,
          },
        });
        created++;
      }
    }

    return { ok: true, flagsCreated: created };
  }
}

// ── 7. Feature Flags ──────────────────────────────────────────────────────

class UpsertFeatureFlagDto {
  @IsString()
  key!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPct?: number;

  @IsOptional()
  value?: Prisma.InputJsonValue;
}

@Controller("admin/feature-flags")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminFeatureFlagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  }

  @Post()
  async upsert(@CurrentUser() admin: CurrentUserType, @Body() body: UpsertFeatureFlagDto) {
    return this.prisma.featureFlag.upsert({
      where: { key: body.key },
      create: {
        key: body.key,
        description: body.description ?? null,
        enabled: body.enabled ?? false,
        rolloutPct: body.rolloutPct ?? 0,
        valueJson: body.value ?? Prisma.JsonNull,
        updatedById: admin.id,
      },
      update: {
        description: body.description,
        enabled: body.enabled,
        rolloutPct: body.rolloutPct,
        valueJson: body.value ?? undefined,
        updatedById: admin.id,
      },
    });
  }

  @Delete(":key")
  async remove(@Param("key") key: string) {
    await this.prisma.featureFlag.delete({ where: { key } });
    return { ok: true };
  }
}

/** Public read-only endpoint for the frontend to fetch active flags. */
@Controller("feature-flags")
@UseGuards(AuthGuard)
class PublicFeatureFlagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("active")
  async active() {
    const flags = await this.prisma.featureFlag.findMany({
      where: { enabled: true },
      select: { key: true, rolloutPct: true, valueJson: true },
    });
    return flags;
  }
}

// ── Module ────────────────────────────────────────────────────────────────

@Module({
  controllers: [
    AdminOverviewController,
    AdminUsersController,
    AdminAuditLogsController,
    AdminSystemController,
    AdminAnalyticsController,
    AdminFraudController,
    AdminFeatureFlagsController,
    PublicFeatureFlagsController,
  ],
})
export class AdminModule {}
