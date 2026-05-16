"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/clientes", label: "Clientes", icon: "👥" },
  { href: "/pedidos", label: "Menú / Pedidos", icon: "📋" },
  { href: "/hoy", label: "Pedidos del día", icon: "🥗" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      <div className="px-4 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center text-white text-sm font-bold">F</div>
          <span className="text-base font-bold text-gray-900 tracking-tight">Fit Ignite</span>
        </div>
        <div className="text-xs text-gray-400 mt-1">comida saludable · suscripción</div>
      </div>
      <nav className="flex-1 py-2">
        {links.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors
                ${active
                  ? "bg-green-50 text-green-700 font-medium border-l-2 border-green-500"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
            >
              <span>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">Fit Ignite v1.0</p>
      </div>
    </aside>
  );
}
