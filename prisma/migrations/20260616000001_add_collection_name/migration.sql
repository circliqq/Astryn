-- AlterTable: add name column to Collection if missing (safe, idempotent)
ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '';
