---
category: Navigation
---

Full application sidebar system. `SidebarProvider` supplies collapse state (read it with `useSidebar`) and must wrap both `Sidebar` and `SidebarInset` (the main content area). Inside: `SidebarHeader`/`SidebarContent`/`SidebarFooter`, with `SidebarGroup` sections holding `SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton`. `SidebarTrigger` toggles it and `SidebarRail` gives an edge drag target.
