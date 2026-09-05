import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  canSearch,
  canSplit,
  closeTab,
  focusTab,
  isTerminalTab,
  moveTab,
  pinTab,
  setGroupFlex,
  splitTab,
  type TabGroup,
  type TabState,
  type TaskLayout,
} from "@/frontend/layout-store";
import { ResizeHandle } from "@/frontend/components/v2/ResizeHandle";
import { Tab, TabStrip, type TabProps } from "@/frontend/components/v2/TabStrip";
import { cn } from "@/frontend/lib/utils";
import { dropIndexAt, moveIndexFor, resizeFlex, type TabBox } from "./drag";
import { presentTab } from "./tab-labels";

/**
 * The tabbed main area (§7.1, §7.2): a flat row of groups, each with its own
 * strip and pane.
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
  /**
   * What fills a group's pane.
   *
   * `visible` is false for a terminal tab that is mounted but not the active
   * one — see the pane container below. Every other tab only ever renders while
   * it is showing, so it is only ever called with true.
   */
  renderPane: (tab: TabState, group: TabGroup, visible: boolean) => ReactNode;
  /** Chrome for the first strip only: the shell's sidebar toggle, which belongs
   * at the window's edge rather than following the active group. */
  leading?: ReactNode;
  /** The overflow menu on a group's strip. */
  onTabActions?: (group: TabGroup) => void;
  /** Open a plain shell in this task as a new tab (§3). The strip's `+`; absent
   * where there is no task to open one in. */
  onNewShell?: () => void;
  /**
   * A tab was closed *by the close gesture* — the X, or the keyboard reaching
   * it — as opposed to disappearing because the layout was rewritten around it.
   *
   * The distinction is the whole reason this exists rather than the caller
   * diffing layouts. Closing a shell tab has to kill its PTY, and a diff cannot
   * tell that from a shell tab dropped by `pruneShellTabs`, whose PTY is
   * already dead — which would have every reconciliation firing a DELETE
   * against a terminal that is gone.
   *
   * Fired alongside `onLayoutChange`, not instead of it: the layout closes the
   * tab either way.
   */
  onCloseTab?: (tab: TabState) => void;
  /** Open search in this group's active terminal tab — the strip's magnifier.
   * Absent where nothing can answer it. */
  onSearchTab?: (tab: TabState) => void;
  className?: string;
}

/** How narrow a group may be dragged. Below this there is nothing left to grab
 * to drag it back. */
const MIN_GROUP_PX = 160;
/** Pointer travel before a press on a tab becomes a drag rather than a click.
 * Small enough to feel immediate, large enough that a click with a shaky hand
 * is still a click. */
const DRAG_THRESHOLD_PX = 4;

interface DragGesture {
  tabId: string;
  fromGroupId: string;
  startX: number;
  startY: number;
  /**
   * The pointer's offset inside the tab it grabbed, and how wide that tab was.
   *
   * Measured at pointerdown, while the tab is still under the press: it is what
   * lets the proxy be carried from the point it was picked up rather than
   * snapping its corner to the cursor, which reads as the tab jumping out of
   * the user's hand at the moment they start to move it.
   */
  grabX: number;
  grabY: number;
  width: number;
  started: boolean;
  /** Where the drop would land, recomputed on every move. The boxes travel with
   * it so the commit does not have to re-measure a strip the pointer may have
   * already left. */
  target: { groupId: string; index: number; boxes: TabBox[] } | null;
}

