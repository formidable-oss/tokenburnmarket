"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { BIO_MAX, NAME_MAX, SLUG_MAX, suggestSlug } from "@/lib/communities";
import { createCommunity, type CreateState } from "../actions";

/*
  The slug follows the name until the person edits it, then it is theirs. The same
  suggestSlug runs on the server for the stored value, so the preview never lies.
*/

const initialState: CreateState = { status: "idle" };

const field =
  "mt-2 w-full rounded-(--radius-control) border border-border bg-surface-sunken px-3 text-sm " +
  "text-foreground placeholder:text-subtle";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-[0.82rem] text-[color:var(--destructive)]">{message}</p>;
}

export function NewCommunityForm() {
  const [state, action, pending] = useActionState(createCommunity, initialState);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="mt-8 max-w-[28rem]">
      <label className="block" htmlFor="name">
        <span className="type-label">name</span>
        <input
          id="name"
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          placeholder="Late Night Agents"
          onChange={(event) => {
            if (!slugEdited) setSlug(suggestSlug(event.target.value));
          }}
          className={`${field} h-10`}
        />
      </label>
      <FieldError message={state.fieldErrors?.name} />

      <label className="mt-7 block" htmlFor="slug">
        <span className="type-label">slug</span>
        <input
          id="slug"
          name="slug"
          required
          value={slug}
          maxLength={SLUG_MAX}
          pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
          title="Lowercase letters, digits and hyphens."
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          className={`${field} type-data h-10`}
        />
      </label>
      <p className="type-data mt-2 text-[0.82rem] text-subtle">/c/{slug || "your-slug"}</p>
      <FieldError message={state.fieldErrors?.slug} />

      <label className="mt-7 block" htmlFor="bio">
        <span className="type-label">bio, optional</span>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={BIO_MAX}
          placeholder="Who this is for, in one line."
          className={`${field} py-2`}
        />
      </label>
      <FieldError message={state.fieldErrors?.bio} />

      <fieldset className="mt-7">
        <legend className="type-label">visibility</legend>
        <label className="mt-3 flex items-start gap-3" htmlFor="visibility-public">
          <input
            id="visibility-public"
            type="radio"
            name="visibility"
            value="public"
            defaultChecked
            className="mt-1 accent-[color:var(--primary)]"
          />
          <span className="text-[0.92rem]">
            Public
            <span className="block text-[0.85rem] text-subtle">
              Listed in the directory. Anyone can read the page, joining still needs the link.
            </span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3" htmlFor="visibility-unlisted">
          <input
            id="visibility-unlisted"
            type="radio"
            name="visibility"
            value="unlisted"
            className="mt-1 accent-[color:var(--primary)]"
          />
          <span className="text-[0.92rem]">
            Unlisted
            <span className="block text-[0.85rem] text-subtle">
              Not in the directory, not indexed by search engines. Reachable only by URL.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="mt-8 flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating" : "Create community"}
        </Button>
        <span aria-live="polite" className="type-data text-[0.82rem] text-[color:var(--destructive)]">
          {state.status === "error" ? state.message : ""}
        </span>
      </div>
    </form>
  );
}
