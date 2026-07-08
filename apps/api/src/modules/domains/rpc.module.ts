import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsNumber, IsString, Min } from "class-validator";
import { RpcPool } from "@mint-copilot/rpc-pool";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";
import { PrismaService } from "../prisma/prisma.service.js";

class RpcEndpointDto {
  @IsString()
  name!: string;

  @IsString()
  url!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";

  @IsNumber()
  @Min(1)
  priority!: number;
}

@Controller("rpc")
@UseGuards(AuthGuard)
class RpcController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway
  ) {}

  @Get("endpoints")
  listEndpoints(@CurrentUser() user: CurrentUserType) {
    return this.prisma.rpcEndpoint.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }], enabled: true },
      select: { id: true, name: true, url: true, network: true, priority: true, enabled: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    });
  }

  @Get("health")
  async health(@CurrentUser() user: CurrentUserType) {
    const endpoints = await this.prisma.rpcEndpoint.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }], enabled: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    });
    const pool = new RpcPool(
      endpoints.map((endpoint) => ({
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        chainName: endpoint.network === "BASE" ? "base" : endpoint.network === "ROBINHOOD" ? "robinhood" : "ethereum",
        priority: endpoint.priority
      }))
    );
    const results = await pool.checkAll();

    const endpointMap = new Map(endpoints.map((e) => [e.id, e]));
    const payload = results.map((r) => ({
      endpointId: r.endpointId,
      name: endpointMap.get(r.endpointId)?.name ?? r.endpointId,
      network: endpointMap.get(r.endpointId)?.network ?? "BASE",
      priority: endpointMap.get(r.endpointId)?.priority ?? 0,
      status: r.status,
      latencyMs: r.latencyMs,
      blockNumber: r.blockNumber != null ? r.blockNumber.toString() : null,
      checkedAt: r.checkedAt
    }));
    this.events.publish("rpc.health.updated", payload);
    return payload;
  }

  @Post("endpoints")
  create(@CurrentUser() user: CurrentUserType, @Body() body: RpcEndpointDto) {
    return this.prisma.rpcEndpoint.create({ data: { ...body, userId: user.id } });
  }

  @Patch("endpoints/:id")
  async update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() body: RpcEndpointDto) {
    await this.prisma.rpcEndpoint.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.prisma.rpcEndpoint.update({
      where: { id },
      data: body
    });
  }

  @Delete("endpoints/:id")
  async remove(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.rpcEndpoint.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.prisma.rpcEndpoint.delete({ where: { id } });
  }

  @Post("endpoints/:id/test")
  async test(@Param("id") id: string) {
    const endpoint = await this.prisma.rpcEndpoint.findUniqueOrThrow({ where: { id } });
    const pool = new RpcPool([
      {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        chainName: endpoint.network === "BASE" ? "base" : endpoint.network === "ROBINHOOD" ? "robinhood" : "ethereum",
        priority: endpoint.priority
      }
    ]);
    return pool.checkEndpoint(pool.endpointsFor(endpoint.network === "BASE" ? "base" : endpoint.network === "ROBINHOOD" ? "robinhood" : "ethereum")[0]);
  }
}

@Module({ imports: [EventsModule], controllers: [RpcController] })
export class RpcModule {}
