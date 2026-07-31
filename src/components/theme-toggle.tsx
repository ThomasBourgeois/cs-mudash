"use client"

import { useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Le thème vit sur `<html class="dark">`, posé avant le premier paint par le
 * script inline de layout.tsx. Le composant lit donc le DOM comme source de
 * vérité plutôt que d'en tenir une copie dans un state : c'est exactement le
 * cas d'usage de useSyncExternalStore, et ça évite le setState-dans-un-effet
 * qui provoquerait un rendu en cascade à chaque montage.
 */
let listeners: (() => void)[] = []

function subscribe(onChange: () => void) {
  listeners.push(onChange)
  return () => {
    listeners = listeners.filter((l) => l !== onChange)
  }
}

const isDark = () => document.documentElement.classList.contains("dark")

// Le serveur ne connaît pas la préférence : il rend la variante claire, et
// l'hydratation corrige si besoin.
const isDarkOnServer = () => false

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, isDarkOnServer)

  function toggle() {
    const next = !dark
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("mudash-theme", next ? "dark" : "light")
    for (const notify of listeners) notify()
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
