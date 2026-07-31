import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type StatTileProps = {
  label: string
  /** Le chiffre-héros. Rendu en ≥48px : c'est ce que l'œil doit attraper en premier. */
  value: string | number
  /** Variation sur la plage sélectionnée. Signe porté par le texte, pas par la couleur seule. */
  delta?: { value: number; suffix?: string } | null
  hint?: string
}

export function StatTile({ label, value, delta, hint }: StatTileProps) {
  return (
    <Card className="gap-0 py-5">
      <CardContent className="px-5">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <p className="mt-1 text-5xl leading-none font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <div className="text-muted-foreground mt-2 flex min-h-5 items-baseline gap-2 text-sm">
          {delta && (
            <span
              className={cn(
                "font-medium tabular-nums",
                delta.value > 0 && "text-chart-6",
                delta.value < 0 && "text-destructive",
              )}
            >
              {/* Le glyphe porte le sens, la couleur ne fait que renforcer. */}
              {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "—"}{" "}
              {delta.value > 0 ? "+" : ""}
              {delta.value}
              {delta.suffix ?? ""}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
