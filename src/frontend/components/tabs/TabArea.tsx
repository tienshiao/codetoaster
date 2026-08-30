import { Fragment, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  canSplit,
  closeTab,
  focusTab,
  moveTab,
  pinTab,
  setGroupFlex,
  splitTab,
  type TabGroup,
  type TabState,
  type TaskLayout,
} from "@/frontend/layout-store";
import { TabStrip, type TabProps } from "@/frontend/components/v2/TabStrip";
import { cn } from "@/frontend/lib/utils";
import { dropIndexAt, moveIndexFor, resizeFlex, type TabBox } from "./drag";
import { presentTab } from "./tab-labels";

/**
 * The tabbed main area (§7.1, §7.2): a flat row of groups, each with its own
 * strip, header and pane.
 *
 * Every rule about what a layout may become lives in `layout-store.ts`. This is
 * the chrome that calls those operations and draws the answer — it does not
 * decide whether the agent tab can close or whether a terminal can split, it
 * asks, and greys out the affordance when the answer is no.
 *
 * Controlled: the layout comes in, every change goes back out through
 * `onLayoutChange`, and who persists it (`saveLayout`, keyed by task) is the
 * caller's business.
 */
export interface TabAreaProps {
  layout: TaskLayout;
  onLayoutChange: (next: TaskLayout) => void;
  /** What fills a group's pane. TASK-23's hosts; a fixture until then. */
  renderPane: (tab: TabState, group: TabGroup) => ReactNode;
  /** The band under each group's strip. Repeated per group — the task's own
   * values, beside the strip they belong to. */
  header?: ReactNode;
  /** Chrome for the first strip only: the shell's sidebar toggle, which belongs
   * at the window's edge rather than following the active group. */
  leading?: ReactNode;
  /** The overflow menu on a group's strip. */
  onTabActions?: (group: TabGroup) => void;
  className?: string;
}

/** How narrow a group may be dragged. Below this there is nothing left to grab
 * to drag it back. */
const MIN_GROUP_PX = 160;
/** Pointer travel before a press on a tab becomes a drag rather than a click.
 * Small enough to feel immediate, large enough that a click with a shaky hand
 * is still a click. */
const DRAG_THRESHOLD_PX = 4;
/** One arrow key's worth of boundary. */
const NUDGE_PX = 16;

interface DragGesture {
  tabId: string;
  fromGroupId: string;
  startX: number;
  startY: number;
  started: boolean;
  /** Where the drop would land, recomputed on every move. The boxes travel with
   * it so the commit does not have to re-measure a strip the pointer may have
   * already left. */
  target: { groupId: string; index: number; boxes: TabBox[] } | null;
}

interface ResizeGesture {
  /** The boundary being dragged: between group `index` and `index + 1`. */
  index: number;
  startX: number;
  flexes: number[];
  widths: number[];
}

/** Strips and columns are queried rather than kept in a registry of refs: a
 * pointer lands on a DOM node, and asking that node which group it is in is
 * both shorter and impossible to leave stale. */
function boxesIn(strip: Element): TabBox[] {
  return Array.from(strip.querySelectorAll<HTMLElement>("[data-tab-id]")).map((el) => {
    const rect = el.getBoundingClientRect();
    return { id: el.dataset.tabId!, left: rect.left, width: rect.width };
  });
}

