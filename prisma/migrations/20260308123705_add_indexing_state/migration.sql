-- CreateTable
CREATE TABLE "InstalledAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "dispatchEndpoint" TEXT NOT NULL,
    "installedBy" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstalledAgent_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IndexingState" (
    "chain" TEXT NOT NULL PRIMARY KEY,
    "lastIndexedBlock" INTEGER NOT NULL DEFAULT 0,
    "indexedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "InstalledAgent_agentId_key" ON "InstalledAgent"("agentId");

-- CreateIndex
CREATE INDEX "InstalledAgent_installedBy_idx" ON "InstalledAgent"("installedBy");

-- CreateIndex
CREATE INDEX "InstalledAgent_agentId_idx" ON "InstalledAgent"("agentId");

-- CreateIndex
CREATE INDEX "AgentReview_agentId_idx" ON "AgentReview"("agentId");

-- CreateIndex
CREATE INDEX "AgentReview_userId_idx" ON "AgentReview"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentReview_agentId_userId_key" ON "AgentReview"("agentId", "userId");
