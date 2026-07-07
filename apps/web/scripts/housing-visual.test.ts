import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "playwright";

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CheckResult = {
  baseUrl: string;
  artifactsDir: string;
  desktop: {
    occupiedCell: Box;
    occupiedRow: Box;
    bedLabel: Box;
    emptyCell?: Box;
  };
  mobile: {
    occupiedCell: Box;
    occupiedRow: Box;
    documentWidth: number;
    viewportWidth: number;
    hasHorizontalOverflow: boolean;
  };
  collapse: {
    block: string;
    bodyCountAfterCollapse: number;
    bodyCountAfterReload: number;
    expandedAfterReload: boolean;
  };
};

const baseUrl = (process.env.HOUSING_VISUAL_BASE_URL || "http://127.0.0.1:8095").replace(/\/$/, "");
const login = process.env.HOUSING_VISUAL_LOGIN || "outsourcer";
const password = process.env.HOUSING_VISUAL_PASSWORD || "admin";
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const artifactsDir = resolve(
  process.env.HOUSING_VISUAL_ARTIFACTS_DIR || resolve(repoRoot, "docs/visual-regression/artifacts/housing")
);

function assertCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function requiredBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  assertCheck(box, `${label}: element is not visible or has no bounding box`);
  return box;
}

function compactBox(box: Box): Box {
  return {
    x: Math.round(box.x * 100) / 100,
    y: Math.round(box.y * 100) / 100,
    width: Math.round(box.width * 100) / 100,
    height: Math.round(box.height * 100) / 100
  };
}

async function loginToApp(page: Page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const continueButton = page.getByRole("button", { name: "Продолжить" });
  if (await continueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await continueButton.click();
  }

  const loginInput = page.locator("label", { hasText: "Логин" }).locator("input");
  if (await loginInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await loginInput.fill(login);
    await page.locator("label", { hasText: "Пароль" }).locator("input").fill(password);
    await page.getByRole("button", { name: "Войти" }).click();
  }

  await page.getByRole("button", { name: /Проживание/ }).first().waitFor({ state: "visible", timeout: 20000 });
}

async function openHousing(page: Page, waitForCells = true) {
  await page.getByRole("button", { name: /Проживание/ }).first().click();
  await page.locator("[data-housing-block-toggle]").first().waitFor({ state: "visible", timeout: 20000 });
  if (waitForCells) await page.locator("[data-housing-cell]").first().waitFor({ state: "visible", timeout: 20000 });
}

