import { House, Library, Search, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { icon: House, label: "Capture", to: "/" },
  { icon: Library, label: "Memories", to: "/memories" },
  { icon: Search, label: "Assistant", to: "/assistant" },
  { icon: Settings, label: "Settings", to: "/settings" },
];

export function BottomNav() {
  return (
    <nav className="pointer-events-none fixed bottom-5 left-1/2 z-30 w-[calc(100%-2rem)] max-w-[24rem] -translate-x-1/2" data-testid="bottom-navigation">
      <div className="glass-panel pointer-events-auto flex items-center justify-between rounded-full px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              className={({ isActive }) =>
                `flex min-w-[4.5rem] flex-col items-center gap-1 rounded-full px-3 py-2 text-[11px] font-semibold transition-transform duration-200 ${
                  isActive ? "bg-[#F2EFE9] text-[#1A1918]" : "text-[#6F6A62] hover:-translate-y-0.5 hover:text-[#1A1918]"
                }`
              }
              data-testid={`bottom-nav-${item.label.toLowerCase()}`}
              key={item.to}
              to={item.to}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}