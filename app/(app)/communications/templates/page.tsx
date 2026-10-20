"use client";

import { useState } from "react";
import { ChevronRightIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { renderTemplate, strayBraces } from "@/services/communications/template-engine";
import { useSessionStore } from "@/stores/session-store";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import {
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_PLACEHOLDERS,
  type MessageTemplate,
  type TemplateCategory,
} from "@/types/communication";
import { useCommunications } from "@/hooks/useCommunications";
import { useRole } from "@/hooks/useRole";
import { useSnapshot } from "@/hooks/use-church-data";
import { useIsMobile } from "@/hooks/use-mobile";

const CATEGORIES = Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[];
const CATEGORY_OPTIONS: SelectOption[] = CATEGORIES.map((option) => ({
  value: option,
  label: TEMPLATE_CATEGORY_LABELS[option],
}));

interface TemplateValues {
  name: string;
  category: TemplateCategory;
  channels: ContactMethod[];
  body: string;
}

type Preview = (body: string) => {
  text: string;
  missing: readonly string[];
  unknown: readonly string[];
  stray: readonly string[];
  sampleName: string;
} | null;

/** Mirrors the server's limits, so nobody types past them. */
const NAME_MAX_LENGTH = 80;
const BODY_MAX_LENGTH = 5_000;

function channelList(channels: readonly ContactMethod[]): string {
  return channels.map((channel) => CONTACT_METHOD_LABELS[channel]).join(", ");
}

/**
 * Message templates, grouped by what they are for. Tapping one shows how it
 * reads for a real person; editing happens in the same panel.
 */
export default function TemplatesPage() {
  const snapshot = useSnapshot();
  const { can, canRun } = useRole();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const isMobile = useIsMobile();
  const { templates, addTemplate, editTemplate, removeTemplate } = useCommunications();

  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new" | null>(null);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);

  if (!can("communications.write")) {
    return (
      <PageShell>
        <RestrictedState section="Message templates" />
      </PageShell>
    );
  }

  // Template changes are church-wide, so only roles that may manage them see
  // the controls. No template command depends on who owns what, so any id
  // answers the question.
  const canManage = canRun("template.delete", { templateId: "" });
  // Signed the way a real message would be: by whoever is writing it.
  const senderName = snapshot.team.find((member) => member.id === teamMemberId)?.name ?? "the church team";
  const sample = snapshot.people.find((person) => person.visitor) ?? snapshot.people[0];
  const preview: Preview = (body) => {
    if (!sample) return null;
    const rendered = renderTemplate(body, {
      person: sample,
      churchName: snapshot.settings.churchName,
      senderName,
      serviceDate: sample.visitor?.firstVisitDate,
      serviceName: "our Sunday service",
      groupName: snapshot.groups[0]?.name,
    });
    return {
      text: rendered.text,
      missing: rendered.missing,
      unknown: rendered.unknown,
      stray: strayBraces(body),
      sampleName: sample.firstName,
    };
  };

  const current = templates.find((template) => template.id === openId) ?? null;
  const close = () => {
    setMode(null);
    setOpenId(null);
  };
  const groups = CATEGORIES.map((category) => ({
    category,
    rows: templates.filter((template) => template.category === category),
  })).filter((group) => group.rows.length > 0);

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PageHeader
        title="Message templates"
        description="Ready-made wording the team can start from. Names and dates fill in from each person's record."
        actions={
          canManage ? (
            <Button size="lg" className="gap-2 rounded-full" onClick={() => setMode("new")}>
              <PlusIcon />
              New template
            </Button>
          ) : null
        }
      />

      {groups.length ? (
        groups.map((group) => (
          <Section key={group.category} title={TEMPLATE_CATEGORY_LABELS[group.category]}>
            <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
              {group.rows.map((template) => {
                const shown = preview(template.body);
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(template.id);
                        setMode("view");
                      }}
                      className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{template.name}</span>
                        <span className="block text-sm text-muted-foreground">
                          {channelList(template.channels)}
                          {template.builtIn ? " · comes with GatherFlow" : ""}
                        </span>
                        {shown ? (
                          <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{shown.text}</span>
                        ) : null}
                      </span>
                      <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))
      ) : (
        <EmptyState
          title="No templates yet"
          description="Add the wording your team uses most, and it will be ready whenever someone prepares a message."
        />
      )}

      <Sheet open={mode !== null} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={
            isMobile
              ? "max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl"
              : "w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg"
          }
        >
          {mode === "view" && current ? (
            <TemplateView
              template={current}
              preview={preview}
              canManage={canManage}
              onEdit={() => setMode("edit")}
              onDelete={() => setDeleting(current)}
            />
          ) : null}
          {mode === "edit" && current && canManage ? (
            <TemplateForm
              key={current.id}
              template={current}
              preview={preview}
              onCancel={() => setMode("view")}
              onConfirm={async (values) => {
                const outcome = await editTemplate(current.id, values);
                if (outcome.ok) setMode("view");
              }}
            />
          ) : null}
          {mode === "new" && canManage ? (
            <TemplateForm
              key="new"
              template={null}
              preview={preview}
              onCancel={close}
              onConfirm={async (values) => {
                const outcome = await addTemplate(values);
                if (outcome.ok) close();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Messages already sent keep their wording."
        confirmLabel="Delete template"
        destructive
        onConfirm={() => {
          if (deleting) removeTemplate(deleting.id);
          setDeleting(null);
          close();
        }}
      />
    </PageShell>
  );
}

function PreviewBox({ preview, body }: { preview: Preview; body: string }) {
  const shown = preview(body);
  if (!shown) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">How it reads for {shown.sampleName}</p>
      <p className="rounded-2xl bg-muted px-4 py-3 whitespace-pre-wrap">{shown.text || " "}</p>
      {shown.missing.length ? (
        <p className="text-sm text-destructive">
          Can&apos;t fill in {shown.missing.map((entry) => `{{${entry}}}`).join(", ")} for {shown.sampleName}. It stays
          visible, so a message is never sent half-written.
        </p>
      ) : null}
      {shown.unknown.length ? (
        <p className="text-sm text-destructive">
          {shown.unknown.map((entry) => `{{${entry}}}`).join(", ")} isn&apos;t a blank GatherFlow knows. Use one of the
          blanks listed under the message, spelt exactly.
        </p>
      ) : null}
      {shown.stray.length ? (
        <p className="text-sm text-destructive">
          {shown.stray.join(", ")} would be sent exactly as typed. Write blanks like {"{{firstName}}"}, or remove the
          braces.
        </p>
      ) : null}
    </div>
  );
}

function TemplateView({
  template,
  preview,
  canManage,
  onEdit,
  onDelete,
}: {
  template: MessageTemplate;
  preview: Preview;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <SheetHeader className="px-5 pt-5 pb-2 pr-12 text-left md:px-6">
        <SheetTitle className="text-2xl">{template.name}</SheetTitle>
        <SheetDescription>
          {TEMPLATE_CATEGORY_LABELS[template.category]} · {channelList(template.channels)}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-5 py-3 md:px-6">
        <PreviewBox preview={preview} body={template.body} />
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">The wording, with its blanks</p>
          <pre className="overflow-x-auto rounded-2xl border px-4 py-3 font-sans text-sm whitespace-pre-wrap">
            {template.body}
          </pre>
        </div>
      </div>
      {canManage ? (
        <div className="mt-auto flex flex-wrap gap-2 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
          <Button size="lg" className="gap-2 rounded-full" onClick={onEdit}>
            <PencilIcon />
            Edit
          </Button>
          {!template.builtIn ? (
            <Button size="lg" variant="ghost" className="gap-2 rounded-full text-destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function TemplateForm({
  template,
  preview,
  onCancel,
  onConfirm,
}: {
  template: MessageTemplate | null;
  preview: Preview;
  onCancel: () => void;
  onConfirm: (values: TemplateValues) => Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [category, setCategory] = useState<TemplateCategory>(template?.category ?? "general_check_in");
  const [channels, setChannels] = useState<ContactMethod[]>(template ? [...template.channels] : ["whatsapp"]);
  const [body, setBody] = useState(template?.body ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    await onConfirm({ name, category, channels, body });
    setSaving(false);
  }

  return (
    <>
      <SheetHeader className="px-5 pt-5 pb-2 pr-12 text-left md:px-6">
        <SheetTitle className="text-2xl">{template ? `Edit ${template.name}` : "New template"}</SheetTitle>
        <SheetDescription>
          Warm and low-pressure works best: a first-time visitor should feel welcomed, not pursued.
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-5 py-3 md:px-6">
        <Field>
          <FieldLabel htmlFor="template-name">Name</FieldLabel>
          <Input
            id="template-name"
            className="h-11"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldDescription>
            {name.length} of {NAME_MAX_LENGTH} characters.
          </FieldDescription>
        </Field>

        <SelectField
          id="template-category"
          label="What it's for"
          value={category}
          onValueChange={(value) => setCategory(value as TemplateCategory)}
          options={CATEGORY_OPTIONS}
        />

        <Field>
          <FieldLabel>Send it by</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {CONTACT_METHODS.map((channel) => (
              <label
                key={channel}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm has-data-checked:border-primary has-data-checked:bg-primary/12"
              >
                <Checkbox
                  checked={channels.includes(channel)}
                  onCheckedChange={(checked) =>
                    setChannels((previous) =>
                      checked === true ? [...previous, channel] : previous.filter((entry) => entry !== channel),
                    )
                  }
                />
                {CONTACT_METHOD_LABELS[channel]}
              </label>
            ))}
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="template-body">Message</FieldLabel>
          <Textarea
            id="template-body"
            rows={7}
            value={body}
            maxLength={BODY_MAX_LENGTH}
            onChange={(event) => setBody(event.target.value)}
          />
          <FieldDescription>
            Blanks you can use: {TEMPLATE_PLACEHOLDERS.map((entry) => `{{${entry}}}`).join(", ")}. {body.length} of{" "}
            {BODY_MAX_LENGTH} characters.
          </FieldDescription>
        </Field>

        {body.trim() ? <PreviewBox preview={preview} body={body} /> : null}
      </div>
      <div className="mt-auto flex flex-wrap gap-2 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
        <Button
          size="lg"
          className="rounded-full"
          disabled={saving || !name.trim() || !body.trim() || !channels.length}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save template"}
        </Button>
        <Button size="lg" variant="ghost" className="rounded-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