interface ResizeGesture {
  /** The boundary being dragged: between group `index` and `index + 1`. */
  index: number;
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
  leading,
  onTabActions,
  onNewShell,
  onCloseTab,
  onSearchTab,
  className,
}: TabAreaProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragGesture | null>(null);
  const resizeRef = useRef<ResizeGesture | null>(null);
  // What the strips draw while a gesture is live. In state because it is
  // feedback; the gesture itself stays in a ref, so the pointermoves that change
  // nothing cost no renders.
  //
  // The drag carries the proxy's width as well as its id: the proxy is drawn
  // outside the strip and has nothing to size itself against there, and it has
  // to stay the width of the tab it stands for rather than the width its own
  // label happens to want.
  const [drag, setDrag] = useState<{ tabId: string; width: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string; index: number } | null>(null);

  // The proxy's position never goes through state. It changes on every
  // pointermove, and a `TabArea` re-render is every group, every strip and
  // every mounted pane — a cost this gesture would pay a hundred times on the
  // way across one strip.
  const proxyRef = useRef<HTMLDivElement>(null);
  const proxyPosRef = useRef({ x: 0, y: 0 });
  const placeProxy = useCallback((x: number, y: number) => {
    proxyPosRef.current = { x, y };
    // Absent until the render that mounts it; the effect below is what covers
    // that first frame.
    if (proxyRef.current) proxyRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);
  // Deliberately without a dependency array. The transform is not in the JSX,
  // so React does not restore it, and `setDropTarget` re-renders this component
  // in the middle of the drag — with the position in an inline style, every one
  // of those renders would snap the proxy back to wherever the gesture began.
  // Re-applying after *every* render is what makes the imperative write above
  // safe, and it is also what positions the proxy on the frame it mounts.
  useLayoutEffect(() => {
    const el = proxyRef.current;
    if (!el) return;
    const { x, y } = proxyPosRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });

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
        window.removeEventListener("keydown", key, true);
        releaseRef.current = null;
        onFinish(committed);
      };
      // `pointercancel` matters as much as `pointerup`: a touch that turns into
      // a scroll, or a window that loses the pointer, otherwise leaves a tab
      // dimmed and an indicator hanging with no gesture behind either.
      const up = done(true);
      const cancel = done(false);
      // Escape abandons a drag the pointer is still holding — the one exit that
      // does not involve letting go, and the only way out for a user who has
      // picked up a tab and does not want to drop it anywhere. It goes through
      // the same `done` as every other ending: four ways out of a gesture is
      // four chances to leave a proxy on screen, unless they are one path.
      //
      // In the capture phase, and consumed: the key is dispatched at whatever
      // has focus, which during a drag over a terminal is xterm's textarea —
      // left to bubble, Escape would cancel the drag *and* put vim back in
      // command mode. Only a drag past the threshold consumes it, though: until
      // then the press is still a click, and Escape belongs to the pane behind
      // it.
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        if (!dragRef.current?.started) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
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

    // Retire any gesture still installed *before* writing this one down.
    // `listen` releases too, but that release runs the previous gesture's
    // finish handler, which nulls the very ref set just below — so a second
    // pointer landing before the first lifts would otherwise kill the drag it
    // was starting.
    releaseRef.current?.();

    // Taken now rather than when the threshold is crossed: by then the pointer
    // has moved, and the offset that matters is where inside the tab the user
    // actually pressed.
    const grabbed = e.currentTarget.getBoundingClientRect();

    dragRef.current = {
      tabId: tab.id,
      fromGroupId: group.id,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - grabbed.left,
      grabY: e.clientY - grabbed.top,
      width: grabbed.width,
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
          // On `<body>`, because the pointer spends the drag over panes rather
          // than over the strip it started in: the grabbing cursor and the
          // guard against painting every pane it crosses blue both have to
          // apply to the document. Shares its shape with `ResizeHandle`; see
          // `index.css`.
          document.body.dataset.dragging = "tab";
          setDrag({ tabId: gesture.tabId, width: gesture.width });
        }

        // Before the hit test, and outside it: the proxy follows the pointer
        // even where a drop is refused, because it is the thing the user is
        // holding. Only the indicator answers whether it may be let go here.
        placeProxy(move.clientX - gesture.grabX, move.clientY - gesture.grabY);

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
        setDrag(null);
        setDropTarget(null);
        delete document.body.dataset.dragging;
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

  // Safe to read from the layout as it is now: the move commits on release, so
  // nothing rewrites the tab out from under the proxy mid-gesture.
  const dragged = drag
    ? layout.groups.flatMap((g) => g.tabs).find((t) => t.id === drag.tabId)
    : undefined;

  return (
    <div ref={rowRef} className={cn("flex min-h-0 min-w-0 flex-1", className)}>
      {layout.groups.map((group, groupIndex) => {
        const active = group.tabs.find((t) => t.id === group.activeTabId) ?? group.tabs[0] ?? null;
        const target = dropTarget?.groupId === group.id ? dropTarget.index : null;
        const splittable = active != null && canSplit(layout, active.id);
        // The store's own predicate, so the magnifier and the palette's row
        // agree on what can be searched. In front of anything else it greys out
        // rather than vanishing, as Split does.
        const searchable = active != null && canSearch(layout, active.id);

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
            onClose: shown.closable
              ? () => {
                  onCloseTab?.(tab);
                  onLayoutChange(closeTab(layout, tab.id));
                }
              : undefined,
            onPointerDown: startDrag(tab, group),
            dragging: drag?.tabId === tab.id,
            dropBefore: target === tabIndex,
            dropAfter: target === group.tabs.length && tabIndex === group.tabs.length - 1,
          };
        });

        return (
          <Fragment key={group.id}>
            {groupIndex > 0 && (
              <ResizeHandle
                label="Resize groups"
                // The flexes and widths are taken once, at pointerdown, and
                // every move is measured against them: resizing off the current
                // frame compounds its own rounding and the boundary drifts away
                // from the pointer.
                onResizeStart={() => {
                  resizeRef.current = {
                    index: groupIndex - 1,
                    flexes: layout.groups.map((g) => g.flex),
                    widths: columnWidths(),
                  };
                }}
                onResize={(delta) => {
                  const gesture = resizeRef.current;
                  if (!gesture) return;
                  changeRef.current(
                    setGroupFlex(
                      layoutRef.current,
                      resizeFlex(
                        gesture.flexes,
                        gesture.widths,
                        gesture.index,
                        delta,
                        MIN_GROUP_PX,
                      ),
                    ),
                  );
                }}
                onResizeEnd={() => {
                  resizeRef.current = null;
                }}
                onNudge={(delta) => nudge(groupIndex - 1, delta)}
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
                // The leader chords act on the active group, so only its strip
                // names them.
                focused={group.id === layout.activeGroupId}
                onSplit={
                  active && splittable ? () => onLayoutChange(splitTab(layout, active.id)) : undefined
                }
                onSearch={onSearchTab && active ? () => onSearchTab(active) : undefined}
                searchDisabled={!searchable}
                onTabActions={onTabActions ? () => onTabActions(group) : undefined}
                onNewShell={onNewShell}
                // A press anywhere on the strip — a tab, the empty stretch past
                // the last one, the action cluster — is a press on this group.
                onPointerDown={() => {
                  if (group.id !== layout.activeGroupId && active) {
                    onLayoutChange(focusTab(layout, active.id));
                  }
                }}
              />
              {/* Terminal tabs stay mounted and merely hide, which is the one
                  place a pane's identity outlives its being on screen.
                  Unmounting one would drop the attachment, throw the xterm grid
                  away and cost a full `restore` to come back — on every switch
                  to a diff tab and back. Everything else renders only while it
                  is active: a diff pane is a query and a scroll offset, both
                  cheap to rebuild and both already persisted by tab key.

                  `Terminal.tsx` is built for exactly this: `fitIfVisible` skips
                  a hidden or zero-sized container rather than fitting the grid
                  to nothing, and remembers that it did so the next fit is
                  treated as a first fit rather than a user resize. */}
              <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                {group.tabs.map((tab) =>
                  isTerminalTab(tab.descriptor) ? (
                    <div
                      key={tab.id}
                      className={cn("h-full", tab.id !== group.activeTabId && "hidden")}
                    >
                      {renderPane(tab, group, tab.id === group.activeTabId)}
                    </div>
                  ) : null,
                )}
                {active && !isTerminalTab(active.descriptor)
                  ? renderPane(active, group, true)
                  : null}
              </div>
            </section>
          </Fragment>
        );
      })}
      {/* Portalled to `<body>`, not rendered into the strip: every strip is
          `overflow-hidden` — it has to be, so a group narrowed by a split
          clips its tabs rather than spilling them — and a proxy that
          disappears at the edge of the group it came from cannot be carried to
          the group beside it, which is most of what a tab drag is for.

          `pointer-events-none` and no `data-tab-id`: the proxy sits directly
          under the cursor, and either one would have the drag hit-testing
          against the thing it is dragging. */}
      {drag && dragged
        ? createPortal(
            <div
              aria-hidden
              // `aria-hidden` alone over a subtree holding a real `<button
              // role="tab">` — and, for a closable tab, a close button — is the
              // one thing aria-hidden may not do: those buttons stay in the tab
              // order while the proxy is mounted. `inert` is what actually
              // takes them out of it.
              inert
              ref={proxyRef}
              style={{ width: drag.width }}
              className="pointer-events-none fixed left-0 top-0 z-50 opacity-75 shadow-lg"
            >
              {/* Drawn active whatever it was in the strip: a tab held above
                  the page is the foreground thing on screen, and the muted
                  treatment reads as disabled once it is off the strip. */}
              <Tab {...presentTab(dragged.descriptor)} active className="rounded-sm bg-pane" />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
