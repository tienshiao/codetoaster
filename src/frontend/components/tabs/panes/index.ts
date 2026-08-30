// The tab hosts (§7.2): one component per `TabDescriptor` kind, each thin —
// resolve the view key, pull the slot, render the component that already knows
// how to draw the thing.
export { TabPane } from "./TabPane";
export type { TabPaneProps } from "./TabPane";

export { CommitPane } from "./CommitPane";
export { DiffFilePane } from "./DiffFilePane";
export { FilePane } from "./FilePane";
export { HistoryPane } from "./HistoryPane";