export function TabArea({
  layout,
  onLayoutChange,
  renderPane,
  header,
  leading,
  onTabActions,
  className,
}: TabAreaProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragGesture | null>(null);
  const resizeRef = useRef<ResizeGesture | null>(null);
  // What the strips draw while a gesture is live. In state because it is
  // feedback; the gesture itself stays in a ref, so the pointermoves that change
  // nothing cost no renders.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string; index: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  // Read through refs inside the window listeners: a gesture installs them once
  // and would otherwise close over the layout as it was when the pointer went
  // down — which, for a drag that ends in a move, is precisely the stale one.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const changeRef = useRef(onLayoutChange);
  changeRef.current = onLayoutChange;

  // One gesture at a time, and it must not outlive the component: a drag
  // interrupted by a tab closing under it would otherwise leave listeners on
  // the window for the life of the page.
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRef.current?.(), []);

  const listen = useCallback(
    (onMove: (e: globalThis.PointerEvent) => void, onFinish: (committed: boolean) => void) => {
      releaseRef.current?.();
      const done = (committed: boolean) => () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        releaseRef.current = null;
        onFinish(committed);
      };
      // `pointercancel` matters as much as `pointerup`: a touch that turns into
      // a scroll, or a window that loses the pointer, otherwise leaves a tab
      // dimmed and an indicator hanging with no gesture behind either.
      const up = done(true);
      const cancel = done(false);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      releaseRef.current = () => cancel();
    },
    [],
  );

  // ── dragging a tab ────────────────────────────────────────────────────────

  const startDrag = (tab: TabState, group: TabGroup) => (e: PointerEvent<HTMLDivElement>) => {
    // Left button only, and never from the close control: pressing X and
    // twitching a pixel should still close the tab.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-tab-close]")) return;

    dragRef.current = {
      tabId: tab.id,
      fromGroupId: group.id,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      target: null,
    };

    listen(
      (move) => {
        const gesture = dragRef.current;
        if (!gesture) return;
        if (!gesture.started) {
          const travelled =
            Math.abs(move.clientX - gesture.startX) + Math.abs(move.clientY - gesture.startY);
          if (travelled < DRAG_THRESHOLD_PX) return;
          gesture.started = true;
          setDraggingId(gesture.tabId);
        }

        const strip = document
          .elementFromPoint(move.clientX, move.clientY)
          ?.closest<HTMLElement>("[data-tab-group]");
        const groupId = strip?.dataset.tabGroup;
        const current = layoutRef.current;
        const destination = groupId ? current.groups.find((g) => g.id === groupId) : undefined;
        const dragged = current.groups.flatMap((g) => g.tabs).find((t) => t.id === gesture.tabId);

        // A tab may not land in a group that already shows its key — a terminal
        // in two groups is the invariant `splitTab` exists to protect, and
        // `moveTab` refuses it. Withdrawing the indicator says so before the
        // drop rather than swallowing it after.
        const refused =
          !strip ||
          !groupId ||
          !destination ||
          !dragged ||
          (groupId !== gesture.fromGroupId && destination.tabs.some((t) => t.key === dragged.key));
        if (refused) {
          gesture.target = null;
          setDropTarget(null);
          return;
        }

        const boxes = boxesIn(strip);
        const index = dropIndexAt(boxes, move.clientX);
        gesture.target = { groupId, index, boxes };
        setDropTarget((shown) =>
          shown?.groupId === groupId && shown.index === index ? shown : { groupId, index },
        );
      },
      (committed) => {
        const gesture = dragRef.current;
        dragRef.current = null;
        setDraggingId(null);
        setDropTarget(null);
        if (!committed || !gesture?.started || !gesture.target) return;
        const { groupId, index, boxes } = gesture.target;
        // Within one group the tab is lifted out before it is put back, so the
        // index the user sees is not the index `moveTab` wants — and a drop
        // either side of where it already is means nothing at all.
        const to =
          groupId === gesture.fromGroupId ? moveIndexFor(boxes, index, gesture.tabId) : index;
        if (to !== null) changeRef.current(moveTab(layoutRef.current, gesture.tabId, groupId, to));
      },
    );
  };

  // ── resizing a boundary ───────────────────────────────────────────────────

  const columnWidths = (): number[] =>
    Array.from(rowRef.current?.querySelectorAll<HTMLElement>("[data-tab-column]") ?? []).map(
      (el) => el.getBoundingClientRect().width,
    );

  const startResize = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Or the drag selects the text of every pane it crosses.
    e.preventDefault();
    resizeRef.current = {
      index,
      startX: e.clientX,
      flexes: layout.groups.map((g) => g.flex),
      widths: columnWidths(),
    };
    setResizing(true);
    listen(
      (move) => {
        const gesture = resizeRef.current;
        if (!gesture) return;
        // Against the widths measured at pointerdown, not the live ones:
        // resizing off the current frame compounds its own rounding and the
        // boundary drifts away from the pointer.
        const next = resizeFlex(
          gesture.flexes,
          gesture.widths,
          gesture.index,
          move.clientX - gesture.startX,
          MIN_GROUP_PX,
        );
        changeRef.current(setGroupFlex(layoutRef.current, next));
      },
      () => {
        resizeRef.current = null;
        setResizing(false);
      },
    );
  };

  const nudge = (index: number, deltaPx: number) => {
    const next = resizeFlex(
      layout.groups.map((g) => g.flex),
      columnWidths(),
      index,
      deltaPx,
      MIN_GROUP_PX,
    );
    onLayoutChange(setGroupFlex(layout, next));
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        // While a boundary is moving the cursor must not flicker back to a text
        // caret every time the pointer crosses a pane.
        resizing && "cursor-col-resize select-none",
        className,
      )}
    >
      {layout.groups.map((group, groupIndex) => {
        const active = group.tabs.find((t) => t.id === group.activeTabId) ?? group.tabs[0] ?? null;
        const target = dropTarget?.groupId === group.id ? dropTarget.index : null;
        const splittable = active != null && canSplit(layout, active.id);

        const tabs: TabProps[] = group.tabs.map((tab, tabIndex) => {
          const shown = presentTab(tab.descriptor);
          return {
            kind: shown.kind,
            label: shown.label,
            detail: shown.detail,
            title: shown.title,
            closable: shown.closable,
            tabId: tab.id,
            active: tab.id === group.activeTabId,
            preview: tab.preview,
            onClick: () => onLayoutChange(focusTab(layout, tab.id)),
            // The pin gesture. `pinTab` is a no-op on a permanent tab, so a
            // double-click anywhere in the strip needs no guard of its own.
            onDoubleClick: () => onLayoutChange(pinTab(layout, tab.id)),
            // The agent tab gets no handler, so `Tab` draws the pin glyph in
            // place of an X: nothing to click, and nothing to reach by keyboard.
            onClose: shown.closable ? () => onLayoutChange(closeTab(layout, tab.id)) : undefined,
            onPointerDown: startDrag(tab, group),
            dragging: draggingId === tab.id,
            dropBefore: target === tabIndex,
            dropAfter: target === group.tabs.length && tabIndex === group.tabs.length - 1,
          };
        });

        return (
          <Fragment key={group.id}>
            {groupIndex > 0 && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize groups"
                tabIndex={0}
                onPointerDown={startResize(groupIndex - 1)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") nudge(groupIndex - 1, -NUDGE_PX);
                  else if (e.key === "ArrowRight") nudge(groupIndex - 1, NUDGE_PX);
                  else return;
                  e.preventDefault();
                }}
                // Pulled over the border it sits on: a 1px target is a target
                // nobody hits, and a 6px gutter between panes is visible slack.
                className={cn(
                  "z-10 -mx-[3px] w-1.5 flex-none cursor-col-resize",
                  "hover:bg-[oklch(var(--ct-blue-500-ch)/0.35)]",
                  "focus-visible:bg-[oklch(var(--ct-blue-500-ch)/0.35)] focus-visible:outline-none",
                  resizing && "bg-[oklch(var(--ct-blue-500-ch)/0.35)]",
                )}
              />
            )}
            <section
              data-tab-column={group.id}
              style={{ flexGrow: group.flex, flexBasis: 0 }}
              className={cn("flex min-w-0 flex-col", groupIndex > 0 && "border-l border-border")}
            >
              <TabStrip
                groupId={group.id}
                tabs={tabs}
                leading={groupIndex === 0 ? leading : undefined}
                splitDisabled={!splittable}
                onSplit={
                  active && splittable ? () => onLayoutChange(splitTab(layout, active.id)) : undefined
                }
                onTabActions={onTabActions ? () => onTabActions(group) : undefined}
                // A press anywhere on the strip — a tab, the empty stretch past
                // the last one, the action cluster — is a press on this group.
                onPointerDown={() => {
                  if (group.id !== layout.activeGroupId && active) {
                    onLayoutChange(focusTab(layout, active.id));
                  }
                }}
              />
              {header}
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                {active ? renderPane(active, group) : null}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}
