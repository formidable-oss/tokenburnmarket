"use client";

/*
  The smallest form that opens a tradeable Market: a question, the answers, and
  when it stops taking trades. Outcome slots grow one at a time up to the cap,
  so the form starts as two fields and never as eight empty ones.
*/

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MAX_OUTCOMES,
  MIN_OUTCOMES,
  OUTCOME_LABEL_MAX,
  QUESTION_MAX,
} from "@/lib/markets";
import { createMarket, type CreateMarketState } from "./actions";

const initialState: CreateMarketState = { status: "idle" };

const field =
  "mt-2 w-full rounded-(--radius-control) border border-border bg-surface-sunken px-3 text-sm " +
  "text-foreground placeholder:text-subtle";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-[0.82rem] text-[color:var(--destructive)]">{message}</p>;
}

export function NewMarketForm({
  communities,
}: {
  communities: readonly { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createMarket, initialState);
  const [slots, setSlots] = useState(MIN_OUTCOMES);

  return (
    <form action={action} className="mt-8 max-w-[30rem]">
      <label className="block" htmlFor="question">
        <span className="type-label">question</span>
        <input
          id="question"
          name="question"
          required
          maxLength={QUESTION_MAX}
          autoComplete="off"
          placeholder="Who burns most this week?"
          className={`${field} h-10`}
        />
      </label>
      <FieldError message={state.fieldErrors?.question} />

      <fieldset className="mt-7">
        <legend className="type-label">outcomes</legend>
        <p className="mt-2 text-[0.85rem] text-subtle">
          Exactly one of these will be true. Prices always add up to 1.
        </p>
        {Array.from({ length: slots }, (_, index) => (
          <input
            key={index}
            name={`outcome-${index}`}
            aria-label={`Outcome ${index + 1}`}
            required={index < MIN_OUTCOMES}
            maxLength={OUTCOME_LABEL_MAX}
            autoComplete="off"
            placeholder={index === 0 ? "@alex" : index === 1 ? "@theo" : "someone else"}
            className={`${field} h-10`}
          />
        ))}
        {slots < MAX_OUTCOMES ? (
          <button
            type="button"
            onClick={() => setSlots((current) => current + 1)}
            className="type-label mt-3 text-subtle hover:text-foreground"
          >
            add outcome
          </button>
        ) : null}
      </fieldset>
      <FieldError message={state.fieldErrors?.outcomes} />

      <label className="mt-7 block" htmlFor="closesAt">
        <span className="type-label">closes at, UTC</span>
        <input
          id="closesAt"
          name="closesAt"
          type="datetime-local"
          required
          className={`${field} type-data h-10`}
        />
      </label>
      <p className="mt-2 text-[0.85rem] text-subtle">
        Trading stops then. Usage is read a day later, so a late sync still counts.
      </p>
      <FieldError message={state.fieldErrors?.closesAt} />

      <label className="mt-7 block" htmlFor="communityId">
        <span className="type-label">where</span>
        <select id="communityId" name="communityId" className={`${field} h-10`} defaultValue="">
          <option value="">Global, anyone can trade it</option>
          {communities.map((community) => (
            <option key={community.id} value={community.id}>
              {community.name}
            </option>
          ))}
        </select>
      </label>
      <FieldError message={state.fieldErrors?.scope} />

      <div className="mt-8 flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Opening" : "Open market"}
        </Button>
        <span aria-live="polite" className="type-data text-[0.82rem] text-[color:var(--destructive)]">
          {state.status === "error" ? state.message : ""}
        </span>
      </div>
    </form>
  );
}
