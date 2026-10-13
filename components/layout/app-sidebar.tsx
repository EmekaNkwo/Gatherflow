"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChurchIcon, QrCodeIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useSnapshot } from "@/hooks/use-church-data";
import { isActive, NAV_SECTIONS } from "./nav-config";

/**
 * Persistent navigation on desktop; the shadcn sidebar turns this into a
 * drawer on small screens. Sections the active demo role cannot use are
 * hidden rather than shown as dead ends.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { can } = useDemoRole();
  const snapshot = useSnapshot();
  const { counts } = useFollowUps();

  const badges: Record<string, number> = {
    "/follow-ups/tasks": counts.dueToday,
    "/follow-ups/my-tasks": counts.dueToday,
    "/follow-ups": counts.overdue,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ChurchIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">GatherFlow</span>
                <span className="truncate text-xs text-muted-foreground">
                  {snapshot.settings.churchName}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter(
            (item) => !item.capabilities || item.capabilities.some(can),
          );
          if (!items.length) return null;

          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const badge = badges[item.href];
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={isActive(pathname, item)}
                          tooltip={item.label}
                          render={<Link href={item.href} />}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {badge ? <SidebarMenuBadge>{badge}</SidebarMenuBadge> : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Visitor welcome page"
              render={<Link href="/connect" target="_blank" />}
            >
              <QrCodeIcon />
              <span>Visitor welcome page</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
