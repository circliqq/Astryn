import { BadRequestException, Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsOptional, IsString } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

interface WhitelistInput {
  name?: string;
  format?: string;
  content?: string;
}

class BulkWhitelistCheckDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  walletIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  walletAddresses?: string[];

  @IsArray()
  lists!: WhitelistInput[];
}

@Controller("eligibility")
@UseGuards(AuthGuard)
class EligibilityController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("bulk-whitelist-check")
  async bulkWhitelistCheck(@CurrentUser() user: CurrentUserType, @Body() body: BulkWhitelistCheckDto) {
    if (!Array.isArray(body.lists) || body.lists.length === 0) {
      throw new BadRequestException("Add at least one whitelist to check.");
    }

    const savedWallets = body.walletIds?.length
      ? await this.prisma.wallet.findMany({
          where: { id: { in: body.walletIds }, userId: user.id },
          select: { id: true, name: true, address: true, network: true }
        })
      : [];

    const pastedWallets = (body.walletAddresses ?? [])
      .map((address, index) => normalizeAddress(address) ? {
        id: `manual-${index}`,
        name: `Manual ${index + 1}`,
        address: normalizeAddress(address)!,
        network: null
      } : null)
      .filter((wallet): wallet is { id: string; name: string; address: string; network: null } => wallet !== null);

    const wallets = dedupeWallets([...savedWallets, ...pastedWallets]);
    if (wallets.length === 0) {
      throw new BadRequestException("Select or paste at least one wallet address.");
    }

    const parsedLists = body.lists.map((list, index) => {
      const content = String(list?.content ?? "");
      const addresses = extractAddresses(content);
      return {
        id: `list-${index}`,
        name: String(list?.name || `Whitelist ${index + 1}`),
        format: String(list?.format || detectWhitelistFormat(content)),
        addressSet: new Set(addresses),
        walletCount: addresses.length
      };
    });

    const walletResults = wallets.map((wallet) => {
      const normalized = wallet.address.toLowerCase();
      const matches = parsedLists
        .filter((list) => list.addressSet.has(normalized))
        .map((list) => ({ listId: list.id, listName: list.name, format: list.format }));

      return {
        walletId: wallet.id,
        walletName: wallet.name,
        walletAddress: wallet.address,
        network: wallet.network,
        eligible: matches.length > 0,
        matchedWhitelists: matches
      };
    });

    return {
      checkedAt: new Date().toISOString(),
      walletCount: wallets.length,
      whitelistCount: parsedLists.length,
      eligibleWalletCount: walletResults.filter((wallet) => wallet.eligible).length,
      lists: parsedLists.map((list) => ({
        id: list.id,
        name: list.name,
        format: list.format,
        walletCount: list.walletCount,
        matchedWalletCount: walletResults.filter((wallet) =>
          wallet.matchedWhitelists.some((match) => match.listId === list.id)
        ).length
      })),
      wallets: walletResults
    };
  }
}

@Module({ controllers: [EligibilityController] })
export class EligibilityModule {}

function extractAddresses(content: string) {
  const matches = content.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  return [...new Set(matches.map((address) => address.toLowerCase()))];
}

function normalizeAddress(address: string) {
  const match = address.match(/0x[a-fA-F0-9]{40}/);
  return match?.[0] ?? null;
}

function detectWhitelistFormat(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "empty";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json / merkle proof";
  if (trimmed.includes(",")) return "csv";
  if (trimmed.includes("\n")) return "newline";
  return "address list";
}

function dedupeWallets<T extends { address: string }>(wallets: T[]) {
  const seen = new Set<string>();
  return wallets.filter((wallet) => {
    const normalized = wallet.address.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
