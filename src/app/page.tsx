import { Dashboard } from "@/components/dashboard"
import { readAttendees, readSent } from "@/lib/attendees"
import { readHistory, usingDemoData } from "@/lib/data"

// L'historique est lu sur le disque à chaque requête : sans ça, `next build`
// figerait les chiffres du jour du build et le dashboard ne bougerait plus.
export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <Dashboard
      snapshots={readHistory()}
      isDemo={usingDemoData}
      // Absents en démo : ce sont des données personnelles réelles, elles n'ont
      // pas d'équivalent fictif et n'ont rien à faire dans une capture d'écran.
      attendees={usingDemoData ? [] : readAttendees()}
      sent={usingDemoData ? {} : readSent()}
    />
  )
}
