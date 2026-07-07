import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { BootstrapData, Dormitory, HousingPlace, Reservation, Room } from "../../api/client";
import type { BootstrapLoadMore, BootstrapMutate } from "../../domain/types";
import { dateRange, defaultEndRu, displayEmployeeName, displayReservationEmployeeName, numberValue, parseRuDate, todayRu } from "../../domain/display";
import { Input, Modal, Readonly } from "../../components/common";
import { useUiFeedback } from "../../ui/feedback";

export function Housing({ data, mutate, loadMore }: { data: BootstrapData; mutate: BootstrapMutate; loadMore: BootstrapLoadMore }) {
  const [dormId, setDormId] = useState(String(data.housingDorms[0]?.id || ""));
  const [period, setPeriod] = useState({ start: todayRu(), end: defaultEndRu() });
  const defaultReservationCost = data.settings?.defaultReservationCost ?? 30000;
  const [defaultCostDraft, setDefaultCostDraft] = useState(defaultReservationCost);
  const [editor, setEditor] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>(readCollapsedHousingBlocks);
  const [reservationEditor, setReservationEditor] = useState<{ place: HousingPlace; day: string; reservation?: Reservation } | null>(null);
  const dorm = data.housingDorms.find((item) => String(item.id) === String(dormId)) || data.housingDorms[0];
  const places = data.housingPlaces.filter((place) => !dorm || String(place.dorm_id) === String(dorm.id));
  const days = dateRange(period.start, period.end).slice(0, 31);
  const activeReservations = data.reservations.filter((reservation) => !["Выехал", "Отменено"].includes(reservation.status));
  const occupiedInDorm = activeReservations.filter((reservation) => !dorm || reservation.dorm === dorm.name).length;
  const dormBeds = dorm ? dormTotalBeds(dorm) : 0;
  const housingBlocks = useMemo(() => groupHousingPlaces(places, data.reservations, period.start, period.end), [data.reservations, period.end, period.start, places]);

  useEffect(() => {
    writeCollapsedHousingBlocks(collapsedBlocks);
  }, [collapsedBlocks]);

  useEffect(() => {
    setDefaultCostDraft(defaultReservationCost);
  }, [defaultReservationCost]);

  const toggleBlock = (blockKey: string) => {
    setCollapsedBlocks((current) => ({ ...current, [blockKey]: !current[blockKey] }));
  };

  const saveDefaultCost = async () => {
    const cost = Math.max(0, numberValue(defaultCostDraft, 0));
    setDefaultCostDraft(cost);
    await mutate("/settings", "PUT", { default_reservation_cost: cost }, "Ставка сохранена");
  };

  return (
    <div className="min-w-0 space-y-3 overflow-hidden">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-black">Шахматка проживания</p>
            <p className="text-xs font-bold text-slate-500">{dorm ? dorm.name : "Общежитие не выбрано"}</p>
          </div>
          {places[0] && (
            <button className="btn-primary h-10 gap-2 bg-orange-500 px-3 hover:bg-orange-600" onClick={() => setReservationEditor({ place: places[0], day: period.start })}>
              <Plus size={16} /> Бронь
            </button>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto_auto]">
          <label className="text-xs font-black text-slate-500">Заезд<input className="field mt-1 h-10" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} placeholder="01.04.2026" /></label>
          <label className="text-xs font-black text-slate-500">Выезд<input className="field mt-1 h-10" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} placeholder="30.04.2026" /></label>
          <label className="text-xs font-black text-slate-500">Ставка, руб./день<input className="field mt-1 h-10" min={0} type="number" value={defaultCostDraft} onChange={(e) => setDefaultCostDraft(Math.max(0, numberValue(e.target.value, 0)))} /></label>
          <button className="h-10 self-end rounded-md bg-slate-700 px-3 text-sm font-black text-white hover:bg-slate-800" onClick={saveDefaultCost}><Save size={16} className="inline" /> Сохранить ставку</button>
          {dorm && <button className="h-10 self-end rounded-md bg-slate-800 px-3 text-sm font-black text-white hover:bg-slate-900" onClick={() => setEditor(true)}><Pencil size={16} className="inline" /> Изменить</button>}
          <button className="h-10 self-end rounded-md bg-refGreen px-3 text-sm font-black text-white hover:bg-emerald-800" onClick={() => mutate("/housing-dorms", "POST", { name: `Общежитие № ${data.housingDorms.length + 1}`, room_count: 5, beds_per_room: 5 }, "Общежитие создано")}>
            <Plus size={16} className="inline" /> Общежитие
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-black">Общежития</p>
          <p className="text-xs font-bold text-slate-500">{data.housingDorms.length} объектов</p>
        </div>
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
        {data.housingDorms.map((item) => {
          const rooms = dormRooms(item);
          const beds = dormTotalBeds(item);
          const occupied = activeReservations.filter((reservation) => reservation.dorm === item.name).length;
          const selected = String(item.id) === String(dorm?.id);
          return (
            <button
              key={item.id}
              className={`min-w-[190px] rounded-md border p-3 text-left shadow-sm transition ${selected ? "border-refGreen bg-refGreen text-white" : "border-slate-200 bg-slate-50 text-refDark hover:bg-slate-100"}`}
              onClick={() => setDormId(String(item.id))}
            >
              <p className="truncate text-sm font-black">{item.name}</p>
              <p className={`mt-1 text-xs font-bold ${selected ? "text-white/80" : "text-slate-500"}`}>{rooms.length} комн. · {beds} койко-мест</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-black">
                <span className={`rounded px-2 py-1 text-center ${selected ? "bg-white/15" : "bg-white"}`}>Своб. {Math.max(beds - occupied, 0)}</span>
                <span className={`rounded px-2 py-1 text-center ${selected ? "bg-white/15" : "bg-white"}`}>Зан. {occupied}</span>
              </div>
            </button>
          );
        })}
      </div>
      </div>

      <div className="grid grid-cols-3 overflow-hidden rounded-md bg-refGreen text-center text-[10px] font-black leading-tight text-white shadow-panel sm:text-xs">
        <div className="border-r border-white/25 p-2 sm:p-3"><p className="opacity-80">Персонал к заселению</p><p className="mt-1 text-base sm:text-lg">{data.summary.personnelToSettle}</p></div>
        <div className="border-r border-white/25 p-2 sm:p-3"><p className="opacity-80">Свободных койко-мест</p><p className="mt-1 text-base sm:text-lg">{Math.max(dormBeds - occupiedInDorm, 0)}</p></div>
        <div className="p-2 sm:p-3"><p className="opacity-80">Занятых койко-мест</p><p className="mt-1 text-base sm:text-lg">{occupiedInDorm}</p></div>
      </div>

      {!dorm ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center">
          <p className="mb-3 text-sm font-black text-slate-500">Общежитий пока нет</p>
          <button className="btn-primary" onClick={() => mutate("/housing-dorms", "POST", { name: "Общежитие № 1", room_count: 5, beds_per_room: 5 }, "Общежитие создано")}>
            <Plus size={16} /> Добавить общежитие
          </button>
        </div>
      ) : (
        <div className="max-h-[58vh] max-w-full overflow-auto rounded-md border border-slate-300 bg-white shadow-panel" style={{ contain: "layout paint", overscrollBehavior: "contain" }}>
          <div className="w-[930px] md:w-[1030px]">
            {housingBlocks.map((block, blockIndex) => {
              const blockKey = housingBlockStateKey(dorm.id, block.block);
              const collapsed = Boolean(collapsedBlocks[blockKey]);
              const blockBodyId = `housing-block-${blockIndex}`;
              return (
                <section key={block.key} className="border-b border-slate-300 last:border-b-0">
                  <button
                    type="button"
                    data-housing-block-toggle={block.block}
                    className="flex h-12 w-full items-center justify-between gap-3 bg-slate-100 px-3 text-left text-xs font-black text-refDark transition hover:bg-slate-200 focus:bg-slate-200 focus:outline-none"
                    aria-expanded={!collapsed}
                    aria-controls={blockBodyId}
                    onClick={() => toggleBlock(blockKey)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                      <span className="truncate">{block.block}</span>
                    </span>
                    <span className="shrink-0 rounded bg-white px-2 py-1 text-[10px] text-slate-600 md:text-xs">
                      занято {block.occupied}/{block.total}
                    </span>
                  </button>
                  {!collapsed && (
                    <div id={blockBodyId} data-housing-block-body={block.block}>
                      <table data-housing-grid={block.block} className="w-[930px] table-fixed border-collapse text-[10px] md:w-[1030px] md:text-[11px]">
                        <colgroup>
                          <col className="w-20 md:w-24" />
                          <col className="w-28 md:w-32" />
                          {days.map((day) => <col key={`col-${block.key}-${day}`} className="w-6 md:w-8" />)}
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="w-20 border border-slate-300 bg-slate-200 p-1 leading-tight md:w-24 md:p-2" rowSpan={2}>Место / Дата</th>
                            <th className="w-28 border border-slate-300 bg-slate-200 p-1 leading-tight md:w-32 md:p-2" rowSpan={2}>Койко-место</th>
                            <th className="border border-slate-300 bg-slate-100 p-1 md:p-2" colSpan={days.length}>{dorm.name}</th>
                          </tr>
                          <tr>
                            {days.map((day) => <th key={`${block.key}-${day}`} className="w-6 border border-slate-300 bg-slate-100 p-1 font-black md:w-8">{day.slice(0, 2)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {block.rooms.map((group) => group.rows.map((place, index) => (
                            <tr key={place.label} data-housing-place-row={place.label} data-room-id={place.room_id || ""} data-bed-number={place.bed_number || ""} className="align-top">
                              <td className="truncate whitespace-nowrap align-top border border-slate-300 bg-slate-50 p-1 text-center font-black leading-tight md:p-2">{index === 0 ? group.room : ""}</td>
                              <td data-housing-bed-label={place.label} className="truncate whitespace-nowrap align-top border border-slate-300 bg-white p-1 font-bold leading-tight md:p-2">{place.bed}</td>
                              {days.map((day) => <HousingCell key={`${place.label}-${day}`} place={place} day={day} reservations={data.reservations} onOpen={(reservation) => setReservationEditor({ place, day, reservation })} />)}
                            </tr>
                          )))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded-sm bg-emerald-200" />Заехал</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded-sm bg-yellow-200" />Не заехал</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-5 rounded-sm bg-blue-200" />В резерве</span>
      </div>
      {editor && dorm && <DormModal dorm={dorm} reservations={data.reservations} mutate={mutate} close={() => setEditor(false)} />}
      {reservationEditor && <ReservationModal context={reservationEditor} data={data} mutate={mutate} close={() => setReservationEditor(null)} />}
      {data.pagination?.reservations.nextCursor && (
        <button className="mx-auto flex rounded-md bg-slate-100 px-4 py-2 text-sm font-black text-refGreen hover:bg-emerald-50" onClick={() => loadMore("reservations")}>
          Загрузить еще брони
        </button>
      )}
    </div>
  );
}

const COLLAPSED_HOUSING_BLOCKS_KEY = "reftinskaya:housing-collapsed-blocks:v1";
const DEFAULT_HOUSING_BLOCK = "Без блока";

type HousingRoomGroup = { room: string; rows: HousingPlace[] };
type HousingBlockGroup = {
  key: string;
  block: string;
  rooms: HousingRoomGroup[];
  total: number;
  occupied: number;
};

function housingBlockName(room: number) {
  return `Этаж ${Math.max(1, Math.ceil(room / 10))}`;
}

function dormRooms(dorm: Dormitory): Array<Pick<Room, "id" | "block" | "number" | "beds" | "order">> {
  if (dorm.rooms?.length) return dorm.rooms;
  return Array.from({ length: Math.max(1, dorm.room_count) }, (_, index) => {
    const roomNumber = index + 1;
    return {
      id: "",
      block: housingBlockName(roomNumber),
      number: `Комната № ${roomNumber}`,
      beds: Math.max(1, dorm.beds_per_room),
      order: roomNumber
    };
  });
}

function dormTotalBeds(dorm: Dormitory) {
  return dormRooms(dorm).reduce((sum, room) => sum + Math.max(1, room.beds), 0);
}

function matchesHousingPlace(place: Pick<HousingPlace, "room_id" | "bed_number" | "dorm" | "room" | "bed">, reservation: Reservation) {
  if (place.room_id && reservation.room_id) {
    return reservation.room_id === place.room_id && reservation.bed_number === place.bed_number;
  }
  return reservation.dorm === place.dorm && reservation.room === place.room && reservation.bed === place.bed;
}

function readCollapsedHousingBlocks() {
  if (typeof window === "undefined") return {};
  try {
    const value = window.localStorage.getItem(COLLAPSED_HOUSING_BLOCKS_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function writeCollapsedHousingBlocks(value: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_HOUSING_BLOCKS_KEY, JSON.stringify(value));
  } catch {
    // Сворачивание блоков — только удобство экрана; ошибки storage не должны мешать работе с жильем.
  }
}

function housingBlockStateKey(dormId: string, block: string) {
  return `${dormId}:${block}`;
}

function groupHousingPlaces(places: HousingPlace[], reservations: Reservation[], periodStart: string, periodEnd: string): HousingBlockGroup[] {
  const blocks: HousingBlockGroup[] = [];
  for (const place of places) {
    const blockName = place.block?.trim() || DEFAULT_HOUSING_BLOCK;
    let block = blocks.find((item) => item.block === blockName);
    if (!block) {
      block = { key: blockName, block: blockName, rooms: [], total: 0, occupied: 0 };
      blocks.push(block);
    }
    let room = block.rooms.find((item) => item.room === place.room);
    if (!room) {
      room = { room: place.room, rows: [] };
      block.rooms.push(room);
    }
    room.rows.push(place);
    block.total += 1;
    if (hasReservationInPeriod(place, reservations, periodStart, periodEnd)) block.occupied += 1;
  }
  return blocks;
}

function hasReservationInPeriod(place: HousingPlace, reservations: Reservation[], periodStart: string, periodEnd: string) {
  const startDate = parseRuDate(periodStart);
  const endDate = parseRuDate(periodEnd);
  return reservations.some((reservation) => (
    matchesHousingPlace(place, reservation)
    && parseRuDate(reservation.check_in) <= endDate
    && parseRuDate(reservation.check_out) >= startDate
    && !["Выехал", "Отменено"].includes(reservation.status)
  ));
}

function HousingCell({ place, day, reservations, onOpen }: { place: HousingPlace; day: string; reservations: Reservation[]; onOpen: (reservation?: Reservation) => void }) {
  const reservation = reservations.find((item) => matchesHousingPlace(place, item) && parseRuDate(item.check_in) <= parseRuDate(day) && parseRuDate(day) <= parseRuDate(item.check_out) && !["Выехал", "Отменено"].includes(item.status));
  const isStart = reservation?.check_in === day;
  const isEnd = reservation?.check_out === day;
  const reservationTone = reservation?.status === "Заехал" ? "bg-emerald-200 text-emerald-950" : reservation?.status === "В резерве" ? "bg-blue-200 text-blue-950" : "bg-yellow-200 text-yellow-950";
  return (
    <td
      data-housing-cell={place.label}
      data-day={day}
      data-room-id={place.room_id || ""}
      data-bed-number={place.bed_number || ""}
      data-occupied={reservation ? "true" : "false"}
      className="h-7 align-top border border-slate-300 bg-white p-0 md:h-8"
    >
      {reservation ? (
        <button
          data-housing-reservation={reservation.id}
          className={`box-border h-full w-full truncate whitespace-nowrap px-1 text-left text-[9px] font-black leading-tight ${reservationTone} ${isStart ? "rounded-l-sm" : ""} ${isEnd ? "rounded-r-sm" : ""}`}
          title={`${displayReservationEmployeeName(reservation)}: ${reservation.check_in} - ${reservation.check_out}`}
          onClick={() => onOpen(reservation)}
        >
          {isStart ? displayReservationEmployeeName(reservation) : ""}
        </button>
      ) : (
        <button
          className="group box-border h-full w-full bg-white transition hover:bg-emerald-50 focus:bg-emerald-50"
          title="Создать бронь"
          onClick={() => onOpen()}
        >
          <span className="sr-only">Создать бронь</span>
          <span className="opacity-0 text-refGreen transition group-hover:opacity-100 group-focus:opacity-100">+</span>
        </button>
      )}
    </td>
  );
}

function daysBetweenInclusive(start: string, end: string) {
  const startDate = parseRuDate(start);
  const endDate = parseRuDate(end);
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  return Math.max(1, diff);
}

function ReservationModal({ context, data, mutate, close }: { context: { place: HousingPlace; day: string; reservation?: Reservation }; data: BootstrapData; mutate: BootstrapMutate; close: () => void }) {
  const defaultCost = data.settings?.defaultReservationCost ?? 30000;
  const housingEmployees = data.employees.filter((employee) => Boolean(employee.needs_housing));
  const initialEmployee = context.reservation?.employee_id || housingEmployees[0]?.id || data.employees[0]?.id || "";
  const initialCheckIn = context.reservation?.check_in || context.day;
  const initialCheckOut = context.reservation?.check_out || context.day;
  const [draft, setDraft] = useState({
    employee_id: initialEmployee,
    room_id: context.reservation?.room_id || context.place.room_id || "",
    bed_number: context.reservation?.bed_number ?? context.place.bed_number ?? null,
    dorm: context.reservation?.dorm || context.place.dorm,
    room: context.reservation?.room || context.place.room,
    bed: context.reservation?.bed || context.place.bed,
    check_in: initialCheckIn,
    check_out: initialCheckOut,
    cost: context.reservation?.cost ?? daysBetweenInclusive(initialCheckIn, initialCheckOut) * defaultCost,
    comment: context.reservation?.comment || "",
    status: context.reservation?.status || "Не заехал"
  });
  const [costTouched, setCostTouched] = useState(Boolean(context.reservation));
  const selectedEmployee = data.employees.find((employee) => employee.id === draft.employee_id);
  const calculatedCost = daysBetweenInclusive(draft.check_in, draft.check_out) * defaultCost;
  const { confirm, notify } = useUiFeedback();

  useEffect(() => {
    if (costTouched) return;
    setDraft((current) => ({ ...current, cost: calculatedCost }));
  }, [calculatedCost, costTouched]);

  const save = async () => {
    if (!draft.employee_id || !draft.room_id || !draft.bed_number || !draft.check_in || !draft.check_out) {
      notify("Заполните все обязательные поля брони.", "warning");
      return;
    }
    if (numberValue(draft.cost, -1) < 0) {
      notify("Стоимость не может быть меньше нуля.", "warning");
      return;
    }
    if (!await confirm({
      title: "Бронь на жилье",
      message: context.reservation ? "Сохранить изменения брони?" : "Создать бронь на жилье?",
      confirmLabel: context.reservation ? "Сохранить" : "Создать"
    })) return;
    const method = context.reservation ? "PUT" : "POST";
    const path = context.reservation ? `/reservations/${context.reservation.id}` : "/reservations";
    await mutate(path, method, draft, context.reservation ? "Бронь сохранена" : "Бронь создана");
    close();
  };

  return (
    <Modal title="Бронь на жилье" close={close}>
      <div className="space-y-3">
        <Readonly label="Место" value={`${draft.dorm}, ${draft.room}, ${draft.bed}`} />
        <div className="grid gap-2 md:grid-cols-2">
          <Input label="Заезд" value={draft.check_in} onChange={(value) => setDraft({ ...draft, check_in: value })} />
          <Input label="Выезд" value={draft.check_out} onChange={(value) => setDraft({ ...draft, check_out: value })} />
        </div>
        <label className="text-sm font-black">
          Сотрудник
          <select className="field mt-1" value={draft.employee_id} onChange={(event) => setDraft({ ...draft, employee_id: event.target.value })}>
            {housingEmployees.map((employee) => <option key={employee.id} value={employee.id}>{displayEmployeeName(employee)}</option>)}
          </select>
        </label>
        {!housingEmployees.length && <p className="rounded-md bg-orange-50 p-2 text-sm font-bold text-orange-700">В базе нет сотрудников с отметкой "Нуждается в жилье".</p>}
        <div className="grid gap-2 md:grid-cols-2">
          <Readonly label="Телефон" value={selectedEmployee?.phone || "-"} />
          <Input
            label="Стоимость, руб."
            type="number"
            min={0}
            value={draft.cost}
            onChange={(value) => {
              setCostTouched(true);
              setDraft({ ...draft, cost: Math.max(0, numberValue(value, 0)) });
            }}
          />
        </div>
        <label className="text-sm font-black">
          Статус
          <select className="field mt-1" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option>Не заехал</option>
            <option>Заехал</option>
            <option>Выехал</option>
          </select>
        </label>
        <Input label="Комментарий" value={draft.comment} onChange={(value) => setDraft({ ...draft, comment: value })} />
        <div className="flex justify-between gap-2">
          {context.reservation ? <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-black text-white" onClick={() => mutate(`/reservations/${context.reservation?.id}`, "DELETE", undefined, "Бронь удалена").then(close)}>Удалить</button> : <span />}
          <div className="flex gap-2">
            <button className="rounded-md bg-slate-300 px-4 py-2 text-sm font-black" onClick={close}>Закрыть</button>
            <button className="btn-primary" onClick={save}>{context.reservation ? "Сохранить" : "Создать"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

type RoomDraft = {
  id?: string;
  block: string;
  number: string;
  beds: number;
  order: number;
};

function bedNumber(value: string) {
  const match = value.match(/\d+/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function createRoomDrafts(dorm: Dormitory): RoomDraft[] {
  return dormRooms(dorm).map((room, index) => ({
    id: room.id || undefined,
    block: room.block || housingBlockName(index + 1),
    number: room.number || `Комната № ${index + 1}`,
    beds: Math.max(1, room.beds),
    order: room.order || index + 1
  }));
}

function reservationBedNumber(reservation: Reservation) {
  return reservation.bed_number || bedNumber(reservation.bed);
}

function maxOccupiedBed(dormName: string, roomId: string | undefined, roomNumber: string, reservations: Reservation[]) {
  return reservations
    .filter((reservation) => (
      !["Выехал", "Отменено"].includes(reservation.status)
      && (
        (roomId && reservation.room_id === roomId)
        || (!reservation.room_id && reservation.dorm === dormName && reservation.room === roomNumber)
      )
    ))
    .reduce((max, reservation) => Math.max(max, reservationBedNumber(reservation)), 0);
}

function hasLegacyOccupiedRoom(dormName: string, roomNumber: string, reservations: Reservation[]) {
  return reservations.some((reservation) => (
    !reservation.room_id
    && reservation.dorm === dormName
    && reservation.room === roomNumber
    && !["Выехал", "Отменено"].includes(reservation.status)
  ));
}

function DormModal({ dorm, reservations, mutate, close }: { dorm: Dormitory; reservations: Reservation[]; mutate: BootstrapMutate; close: () => void }) {
  const [draft, setDraft] = useState({ name: dorm.name, rooms: createRoomDrafts(dorm) });
  const { notify } = useUiFeedback();
  const originalRooms = dormRooms(dorm);
  const originalNumberById = new Map(originalRooms.filter((room) => room.id).map((room) => [room.id, room.number]));

  const updateRoom = (index: number, patch: Partial<RoomDraft>) => {
    setDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room, roomIndex) => roomIndex === index ? { ...room, ...patch } : room)
    }));
  };

  const addRoom = () => {
    setDraft((current) => {
      const order = current.rooms.reduce((max, room) => Math.max(max, room.order), 0) + 1;
      return {
        ...current,
        rooms: [
          ...current.rooms,
          {
            block: housingBlockName(order),
            number: `Комната № ${order}`,
            beds: 1,
            order
          }
        ]
      };
    });
  };

  const removeRoom = (index: number) => {
    const room = draft.rooms[index];
    const originalNumber = room.id ? originalNumberById.get(room.id) || room.number : room.number;
    if (maxOccupiedBed(dorm.name, room.id, originalNumber, reservations) > 0) {
      notify(`В комнате "${originalNumber}" есть активная бронь. Сначала переселите жильцов.`, "warning");
      return;
    }
    setDraft((current) => ({ ...current, rooms: current.rooms.filter((_, roomIndex) => roomIndex !== index) }));
  };

  const save = async () => {
    if (!draft.name.trim()) {
      notify("Укажите название общежития.", "warning");
      return;
    }
    if (!draft.rooms.length) {
      notify("Добавьте хотя бы одну комнату.", "warning");
      return;
    }
    const numbers = new Set<string>();
    for (const room of draft.rooms) {
      const number = room.number.trim();
      if (!number) {
        notify("У каждой комнаты должен быть номер.", "warning");
        return;
      }
      const key = number.toLocaleLowerCase("ru-RU");
      if (numbers.has(key)) {
        notify(`Комната "${number}" указана больше одного раза.`, "warning");
        return;
      }
      numbers.add(key);
      const originalNumber = room.id ? originalNumberById.get(room.id) || room.number : room.number;
      if (originalNumber !== room.number && hasLegacyOccupiedRoom(dorm.name, originalNumber, reservations)) {
        notify(`Комната "${originalNumber}" занята. Сначала переселите жильцов, затем меняйте номер.`, "warning");
        return;
      }
      const occupiedBed = Math.max(
        maxOccupiedBed(dorm.name, room.id, originalNumber, reservations),
        maxOccupiedBed(dorm.name, room.id, room.number, reservations)
      );
      if (occupiedBed > room.beds) {
        notify(`В комнате "${room.number}" занято койко-место № ${occupiedBed}.`, "warning");
        return;
      }
    }
    await mutate(`/housing-dorms/${dorm.id}`, "PUT", {
      name: draft.name.trim(),
      rooms: draft.rooms.map((room, index) => ({
        id: room.id,
        block: room.block.trim() || housingBlockName(index + 1),
        number: room.number.trim(),
        beds: Math.max(1, Math.trunc(room.beds)),
        order: index + 1
      }))
    }).then(close);
  };

  return (
    <Modal title="Общежитие" close={close}>
      <div className="space-y-3">
        <Input label="Название" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black">Комнаты</p>
            <button className="rounded-md bg-slate-100 px-3 py-2 text-xs font-black text-refGreen hover:bg-emerald-50" onClick={addRoom}>
              <Plus size={14} className="inline" /> Добавить
            </button>
          </div>
          <div className="max-h-[42vh] space-y-2 overflow-auto pr-1">
            {draft.rooms.map((room, index) => {
              const originalNumber = room.id ? originalNumberById.get(room.id) || room.number : room.number;
              const occupiedBed = Math.max(
                maxOccupiedBed(dorm.name, room.id, room.number, reservations),
                maxOccupiedBed(dorm.name, room.id, originalNumber, reservations)
              );
              return (
                <div key={`${room.id || "new"}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px_40px]">
                    <label className="text-xs font-black text-slate-500">
                      Номер
                      <input className="field mt-1 h-10" value={room.number} onChange={(event) => updateRoom(index, { number: event.target.value })} />
                    </label>
                    <label className="text-xs font-black text-slate-500">
                      Блок
                      <input className="field mt-1 h-10" value={room.block} onChange={(event) => updateRoom(index, { block: event.target.value })} />
                    </label>
                    <label className="text-xs font-black text-slate-500">
                      Койко-мест
                      <input
                        className="field mt-1 h-10"
                        min={Math.max(1, occupiedBed)}
                        type="number"
                        value={room.beds}
                        onChange={(event) => updateRoom(index, { beds: Math.max(1, occupiedBed, numberValue(event.target.value, 1)) })}
                      />
                    </label>
                    <button
                      className="h-10 self-end rounded-md bg-red-50 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={draft.rooms.length <= 1}
                      title="Удалить комнату"
                      onClick={() => removeRoom(index)}
                    >
                      <Trash2 size={16} className="mx-auto" />
                    </button>
                  </div>
                  {occupiedBed > 0 && <p className="mt-2 text-xs font-bold text-orange-600">Занято до койко-места № {occupiedBed}</p>}
                </div>
              );
            })}
          </div>
        </div>
        <button className="btn-primary w-full" onClick={save}>Сохранить</button>
      </div>
    </Modal>
  );
}
