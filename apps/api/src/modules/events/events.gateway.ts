import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server } from "socket.io";

export type MintEventName =
  | "task.status.updated"
  | "task.wallet.gas.updated"
  | "task.log.created"
  | "transaction.updated"
  | "rpc.health.updated"
  | "report.generated"
  | "sniper.triggered"
  | "sniper.task.created"
  | "sniper.task.updated"
  | "bot.competition.detected"
  | "bundle.status.changed"
  | "sweep.detected";

@WebSocketGateway({ cors: true, namespace: "/events" })
export class EventsGateway {
  @WebSocketServer()
  server!: Server;

  publish(event: MintEventName, payload: unknown) {
    this.server?.emit?.(event, payload);
  }

  emitSniperTriggered(userId: string, sniperTask: unknown) {
    this.server?.emit?.("sniper.triggered", { userId, sniperTask });
  }

  emitBotCompetitionDetected(userId: string, data: unknown) {
    this.server?.emit?.("bot.competition.detected", { userId, ...((data as object) ?? {}) });
  }

  emitBundleStatusChange(userId: string, bundle: unknown) {
    this.server?.emit?.("bundle.status.changed", { userId, bundle });
  }
}
