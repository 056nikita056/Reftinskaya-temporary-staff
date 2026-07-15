CREATE TABLE "employee_statuses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "employee_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "country" VARCHAR(120),
    "age" INTEGER,
    "employee_statuses_id" UUID,
    "phone" VARCHAR(32),
    "email" VARCHAR(255),
    "birth_date" DATE,
    "passport_no" VARCHAR(120),
    "passport_issued" TEXT,
    "registration" TEXT,
    "needs_housing" BOOLEAN NOT NULL DEFAULT false,
    "needs_registration" BOOLEAN NOT NULL DEFAULT false,
    "driver_categories" VARCHAR(160),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dormitories" (
    "id" UUID NOT NULL,
    "factory_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dormitories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "room_number" VARCHAR(50) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rooms_dormitories" (
    "id" UUID NOT NULL,
    "dormitories_id" UUID NOT NULL,
    "rooms_id" UUID NOT NULL,

    CONSTRAINT "rooms_dormitories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_price_list" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "cost" DECIMAL(12,2),
    "date_applyed" DATE,

    CONSTRAINT "room_price_list_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "beds" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "bed_number" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "housing_reservation_statuses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "is_final" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "housing_reservation_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "housing_reservations" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "status_id" UUID,
    "planned_check_in_date" DATE NOT NULL,
    "planned_check_out_date" DATE NOT NULL,

    CONSTRAINT "housing_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "housing_fact_statuses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "is_final" BOOLEAN,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "housing_fact_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "housing_fact" (
    "id" UUID NOT NULL,
    "employee_id" UUID,
    "bed_id" UUID,
    "actual_check_in_date" DATE,
    "actual_check_out_date" DATE,
    "status_id" UUID,
    "housing_reservation_id" UUID,

    CONSTRAINT "housing_fact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employees_employee_statuses_id_idx" ON "employees"("employee_statuses_id");
CREATE INDEX "dormitories_factory_id_idx" ON "dormitories"("factory_id");
CREATE UNIQUE INDEX "rooms_dormitories_dormitories_id_rooms_id_key" ON "rooms_dormitories"("dormitories_id", "rooms_id");
CREATE INDEX "rooms_dormitories_rooms_id_idx" ON "rooms_dormitories"("rooms_id");
CREATE INDEX "room_price_list_room_id_idx" ON "room_price_list"("room_id");
CREATE INDEX "room_price_list_date_applyed_idx" ON "room_price_list"("date_applyed");
CREATE INDEX "beds_room_id_idx" ON "beds"("room_id");
CREATE INDEX "housing_reservations_employee_id_idx" ON "housing_reservations"("employee_id");
CREATE INDEX "housing_reservations_bed_id_idx" ON "housing_reservations"("bed_id");
CREATE INDEX "housing_reservations_status_id_idx" ON "housing_reservations"("status_id");
CREATE INDEX "housing_reservations_planned_check_in_date_planned_check_out_date_idx" ON "housing_reservations"("planned_check_in_date", "planned_check_out_date");
CREATE INDEX "housing_fact_employee_id_idx" ON "housing_fact"("employee_id");
CREATE INDEX "housing_fact_bed_id_idx" ON "housing_fact"("bed_id");
CREATE INDEX "housing_fact_status_id_idx" ON "housing_fact"("status_id");
CREATE INDEX "housing_fact_housing_reservation_id_idx" ON "housing_fact"("housing_reservation_id");

ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_statuses_id_fkey" FOREIGN KEY ("employee_statuses_id") REFERENCES "employee_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dormitories" ADD CONSTRAINT "dormitories_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rooms_dormitories" ADD CONSTRAINT "rooms_dormitories_dormitories_id_fkey" FOREIGN KEY ("dormitories_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms_dormitories" ADD CONSTRAINT "rooms_dormitories_rooms_id_fkey" FOREIGN KEY ("rooms_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_price_list" ADD CONSTRAINT "room_price_list_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "beds" ADD CONSTRAINT "beds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "housing_reservations" ADD CONSTRAINT "housing_reservations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "housing_reservations" ADD CONSTRAINT "housing_reservations_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "housing_reservations" ADD CONSTRAINT "housing_reservations_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "housing_reservation_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "housing_fact" ADD CONSTRAINT "housing_fact_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "housing_fact" ADD CONSTRAINT "housing_fact_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "housing_fact" ADD CONSTRAINT "housing_fact_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "housing_fact_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "housing_fact" ADD CONSTRAINT "housing_fact_housing_reservation_id_fkey" FOREIGN KEY ("housing_reservation_id") REFERENCES "housing_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
