"use client";

import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlaskConicalIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataTable, TextCell, type GatherFlowColumn } from "@/components/shared/data-table";
import { EmptyState, NoResultsState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { SimulatedBadge } from "@/components/shared/badges";
import { StatTile } from "@/components/shared/metric-card";
import { formatDisplayDateTime } from "@/lib/dates";
import { normalise } from "@/lib/strings";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import {
  COMMUNICATION_STATUS_LABELS,
  type CommunicationStatus,
} from "@/types/communication";
import { useCommunications } from "@/hooks/useCommunications";
import { useDemoRole } from "@/hooks/useDemoRole";

type HistoryRow = ReturnType<typeof useCommunications>["history"][number];

/**
 * What has been sent — or rather, what has actually happened to each
 * message. The application cannot verify delivery, so it never claims it.
 */
export default function CommunicationHistoryPage() {
  const { can } = useDemoRole();
  const { history } = useCommunications();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CommunicationStatus | "">("");

  const rows = useMemo(() => {
    const needle = normalise(search);
    return history.filter((entry) => {
      if (status && entry.entry.status !== status) return false;
      if (!needle) return true;
      return normalise(
        `${entry.person?.firstName ?? ""} ${entry.person?.lastName ?? ""} ${entry.entry.body}`,
      ).includes(needle);
    });
  }, [history, search, status]);

  const columns = useMemo<GatherFlowColumn<HistoryRow>[]>(
    () => [
      {
        id: "person",
        header: "Person",
        accessorFn: (row) => row.person?.lastName ?? "",
        cell: ({ row }) =>
          row.original.person ? (
            <PersonCell
              person={row.original.person}
              href={personHref(row.original.person)}
              showOptOut={false}
            />
          ) : (
            <TextCell value="Record deleted" />
          ),
      },
      {
        id: "status",
        header: "What happened",
        accessorFn: (row) => row.entry.status,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline">
              {COMMUNICATION_STATUS_LABELS[row.original.entry.status]}
            </Badge>
          </div>
        ),
      },
      {
        id: "channel",
        header: "Channel",
        accessorFn: (row) => row.entry.channel,
        cell: ({ row }) => (
          <TextCell value={CONTACT_METHOD_LABELS[row.original.entry.channel]} />
        ),
      },
      {
        id: "when",
        header: "When",
        accessorFn: (row) => row.entry.at,
        cell: ({ row }) => <TextCell value={formatDisplayDateTime(row.original.entry.at)} />,
      },
      {
        id: "by",
        header: "By",
        accessorFn: (row) => row.actor?.name ?? "",
        cell: ({ row }) => <TextCell value={row.original.actor?.name} />,
      },
      {
        id: "message",
        header: "Message",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-md truncate text-sm text-muted-foreground">
            {row.original.entry.body}
          </p>
        ),
      },
    ],
    [],
  );

  if (!can("communications.write")) {
    return (
      <PageShell>
        <RestrictedState section="Communication history" />
      </PageShell>
    );
  }

  const counts = history.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.entry.status] = (acc[entry.entry.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <PageShell>
      <PageHeader
        title="Communication history"
        description="Every message GatherFlow has helped prepare, and what was done with it."
        actions={<SimulatedBadge />}
      />

      <Alert>
        <FlaskConicalIcon />
        <AlertTitle>No message is ever actually sent</AlertTitle>
        <AlertDescription>
          GatherFlow drafts text, copies it to your clipboard, or hands it to an app you already
          have. &ldquo;Simulated send&rdquo; records that the demo pretended to send it. Real
          delivery through SMS, email or WhatsApp needs a backend this project deliberately does
          not have.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Drafted" value={counts.drafted ?? 0} />
        <StatTile label="Copied" value={counts.copied ?? 0} />
        <StatTile label="Opened externally" value={counts.opened_external ?? 0} />
        <StatTile label="Simulated sends" value={counts.simulated_sent ?? 0} />
      </div>

      <DataTable
        label="Communication history"
        columns={columns}
        data={rows}
        getRowId={(row) => row.entry.id}
        toolbar={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search person or message text"
              className="w-full sm:w-72"
              aria-label="Search communication history"
            />
            <NativeSelect
              value={status}
              onChange={(event) => setStatus(event.target.value as CommunicationStatus | "")}
              aria-label="Filter by what happened"
            >
              <NativeSelectOption value="">Anything</NativeSelectOption>
              {(Object.keys(COMMUNICATION_STATUS_LABELS) as CommunicationStatus[]).map(
                (option) => (
                  <NativeSelectOption key={option} value={option}>
                    {COMMUNICATION_STATUS_LABELS[option]}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </>
        }
        emptyState={
          search || status ? (
            <NoResultsState
              context="messages"
              onClear={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setStatus("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No messages yet"
              description="Prepare a message from a visitor or member record and it will appear here."
            />
          )
        }
      />
    </PageShell>
  );
}
