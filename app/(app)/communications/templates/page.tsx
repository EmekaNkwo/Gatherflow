"use client";

import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { SimulatedBadge } from "@/components/shared/badges";
import { renderTemplate } from "@/services/communications/template-engine";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import {
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_PLACEHOLDERS,
  type MessageTemplate,
  type TemplateCategory,
} from "@/types/communication";
import { useCommunications } from "@/hooks/useCommunications";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useSnapshot } from "@/hooks/use-church-data";

/** Reusable message wording, with a live preview of the finished message. */
export default function TemplatesPage() {
  const snapshot = useSnapshot();
  const { can } = useDemoRole();
  const { templates, addTemplate, editTemplate, removeTemplate } = useCommunications();

  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);

  if (!can("communications.write")) {
    return (
      <PageShell>
        <RestrictedState section="Message templates" />
      </PageShell>
    );
  }

  const sample = snapshot.people.find((person) => person.visitor) ?? snapshot.people[0];

  return (
    <PageShell>
      <PageHeader
        title="Message templates"
        description="Wording the team can reuse. Placeholders are filled from the person's own record, and anything that cannot be filled stays visible so it is never sent half-written."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <PlusIcon />
            New template
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => {
          const preview = sample
            ? renderTemplate(template.body, {
                person: sample,
                churchName: snapshot.settings.churchName,
                senderName: "Grace Mensah",
                serviceDate: sample.visitor?.firstVisitDate,
                serviceName: "our Sunday service",
                groupName: snapshot.groups[0]?.name,
              })
            : null;

          return (
            <Card key={template.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  {template.name}
                  <span className="flex items-center gap-1.5">
                    {template.builtIn ? <Badge variant="outline">Built-in</Badge> : null}
                    <SimulatedBadge />
                  </span>
                </CardTitle>
                <CardDescription>
                  {TEMPLATE_CATEGORY_LABELS[template.category]} ·{" "}
                  {template.channels.map((channel) => CONTACT_METHOD_LABELS[channel]).join(", ")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                  {template.body}
                </pre>

                {preview ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Preview for {sample ? sample.firstName : "a visitor"}
                    </p>
                    <p className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
                      {preview.text}
                    </p>
                    {preview.missing.length ? (
                      <p className="text-xs text-destructive">
                        Could not fill: {preview.missing.map((entry) => `{{${entry}}}`).join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setEditing(template)}
                  >
                    <PencilIcon />
                    Edit
                  </Button>
                  {!template.builtIn ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setDeleting(template)}
                    >
                      <Trash2Icon />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <TemplateDialog
        open={creating || editing !== null}
        template={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onConfirm={(values) => {
          const outcome = editing ? editTemplate(editing.id, values) : addTemplate(values);
          if (outcome.ok) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Messages already recorded in the communication history keep their text."
        confirmLabel="Delete template"
        destructive
        onConfirm={() => {
          if (deleting) removeTemplate(deleting.id);
          setDeleting(null);
        }}
      />
    </PageShell>
  );
}

interface TemplateValues {
  name: string;
  category: TemplateCategory;
  channels: ContactMethod[];
  body: string;
}

function TemplateDialog({
  open,
  template,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  template: MessageTemplate | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: TemplateValues) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{template ? `Edit ${template.name}` : "New template"}</DialogTitle>
          <DialogDescription>
            Available placeholders: {TEMPLATE_PLACEHOLDERS.map((entry) => `{{${entry}}}`).join(", ")}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <TemplateFields
            key={template?.id ?? "new"}
            template={template}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TemplateFields({
  template,
  onCancel,
  onConfirm,
}: {
  template: MessageTemplate | null;
  onCancel: () => void;
  onConfirm: (values: TemplateValues) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [category, setCategory] = useState<TemplateCategory>(
    template?.category ?? "general_check_in",
  );
  const [channels, setChannels] = useState<ContactMethod[]>(
    template ? [...template.channels] : ["whatsapp"],
  );
  const [body, setBody] = useState(template?.body ?? "");

  return (
    <>
      <Field>
        <FieldLabel htmlFor="template-name">Name</FieldLabel>
        <Input
          id="template-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="template-category">Category</FieldLabel>
        <NativeSelect
          className="w-full"
          id="template-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as TemplateCategory)}
        >
          {(Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]).map((option) => (
            <NativeSelectOption key={option} value={option}>
              {TEMPLATE_CATEGORY_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel>Channels</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {CONTACT_METHODS.map((channel) => (
            <label
              key={channel}
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm has-data-checked:border-primary has-data-checked:bg-muted/50"
            >
              <Checkbox
                checked={channels.includes(channel)}
                onCheckedChange={(checked) =>
                  setChannels((previous) =>
                    checked === true
                      ? [...previous, channel]
                      : previous.filter((entry) => entry !== channel),
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
          rows={8}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <FieldDescription>
          Warm and low-pressure works best: a first-time visitor should feel welcomed, not pursued.
        </FieldDescription>
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!name.trim() || !body.trim() || !channels.length}
          onClick={() => onConfirm({ name, category, channels, body })}
        >
          Save template
        </Button>
      </DialogFooter>
    </>
  );
}
