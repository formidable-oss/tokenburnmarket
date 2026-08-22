import Link from "next/link";
import type { ModelUsagePreviewData } from "@/lib/landing";

export function ModelUsagePreview({ data }: { data: ModelUsagePreviewData }) {
  return (
    <section
      aria-label={data.live ? "Live global model usage" : "Global model usage"}
      className="relative rounded-(--radius-panel) border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {data.live ? <span aria-hidden className="ember-pulse size-1.5 rounded-full bg-ember" /> : null}
        <span className="type-label whitespace-nowrap text-[0.66rem]">
          {data.live ? "live · " : ""}{data.where}
        </span>
        <span className="type-data ml-auto whitespace-nowrap text-[0.72rem] text-subtle">
          {data.total}
        </span>
      </div>

      <h2 className="type-heading mt-4">{data.question}</h2>

      {data.models.length > 0 ? (
        <ol className="mt-5 space-y-3">
          {data.models.map((model) => (
            <li key={model.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
              <span className="min-w-0 truncate text-[0.95rem]">{model.label}</span>
              <span className="type-data text-[0.9rem] text-muted">{model.value}</span>
              <div className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
                <div
                  className="h-full rounded-sm bg-primary"
                  style={{ width: `${model.share * 100}%` }}
                  aria-hidden
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 text-[0.95rem] text-muted">No synced model usage yet.</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="type-label text-[0.66rem]">{data.source}</span>
        <Link
          href="/markets"
          className="ml-auto inline-flex h-9 items-center rounded-(--radius-control) bg-primary px-3.5 text-sm font-medium text-primary-foreground"
        >
          Model markets
        </Link>
      </div>
    </section>
  );
}
