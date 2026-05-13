import {
  BadRequestException,
  Body,
  Controller,
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
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { AdminOnly, RoleGuard } from "../auth/role.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

// ── DTOs ──────────────────────────────────────────────────────────────────

class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(["LOW", "MEDIUM", "HIGH", "URGENT"])
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

class AddMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean; // ignored for non-admin authors
}

class UpdateTicketDto {
  @IsOptional()
  @IsIn(["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"])
  status?: "OPEN" | "IN_PROGRESS" | "WAITING_USER" | "RESOLVED" | "CLOSED";

  @IsOptional()
  @IsIn(["LOW", "MEDIUM", "HIGH", "URGENT"])
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

// ── User-facing ───────────────────────────────────────────────────────────

@Controller("support/tickets")
@UseGuards(AuthGuard)
class SupportTicketsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateTicketDto) {
    return this.prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject: body.subject.trim(),
        category: body.category?.trim() || null,
        priority: body.priority ?? "MEDIUM",
        messages: {
          create: {
            authorId: user.id,
            authorRole: "user",
            body: body.body.trim(),
          },
        },
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  @Get("mine")
  list(@CurrentUser() user: CurrentUserType, @Query("status") status?: string) {
    const where: Prisma.SupportTicketWhereInput = { userId: user.id };
    if (status) where.status = status as Prisma.SupportTicketWhereInput["status"];
    return this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: { _count: { select: { messages: true } } },
    });
  }

  @Get(":id")
  async detail(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId: user.id },
      include: {
        messages: {
          where: { internal: false },
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, email: true, displayName: true, role: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException("Ticket not found");
    return ticket;
  }

  @Post(":id/messages")
  async addMessage(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: AddMessageDto,
  ) {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, userId: user.id } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    if (ticket.status === "CLOSED") throw new BadRequestException("Ticket is closed.");

    const [msg] = await this.prisma.$transaction([
      this.prisma.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: user.id,
          authorRole: "user",
          body: body.body.trim(),
          internal: false, // user can never create internal notes
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: {
          status: ticket.status === "WAITING_USER" ? "OPEN" : ticket.status,
          updatedAt: new Date(),
        },
      }),
    ]);
    return msg;
  }
}

// ── Admin-facing ──────────────────────────────────────────────────────────

@Controller("admin/tickets")
@UseGuards(AuthGuard, RoleGuard)
@AdminOnly()
class AdminSupportTicketsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("priority") priority?: string,
    @Query("assignedTo") assignedTo?: string,
    @Query("q") q?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "25",
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(5, parseInt(pageSize, 10) || 25));

    const where: Prisma.SupportTicketWhereInput = {};
    if (status) where.status = status as Prisma.SupportTicketWhereInput["status"];
    if (priority) where.priority = priority as Prisma.SupportTicketWhereInput["priority"];
    if (assignedTo) where.assignedTo = assignedTo;
    if (q && q.trim()) {
      where.OR = [
        { subject: { contains: q.trim(), mode: "insensitive" } },
        { user: { email: { contains: q.trim(), mode: "insensitive" } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [
          { status: "asc" },
          { priority: "desc" },
          { updatedAt: "desc" },
        ],
        skip: (pageNum - 1) * size,
        take: size,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { items, total, page: pageNum, pageSize: size, pages: Math.ceil(total / size) };
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, displayName: true, role: true, riskScore: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, email: true, role: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException("Ticket not found");
    return ticket;
  }

  @Patch(":id")
  async update(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateTicketDto,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException("Ticket not found");

    const updates: Prisma.SupportTicketUpdateInput = {};
    if (body.status) {
      updates.status = body.status;
      if (body.status === "CLOSED" || body.status === "RESOLVED") {
        updates.closedAt = new Date();
      }
    }
    if (body.priority) updates.priority = body.priority;
    if (body.assignedTo !== undefined) updates.assignedTo = body.assignedTo || null;
    if (body.internalNotes !== undefined) updates.internalNotes = body.internalNotes;

    await this.prisma.securityAuditLog.create({
      data: {
        userId: admin.id,
        action: "admin.ticket_update",
        metadataJson: { ticketId: id, changes: body } as unknown as Prisma.InputJsonObject,
      },
    });

    return this.prisma.supportTicket.update({ where: { id }, data: updates });
  }

  @Post(":id/messages")
  async reply(
    @CurrentUser() admin: CurrentUserType,
    @Param("id") id: string,
    @Body() body: AddMessageDto,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    if (ticket.status === "CLOSED" && !body.internal) {
      throw new ForbiddenException("Ticket is closed.");
    }

    const internal = body.internal === true;

    const [msg] = await this.prisma.$transaction([
      this.prisma.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: admin.id,
          authorRole: "admin",
          body: body.body.trim(),
          internal,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: {
          status: internal
            ? ticket.status
            : ticket.status === "OPEN" || ticket.status === "IN_PROGRESS"
              ? "WAITING_USER"
              : ticket.status,
          updatedAt: new Date(),
        },
      }),
    ]);
    return msg;
  }
}

// ── Module ────────────────────────────────────────────────────────────────

@Module({ controllers: [SupportTicketsController, AdminSupportTicketsController] })
export class SupportModule {}
