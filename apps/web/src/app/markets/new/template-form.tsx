"use client";

/*
  One form for all four templates. The fields differ, the shape does not: who it
  is about, and which week. Nothing here writes a question or an outcome label;
  those come back from the server, generated from the template.

  The community select drives the member selects, which is the only reason this
  is a client component.
*/

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Country } from "@/lib/countries";
import { PERIOD_CHOICES, PERIOD_CHOICE_LABELS } from "@/lib/market-templates";
import { createMarket, type CreateMarketState } from "./actions";

const initialState: CreateMarketState = { status: "idle" };

const field =
  "mt-2 w-full rounded-(--radius-control) border border-border bg-surface-sunken px-3 text-sm " +
  "text-foreground placeholder:text-subtle";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-[0.82rem] text-[color:var(--destructive)]">{message}</p>;
}

export interface FormCommunity {
  id: string;
  name: string;
  members: { builderId: string; handle: string }[];
}

export function TemplateForm({
  template,
  communities,
  models,
  countries,
}: {
  template: "top_burner" | "threshold" | "head_to_head" | "model_race";
  communities: readonly FormCommunity[];
  models: readonly string[];
  countries: readonly Country[];
}) {
  const [state, action, pending] = useActionState(createMarket, initialState);
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? "");

  const community = communities.find((row) => row.id === communityId);
  const members = community?.members ?? [];
  const needsCommunity = template !== "model_race";

  if (needsCommunity && communities.length === 0) {
    return (
      <p className="mt-8 max-w-[46ch] text-[0.95rem] text-muted">
        You are not in a community that lets you open markets yet. Join one, or ask its owner.
      </p>
    );
  }

  return (
    <form action={action} className="mt-8 max-w-[30rem]">
      <input type="hidden" name="template" value={template} />

      {needsCommunity ? (
        <label className="block" htmlFor="communityId">
          <span className="type-label">community</span>
          <select
            id="communityId"
            name="communityId"
            className={`${field} h-10`}
            value={communityId}
            onChange={(event) => setCommunityId(event.target.value)}
          >
            {communities.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block" htmlFor="where">
          <span className="type-label">where</span>
          <select id="where" name="where" className={`${field} h-10`} defaultValue="global">
            <option value="global">The whole world</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <FieldError message={state.fieldErrors?.community ?? state.fieldErrors?.scope} />

      {template === "threshold" ? (
        <>
          <label className="mt-7 block" htmlFor="builderId">
            <span className="type-label">who</span>
            <select id="builderId" name="builderId" className={`${field} h-10`}>
              {members.map((member) => (
                <option key={member.builderId} value={member.builderId}>
                  @{member.handle}
                </option>
              ))}
            </select>
          </label>
          <FieldError message={state.fieldErrors?.builder} />

          <label className="mt-7 block" htmlFor="costUsd">
            <span className="type-label">amount, usd</span>
            <input
              id="costUsd"
              name="costUsd"
              type="number"
              min="1"
              step="1"
              required
              defaultValue="50"
              className={`${field} type-data h-10 tabular-nums`}
            />
          </label>
          <p className="mt-2 text-[0.85rem] text-subtle">
            Usage cost over the week, as the leaderboard counts it.
          </p>
          <FieldError message={state.fieldErrors?.amount} />
        </>
      ) : null}

      {template === "head_to_head" ? (
        <>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="builderA">
              <span className="type-label">first</span>
              <select id="builderA" name="builderA" className={`${field} h-10`}>
                {members.map((member) => (
                  <option key={member.builderId} value={member.builderId}>
                    @{member.handle}
                  </option>
                ))}
              </select>
            </label>
            <label className="block" htmlFor="builderB">
              <span className="type-label">second</span>
              <select
                id="builderB"
                name="builderB"
                className={`${field} h-10`}
                defaultValue={members[1]?.builderId}
              >
                {members.map((member) => (
                  <option key={member.builderId} value={member.builderId}>
                    @{member.handle}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <FieldError message={state.fieldErrors?.builder} />
        </>
      ) : null}

      {template === "top_burner" ? (
        <p className="mt-7 max-w-[46ch] text-[0.9rem] text-muted">
          Every member gets an outcome, up to seven. The last one is &ldquo;someone else&rdquo;, so
          anyone who joins mid-week still has a price.
        </p>
      ) : null}

      {template === "model_race" ? (
        <div className="mt-7">
          <p className="type-label">runners</p>
          <p className="type-data mt-2 text-[0.85rem] text-muted">
            {models.join(", ")}, another model
          </p>
          <p className="mt-2 text-[0.85rem] text-subtle">
            Taken from what people are burning now. Fixed when the market opens.
          </p>
        </div>
      ) : null}

      <fieldset className="mt-7">
        <legend className="type-label">week</legend>
        <div className="mt-2 flex gap-6">
          {PERIOD_CHOICES.map((choice, index) => (
            <label key={choice} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="period"
                value={choice}
                defaultChecked={index === 0}
                className="accent-[color:var(--primary)]"
              />
              {PERIOD_CHOICE_LABELS[choice]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[0.85rem] text-subtle">
          Monday to Sunday UTC. Trading stops when the week does.
        </p>
      </fieldset>
      <FieldError message={state.fieldErrors?.period} />

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
