import type { Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";

export async function processFunding(job: Job<{ fundingPlanId: string }>, prisma: PrismaClient) {
  return prisma.fundingPlan.update({
    where: { id: job.data.fundingPlanId },
    data: { status: "ready_for_manual_review" },
    include: { items: true }
  });
}
