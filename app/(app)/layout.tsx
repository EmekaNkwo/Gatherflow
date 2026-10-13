import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ChurchDataProvider } from "@/components/providers/church-data-provider";
import { DataNotices } from "@/components/providers/data-notices";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * The operations shell: persistent sidebar on desktop, drawer on mobile.
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
          <main className="min-w-0 flex-1">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </ChurchDataProvider>
  );
}
