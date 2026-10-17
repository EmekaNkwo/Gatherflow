"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRightIcon, CircleUserIcon, LogOutIcon, QrCodeIcon } from "lucide-react";
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
import { useRole } from "@/hooks/useRole";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useNotifications } from "@/hooks/useNotifications";
import { postSignOut } from "@/services/commands/client";
import { useSnapshot } from "@/hooks/use-church-data";
import { useChurchStore } from "@/stores/church-store";
import { BrandMark } from "./brand-mark";
import { isActive, isVisible, NAV_SECTIONS } from "./nav-config";

/**
 * Persistent navigation on desktop; on a phone it is the drawer behind the
 * tab bar's "Menu". Items a role cannot use are hidden rather than shown as
 * dead ends, and volunteers see a short menu (see `isVisible`).
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { can } = useRole();
  const snapshot = useSnapshot();
  const churchId = useChurchStore((state) => state.churchId);
  const memberships = useChurchStore((state) => state.memberships);
  const { counts } = useFollowUps();
  const { mine } = useNotifications();

  const badges: Record<string, number> = {
    "/follow-ups/my-tasks": mine.dueToday.length + mine.overdue.length,
    "/follow-ups/tasks": counts.dueToday + counts.overdue,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <BrandMark className="size-8" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-heading text-base">{snapshot.settings.churchName}</span>
                <span className="truncate text-xs text-muted-foreground">GatherFlow</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => isVisible(item, can));
          if (!items.length) return null;

          return (
            <SidebarGroup key={section.label ?? "main"}>
              {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
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
              render={<Link href={churchId ? `/connect/${churchId}` : "/connect"} target="_blank" />}
            >
              <QrCodeIcon />
              <span>Visitor welcome page</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {memberships > 1 ? (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Switch church" render={<Link href="/choose-church" />}>
                <ArrowLeftRightIcon />
                <span>Switch church</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/account"}
              tooltip="Your account"
              render={<Link href="/account" />}
            >
              <CircleUserIcon />
              <span>Your account</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={() => {
                // A full load so the in-memory church does not outlive the session.
                void postSignOut().then(() => {
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  window.location.assign("/sign-in");
                });
              }}
            >
              <LogOutIcon />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
