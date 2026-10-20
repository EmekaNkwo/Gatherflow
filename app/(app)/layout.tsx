import type { ReactNode } from "react";
import { AddMemberDialog } from "@/components/members/add-member-dialog";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { WelcomeDialog } from "@/components/visitors/welcome-dialog";
import { ChurchDataProvider } from "@/components/providers/church-data-provider";
import { DataNotices } from "@/components/providers/data-notices";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * The operations shell: persistent sidebar on desktop; on a phone, a tab bar
 * at the bottom and the sidebar as a drawer behind its Menu tab.
 *
 * Church data loads once here, so every page below can rely on it being
 * present.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ChurchDataProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AppHeader />
          <DataNotices />
          {/* Room at the bottom on phones, so the tab bar never covers the last row. */}
          <main className="min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
          <BottomNav />
          <WelcomeDialog />
          <AddMemberDialog />
        </SidebarInset>
      </SidebarProvider>
    </ChurchDataProvider>
  );
}
