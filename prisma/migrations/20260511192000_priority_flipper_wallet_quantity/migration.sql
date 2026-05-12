ALTER TABLE "MintTask"
ADD COLUMN "priorityMintingJson" JSONB,
ADD COLUMN "instantFlipperJson" JSONB;

ALTER TABLE "MintTaskWallet"
ADD COLUMN "mintQuantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "priorityMint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priorityRank" INTEGER;
