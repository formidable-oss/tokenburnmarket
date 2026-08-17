"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { countries } from "@/lib/countries";
import { saveSettings, type SettingsState } from "./actions";

/*
  The only interactive island on the page: it keeps the result of the action next
  to the fields instead of bouncing through a query string. The X handle carries a
  native pattern so a typo is caught before the round trip; the server checks again.
*/

const initialState: SettingsState = { status: "idle" };

const field =
  "mt-2 h-10 w-full rounded-(--radius-control) border border-border bg-surface-sunken px-3 text-sm " +
  "text-foreground placeholder:text-subtle";

export function SettingsForm({
  country,
  xHandle,
}: {
  country: string | null;
  xHandle: string | null;
}) {
  const [state, action, pending] = useActionState(saveSettings, initialState);

  return (
    <form action={action} className="max-w-[26rem]">
      <label className="block" htmlFor="country">
        <span className="type-label">country</span>
        <select
          id="country"
          name="country"
          defaultValue={country ?? ""}
          className={`${field} type-data`}
        >
          <option value="">Not set</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-[0.82rem] text-subtle">
        Your country is your Region: it picks which boards and markets you show up on.
      </p>
      {state.fieldErrors?.country ? (
        <p className="mt-2 text-[0.82rem] text-[color:var(--destructive)]">
          {state.fieldErrors.country}
        </p>
      ) : null}

      <label className="mt-7 block" htmlFor="xHandle">
        <span className="type-label">x handle, optional</span>
        <input
          id="xHandle"
          name="xHandle"
          defaultValue={xHandle ?? ""}
          pattern="@?[A-Za-z0-9_]{1,15}"
          title="Letters, digits and underscore, up to 15 characters."
          placeholder="formidablebldrs"
          autoComplete="off"
          spellCheck={false}
          className={`${field} type-data`}
        />
      </label>
      <p className="mt-2 text-[0.82rem] text-subtle">
        Shown on your profile. Nothing is posted for you.
      </p>
      {state.fieldErrors?.xHandle ? (
        <p className="mt-2 text-[0.82rem] text-[color:var(--destructive)]">
          {state.fieldErrors.xHandle}
        </p>
      ) : null}

      <div className="mt-8 flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
        <span
          aria-live="polite"
          className={`type-data text-[0.82rem] ${state.status === "saved" ? "text-muted" : "text-[color:var(--destructive)]"}`}
        >
          {state.status === "idle" ? "" : state.message}
        </span>
      </div>
    </form>
  );
}
