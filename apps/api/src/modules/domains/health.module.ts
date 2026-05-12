import { Controller, Get, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getSchedulerReadiness } from "./scheduler-readiness.js";

@Controller("health")
class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  health() {
    return { ok: true, service: "mint-copilot-api" };
  }

  @Get("scheduler")
  async scheduler() {
    return getSchedulerReadiness(this.config);
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