async function ensureOccupiedCell(page: Page) {
  const occupied = page.locator('[data-housing-cell][data-occupied="true"]');
  if (await occupied.count()) return;

  const created = await page.evaluate(async () => {
    const cell = document.querySelector<HTMLElement>('[data-housing-cell][data-occupied="false"][data-room-id]:not([data-room-id=""])');
    if (!cell) return { ok: false, message: "Не найдено свободное койко-место с room_id" };

    const bootstrapResponse = await fetch("/api/v1/compat/bootstrap", { credentials: "include" });
    const bootstrap = await bootstrapResponse.json();
    if (!bootstrapResponse.ok) {
      return { ok: false, message: bootstrap.message || bootstrap.error || "bootstrap failed" };
    }

    const employee = bootstrap.employees?.find((item: { needs_housing?: number }) => item.needs_housing)
      || bootstrap.employees?.[0];
    if (!employee?.id) return { ok: false, message: "Не найден сотрудник для брони" };

    const response = await fetch("/api/v1/compat/reservations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: employee.id,
        room_id: cell.dataset.roomId,
        bed_number: Number(cell.dataset.bedNumber || 1),
        check_in: cell.dataset.day,
        check_out: cell.dataset.day,
        cost: 0,
        status: "Заехал"
      })
    });
    const data = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true }
      : { ok: false, message: data.message || data.error || `reservation failed with ${response.status}` };
  });

  assertCheck(created.ok, `Не удалось подготовить занятую ячейку: ${created.message}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openHousing(page);
  await page.locator('[data-housing-cell][data-occupied="true"]').first().waitFor({ state: "visible", timeout: 20000 });
}

async function measureHousingGrid(page: Page) {
  const occupiedCell = page.locator('[data-housing-cell][data-occupied="true"]').first();
  const occupiedRow = occupiedCell.locator("xpath=ancestor::tr");
  const bedLabel = occupiedRow.locator("[data-housing-bed-label]").first();
  const emptyCell = page.locator('[data-housing-cell][data-occupied="false"]').first();
  const emptyCellBox = await emptyCell.count()
    ? await requiredBox(emptyCell, "empty cell")
    : undefined;

  const occupiedCellBox = await requiredBox(occupiedCell, "occupied cell");
  const occupiedRowBox = await requiredBox(occupiedRow, "occupied row");
  const bedLabelBox = await requiredBox(bedLabel, "bed label");

  assertCheck(
    occupiedCellBox.y >= occupiedRowBox.y - 1 && occupiedCellBox.y < occupiedRowBox.y + occupiedRowBox.height,
    "Занятая ячейка не попала в вертикальные границы своей строки"
  );
  assertCheck(
    Math.abs(occupiedCellBox.y - bedLabelBox.y) <= 2,
    `Занятая ячейка смещена относительно строки койко-места: cell.y=${occupiedCellBox.y}, label.y=${bedLabelBox.y}`
  );
  assertCheck(
    occupiedCellBox.height <= 40,
    `Занятая ячейка раздула высоту td: ${occupiedCellBox.height}px`
  );
  assertCheck(
    Math.abs(occupiedCellBox.height - bedLabelBox.height) <= 4,
    `Занятая ячейка выше ячейки койко-места: occupied=${occupiedCellBox.height}px, label=${bedLabelBox.height}px`
  );
  if (emptyCellBox) {
    assertCheck(
      occupiedCellBox.height <= emptyCellBox.height + 4,
      `Занятая ячейка выше свободной: occupied=${occupiedCellBox.height}px, empty=${emptyCellBox.height}px`
    );
  }

  return {
    occupiedCell: compactBox(occupiedCellBox),
    occupiedRow: compactBox(occupiedRowBox),
    bedLabel: compactBox(bedLabelBox),
    emptyCell: emptyCellBox ? compactBox(emptyCellBox) : undefined
  };
}

async function checkMobile(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openHousing(page);
  await page.locator('[data-housing-cell][data-occupied="true"]').first().waitFor({ state: "visible", timeout: 20000 });

  const geometry = await measureHousingGrid(page);
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  assertCheck(!overflow.hasHorizontalOverflow, `Mobile viewport expands horizontally: ${overflow.documentWidth}px > ${overflow.viewportWidth}px`);
  return {
    occupiedCell: geometry.occupiedCell,
    occupiedRow: geometry.occupiedRow,
    ...overflow
  };
}

async function checkCollapsePersistence(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openHousing(page, false);

  const toggle = page.locator("[data-housing-block-toggle]").first();
  const block = await toggle.getAttribute("data-housing-block-toggle");
  assertCheck(block, "Не найден блок шахматки для проверки сворачивания");
  if (await toggle.getAttribute("aria-expanded") === "false") {
    await toggle.click();
    await page.locator(`[data-housing-block-body="${block}"]`).waitFor({ state: "visible", timeout: 5000 });
  }
  await toggle.click();
  await page.waitForTimeout(100);
  const bodyCountAfterCollapse = await page.locator(`[data-housing-block-body="${block}"]`).count();
  assertCheck(bodyCountAfterCollapse === 0, "Свернутый блок продолжает рендерить таблицу");

  await page.reload({ waitUntil: "domcontentloaded" });
  await openHousing(page, false);
  const restoredToggle = page.locator(`[data-housing-block-toggle="${block}"]`).first();
  const expandedAfterReload = await restoredToggle.getAttribute("aria-expanded") === "true";
  const bodyCountAfterReload = await page.locator(`[data-housing-block-body="${block}"]`).count();
  assertCheck(!expandedAfterReload, "Свернутый блок раскрылся после reload");
  assertCheck(bodyCountAfterReload === 0, "После reload свернутый блок снова рендерит таблицу");

  return { block, bodyCountAfterCollapse, bodyCountAfterReload, expandedAfterReload };
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (process.platform === "darwin") {
      try {
        return await chromium.launch({ channel: "chrome" });
      } catch {
        // Keep the original Playwright error below; it usually contains the browser install hint.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\nУстановите браузер для проверки: npx playwright install chromium`);
  }
}

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await loginToApp(page);
    await openHousing(page);
    await ensureOccupiedCell(page);

    const desktop = await measureHousingGrid(page);
    await page.screenshot({ path: resolve(artifactsDir, "housing-desktop.png"), fullPage: true });

    const mobile = await checkMobile(page);
    await page.screenshot({ path: resolve(artifactsDir, "housing-mobile.png"), fullPage: true });

    const collapse = await checkCollapsePersistence(page);
    const result: CheckResult = { baseUrl, artifactsDir, desktop, mobile, collapse };
    await writeFile(resolve(artifactsDir, "housing-visual-result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
