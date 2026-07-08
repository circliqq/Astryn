import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, WalletStatus } from "@prisma/client";
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptPrivateKey } from "@mint-copilot/wallet-crypto";
import { getBalance } from "@mint-copilot/blockchain";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

class ImportWalletDto {
  @IsString()
  name!: string;

  @IsString()
  privateKey!: string;

  @IsIn(["base", "ethereum", "robinhood"])
  network!: "base" | "ethereum" | "robinhood";
}

class BulkImportWalletDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportWalletDto)
  wallets!: ImportWalletDto[];
}

class CreateWalletDto {
  @IsString()
  name!: string;

  @IsIn(["base", "ethereum", "robinhood"])
  network!: "base" | "ethereum" | "robinhood";
}

class UpdateWalletDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["base", "ethereum", "robinhood"])
  network?: "base" | "ethereum" | "robinhood";
}

const networkMap = {
  base: "BASE",
  ethereum: "ETHEREUM"
} as const;

function normalizePrivateKey(privateKey: string): `0x${string}` {
  const trimmed = privateKey.trim().replace(/\s+/g, "");
  const normalized = /^0x/i.test(trimmed) ? `0x${trimmed.slice(2)}` : `0x${trimmed}`;

  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new BadRequestException("Private key must be 64 hex characters, with or without 0x.");
  }

  return normalized as `0x${string}`;
}

function isUniqueConstraintError(error: unknown): error is { code: "P2002" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const safeWalletSelect = {
  id: true,
  name: true,
  address: true,
  network: true,
  status: true,
  lastBalanceWei: true,
  lastNonce: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.WalletSelect;

type SafeWallet = Prisma.WalletGetPayload<{ select: typeof safeWalletSelect }>;

@Controller("wallets")
@UseGuards(AuthGuard)
class WalletsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  private rpcUrlForNetwork(network: SafeWallet["network"]) {
    return network === "BASE"
      ? this.config.getOrThrow<string>("BASE_RPC_PRIMARY")
      : network === "ROBINHOOD"
        ? this.config.getOrThrow<string>("ROBINHOOD_RPC_PRIMARY")
        : this.config.getOrThrow<string>("ETH_RPC_PRIMARY");
  }

  private chainNameForNetwork(network: SafeWallet["network"]) {
    return network === "BASE" ? "base" : network === "ROBINHOOD" ? "robinhood" : "ethereum";
  }

  private needsBalanceRefresh(wallet: SafeWallet) {
    return wallet.lastBalanceWei == null || wallet.lastBalanceWei === "0";
  }

  private async refreshWalletBalance(wallet: SafeWallet): Promise<SafeWallet> {
    if (!this.needsBalanceRefresh(wallet)) return wallet;

    try {
      const balanceWei = await getBalance(
        { chainName: this.chainNameForNetwork(wallet.network), rpcUrl: this.rpcUrlForNetwork(wallet.network) },
        wallet.address as `0x${string}`
      );
      const nextBalance = balanceWei.toString();

      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { lastBalanceWei: nextBalance }
      });

      return { ...wallet, lastBalanceWei: nextBalance };
    } catch {
      return wallet;
    }
  }

  @Post("import")
  async importWallet(@CurrentUser() user: CurrentUserType, @Body() body: ImportWalletDto) {
    const name = body.name.trim();
    if (!name) throw new BadRequestException("Wallet name is required.");

    const privateKey = normalizePrivateKey(body.privateKey);
    let account: ReturnType<typeof privateKeyToAccount>;

    try {
      account = privateKeyToAccount(privateKey);
    } catch {
      throw new BadRequestException("Private key is not a valid Ethereum wallet key.");
    }

    const network = networkMap[body.network];
    const existingWallet = await this.prisma.wallet.findFirst({
      where: { userId: user.id, address: account.address, network },
      select: { id: true }
    });

    if (existingWallet) {
      throw new BadRequestException("This wallet is already imported for that network.");
    }

    const encrypted = await encryptPrivateKey(privateKey, {
      masterKey: this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY")
    });

    try {
      return await this.prisma.wallet.create({
        data: {
          userId: user.id,
          name,
          address: account.address,
          network,
          ...encrypted
        },
        select: safeWalletSelect
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("This wallet is already imported for that network.");
      }
      throw error;
    }
  }

  @Post("bulk-import")
  async bulkImport(@CurrentUser() user: CurrentUserType, @Body() body: BulkImportWalletDto) {
    const created = [];
    for (const wallet of body.wallets) {
      created.push(await this.importWallet(user, wallet));
    }
    return { count: created.length, wallets: created };
  }

  @Post("create")
  async createWallet(@CurrentUser() user: CurrentUserType, @Body() body: CreateWalletDto) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const encrypted = await encryptPrivateKey(privateKey, {
      masterKey: this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY")
    });
    return this.prisma.wallet.create({
      data: {
        userId: user.id,
        name: body.name,
        address: account.address,
        network: networkMap[body.network],
        ...encrypted
      },
      select: safeWalletSelect
    });
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserType, @Query("search") search?: string, @Query("status") status?: WalletStatus) {
    const where: Prisma.WalletWhereInput = {
      userId: user.id,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } }
            ]
          }
        : {})
    };
    const wallets = await this.prisma.wallet.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: safeWalletSelect
    });

    return Promise.all(wallets.map((wallet) => this.refreshWalletBalance(wallet)));
  }

  @Get(":id")
  get(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.prisma.wallet.findFirstOrThrow({ where: { id, userId: user.id }, select: safeWalletSelect });
  }

  @Get(":id/balance")
  async balance(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const wallet = await this.prisma.wallet.findFirstOrThrow({ where: { id, userId: user.id } });
    const rpcUrl =
      wallet.network === "BASE"
        ? this.config.getOrThrow<string>("BASE_RPC_PRIMARY")
        : this.config.getOrThrow<string>("ETH_RPC_PRIMARY");
    const balanceWei = await getBalance(
      { chainName: wallet.network === "BASE" ? "base" : wallet.network === "ROBINHOOD" ? "robinhood" : "ethereum", rpcUrl },
      wallet.address as `0x${string}`
    );
    await this.prisma.wallet.update({ where: { id }, data: { lastBalanceWei: balanceWei.toString() } });
    return { balanceWei: balanceWei.toString() };
  }

  @Patch(":id")
  async update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() body: UpdateWalletDto) {
    const data: Prisma.WalletUpdateInput = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException("Wallet name is required.");
      data.name = name;
    }

    if (body.network !== undefined) {
      data.network = networkMap[body.network];
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Nothing to update.");
    }

    const wallet = await this.prisma.wallet.findFirstOrThrow({
      where: { id, userId: user.id },
      select: { id: true }
    });

    return this.prisma.wallet.update({
      where: { id: wallet.id },
      data,
      select: safeWalletSelect
    });
  }

  @Delete(":id")
  delete(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.prisma.wallet.deleteMany({ where: { id, userId: user.id } });
  }
}

@Module({ controllers: [WalletsController] })
export class WalletsModule {}
