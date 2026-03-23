import { Button } from "@/components/ui/button";

export function InstallCallout({ canInstall, installHelp, isInstalled, onInstall, variant = "panel" }) {
  if (isInstalled) {
    return null;
  }

  const panelClassName =
    variant === "compact"
      ? "rounded-[24px] border border-[#E8E4DB] bg-white/70 p-4"
      : "glass-panel rounded-[24px] p-4";

  return (
    <div className={panelClassName} data-testid="install-callout">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="editorial-label">Install app</p>
          <p className="mt-2 text-sm leading-relaxed text-[#4A4844]">
            Save Memory Capsule to your home screen so it opens like a real app on your phone.
          </p>
        </div>

        <Button
          className="h-11 rounded-2xl border border-[#E8E4DB] bg-white/85 px-5 text-[#1A1918] hover:bg-[#F2EFE9]"
          data-testid="install-app-button"
          disabled={!canInstall}
          onClick={onInstall}
          type="button"
          variant="outline"
        >
          {canInstall ? "Add to home screen" : "Use steps below"}
        </Button>
      </div>

      {!canInstall ? (
        <div className="mt-4 rounded-[20px] bg-[#F2EFE9] px-4 py-3 text-sm text-[#4A4844]">
          <p className="editorial-label text-[#1A1918]">Install on {installHelp.platform}</p>
          {installHelp.note ? <p className="mt-2 leading-relaxed">{installHelp.note}</p> : null}
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {installHelp.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
