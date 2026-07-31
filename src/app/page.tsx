import { Dashboard } from "@/components/dashboard"
import { readHistory, usingDemoData } from "@/lib/data"

// L'historique est lu sur le disque à chaque requête : sans ça, `next build`
// figerait les chiffres du jour du build et le dashboard ne bougerait plus.
export const dynamic = "force-dynamic"

export default function Page() {
  return <Dashboard snapshots={readHistory()} isDemo={usingDemoData} />
}
