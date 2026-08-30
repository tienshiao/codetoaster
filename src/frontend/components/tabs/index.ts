// The VSCode-style tab area (§7.1, §7.2). Composed from the v2 design system's
// `TabStrip`; driven by the pure layout store.
export { TabArea } from "./TabArea";
export type { TabAreaProps } from "./TabArea";

export { presentTab, basename } from "./tab-labels";
export type { TabPresentation } from "./tab-labels";

export { useTaskLayout } from "./use-task-layout";

export { TabPane } from "./panes";
export type { TabPaneProps } from "./panes";

export { dropIndexAt, moveIndexFor, resizeFlex } from "./drag";
export type { TabBox } from "./drag";
