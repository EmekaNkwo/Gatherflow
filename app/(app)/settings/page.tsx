"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditTrailCard } from "@/components/settings/audit-trail-card";
import { AutomationSettings } from "@/components/settings/automation-settings";
import { ChurchSettings } from "@/components/settings/church-settings";
import { PipelineSettings, TeamSettings } from "@/components/settings/team-settings";
import { RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { useRole } from "@/hooks/useRole";

const TABS = [
  { value: "church", label: "Church" },
  { value: "automation", label: "Automation" },
  { value: "pipeline", label: "Pipeline" },
  { value: "team", label: "Team" },
  { value: "audit", label: "Audit" },
] as const;

/**
 * Settings: one calm form per tab. Each tab explains itself once, and the
 * rarely changed details open on request.
 */
export default function SettingsPage() {
  const { can } = useRole();
  const settings = useChurchSettings();

  if (!can("settings.write")) {
    return (
      <PageShell>
        <RestrictedState section="Settings" />
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-4xl">
      <PageHeader title="Settings" description="How your church works in GatherFlow, and who can use it." />

      <Tabs defaultValue="church" className="gap-6">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="h-auto gap-1 rounded-full p-1 group-data-horizontal/tabs:h-auto">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="min-h-10 flex-none rounded-full px-4">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="church" keepMounted>
          <ChurchSettings settings={settings} />
        </TabsContent>
        <TabsContent value="automation">
          <AutomationSettings settings={settings} />
        </TabsContent>
        <TabsContent value="pipeline">
          <PipelineSettings settings={settings} />
        </TabsContent>
        <TabsContent value="team">
          <TeamSettings settings={settings} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTrailCard />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
