import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  Activity,
  Table2,
  Download,
  Settings,
  HelpCircle,
  Command,
  Eraser,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app';
import { CommandPalette } from '@/components/layout/CommandPalette';

const LG = '(min-width: 1024px)';
const SIDEBAR_EXPANDED = '16rem'; // w-64
const SIDEBAR_COLLAPSED = '4rem'; // w-16

type NavItem = {
  to: string;
  label: string;
  icon: typeof Search;
  end?: boolean;
  key: string;
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'EXTRACT',
    items: [
      { to: '/', label: 'Extractor', icon: Search, end: true, key: '1' },
      { to: '/search', label: 'Classic', icon: Activity, key: '2' },
      { to: '/results', label: 'Results', icon: Table2, key: '3' },
    ],
  },
  {
    label: 'OUTPUT',
    items: [
      { to: '/verify', label: 'Verify', icon: ShieldCheck, key: 'V' },
      { to: '/export', label: 'Export', icon: Download, key: '4' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings, key: '5' },
      { to: '/help', label: 'Help', icon: HelpCircle, key: '?' },
    ],
  },
];

const flatNav = navGroups.flatMap((g) => g.items);

export function AppLayout() {
  const status = useAppStore((s) => s.status);
  const clear = useAppStore((s) => s.clear);
  const extracting = useAppStore((s) => s.extracting);
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(LG).matches : true),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [hoverTip, setHoverTip] = useState<{ label: string; top: number } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(LG);
    const onChange = () => {
      setIsDesktop(mq.matches);
      if (mq.matches) setMobileOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (window.matchMedia(LG).matches) setDesktopCollapsed((v) => !v);
        else setMobileOpen((v) => !v);
        return;
      }
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setHoverTip(null);
        return;
      }
      if (!typing && !meta && !e.altKey) {
        const hit = flatNav.find((item) => item.key.toLowerCase() === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          navigate(hit.to);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const tabTitle = useMemo(() => {
    const path = location.pathname;
    const match = flatNav.find((item) =>
      item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`),
    );
    return match?.label || 'Search';
  }, [location.pathname]);

  function showTip(e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>, label: string) {
    if (!desktopCollapsed || !window.matchMedia(LG).matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverTip({ label, top: rect.top + rect.height / 2 });
  }

  function hideTip() {
    setHoverTip(null);
  }

  const sidebarVisible = isDesktop || mobileOpen;
  const collapsed = isDesktop && desktopCollapsed;
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;
  const contentPad = isDesktop ? sidebarWidth : '0px';

  return (
    <div className="relative flex h-dvh max-h-dvh w-full max-w-full overflow-hidden bg-background font-mono text-foreground">
      <div className="nd-atmosphere" aria-hidden />

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        style={{ width: sidebarVisible || !isDesktop ? sidebarWidth : SIDEBAR_EXPANDED }}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-border bg-card',
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
          'transition-[width,transform] duration-200 ease-out',
          sidebarVisible ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div
          className={cn(
            'flex h-12 shrink-0 items-center border-b border-border',
            collapsed ? 'justify-center px-1' : 'justify-between gap-2 px-3',
          )}
        >
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-bold tracking-widest text-primary">LEADMINE</p>
              <p className="truncate text-[10px] text-accent">extractor · public data</p>
            </div>
          )}
          <button
            type="button"
            title={desktopCollapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={desktopCollapsed ? 'Expand menu' : 'Collapse menu'}
            className="hidden h-8 w-8 shrink-0 items-center justify-center border border-border text-muted-foreground hover:text-primary lg:inline-flex"
            onClick={() => {
              setDesktopCollapsed((v) => !v);
              setHoverTip(null);
            }}
            onMouseEnter={(e) => showTip(e, desktopCollapsed ? 'Expand menu' : 'Collapse menu')}
            onMouseLeave={hideTip}
          >
            {desktopCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border text-muted-foreground hover:text-primary lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain p-2">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="mb-1 px-2 text-[10px] uppercase tracking-wider text-accent">
                  ── {group.label} ──
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    aria-label={item.label}
                    onMouseEnter={(e) => showTip(e, item.label)}
                    onMouseLeave={hideTip}
                    onFocus={(e) => showTip(e, item.label)}
                    onBlur={hideTip}
                    onClick={() => {
                      if (!window.matchMedia(LG).matches) setMobileOpen(false);
                      if (collapsed) {
                        setHoverTip({ label: item.label, top: window.innerHeight / 2 });
                        window.setTimeout(() => setHoverTip(null), 900);
                      }
                    }}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-10 items-center text-xs transition-colors sm:min-h-9',
                        collapsed ? 'justify-center px-0 py-2.5' : 'gap-2 px-2 py-2 sm:py-1.5',
                        isActive
                          ? 'nd-nav-active'
                          : 'text-muted-foreground hover:bg-muted hover:text-primary',
                      )
                    }
                  >
                    {!collapsed && (
                      <span className="w-4 shrink-0 text-accent">[{item.key}]</span>
                    )}
                    <item.icon className="h-4 w-4 shrink-0 opacity-80" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div
          className={cn(
            'shrink-0 space-y-1 border-t border-border',
            collapsed ? 'flex flex-col items-center p-2' : 'p-2',
          )}
        >
          <button
            type="button"
            aria-label="Command palette"
            onMouseEnter={(e) => showTip(e, 'Palette')}
            onMouseLeave={hideTip}
            onClick={() => setPaletteOpen(true)}
            className={cn(
              'flex min-h-9 items-center gap-2 border border-border text-xs text-muted-foreground hover:border-primary hover:text-primary',
              collapsed ? 'h-9 w-9 justify-center p-0' : 'w-full px-2 py-1.5',
            )}
          >
            <Command className="h-3.5 w-3.5" />
            {!collapsed && <span>Palette</span>}
          </button>
          <button
            type="button"
            aria-label="Clear results"
            onMouseEnter={(e) => showTip(e, 'Clear')}
            onMouseLeave={hideTip}
            onClick={() => {
              clear();
              navigate('/');
            }}
            className={cn(
              'flex min-h-9 items-center gap-2 border border-border text-xs text-muted-foreground hover:border-primary hover:text-primary',
              collapsed ? 'h-9 w-9 justify-center p-0' : 'w-full px-2 py-1.5',
            )}
          >
            <Eraser className="h-3.5 w-3.5" />
            {!collapsed && <span>Clear</span>}
          </button>
        </div>
      </aside>

      {hoverTip && collapsed ? (
        <div
          className="pointer-events-none fixed z-[80] hidden -translate-y-1/2 border border-border bg-card px-2.5 py-1.5 text-xs text-primary lg:block"
          style={{ top: hoverTip.top, left: '4.5rem' }}
        >
          {hoverTip.label}
        </div>
      ) : null}

      <div
        style={{ paddingLeft: contentPad }}
        className="relative z-10 flex h-dvh min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-200"
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur sm:h-12 sm:px-4 lg:px-6">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border text-primary lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="inline-block max-w-full truncate border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
              {tabTitle}
              {extracting ? ' · running…' : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex h-9 items-center gap-1 border border-border px-2 text-[10px] text-muted-foreground hover:text-primary"
          >
            <Command className="h-3 w-3" />
            <span className="hidden sm:inline">K</span>
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="animate-fade-in w-full px-3 py-4 sm:px-4 sm:py-5 lg:px-6 lg:py-6">
            <Outlet />
          </div>
        </main>

        <footer className="tui-footer">
          <span>
            <span className="text-primary">⌘K</span> command
          </span>
          <span className="text-muted-foreground">·</span>
          <span>
            <span className="text-primary">⌘B</span> menu
          </span>
          <span className="text-muted-foreground">·</span>
          <span>
            <span className="text-primary">1–5</span> jump
          </span>
          <span className="ml-auto truncate text-muted-foreground">{status}</span>
        </footer>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onClear={() => {
            clear();
            navigate('/');
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}
