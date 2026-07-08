CREATE TABLE "compat_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "factory_id" UUID NOT NULL,
    "resource" VARCHAR(64) NOT NULL,
    "record_id" VARCHAR(128) NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compat_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "compat_records_factory_id_resource_record_id_key" ON "compat_records"("factory_id", "resource", "record_id");
CREATE INDEX "compat_records_factory_id_resource_idx" ON "compat_records"("factory_id", "resource");

ALTER TABLE "compat_records" ADD CONSTRAINT "compat_records_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
