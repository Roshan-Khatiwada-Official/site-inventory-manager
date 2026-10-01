-- CreateTable
CREATE TABLE "inventory_logs" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ok" BOOLEAN,
    "note" TEXT NOT NULL DEFAULT '',
    "at" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "editedAt" TEXT,
    "editedBy" TEXT,

    CONSTRAINT "inventory_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
